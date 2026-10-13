import * as XLSX from "xlsx";
import { Document } from "@langchain/core/documents";

/** Metadata stored on every menu vector. Pinecone only accepts flat values. */
export type MenuMetadata = {
  itemName: string;
  /** Secondary name (e.g. the Portuguese one) so orders can match either. */
  altName: string;
  category: string;
  subcategory: string;
  price: number;
  dietary: string[];
  description: string;
  portionSize: number;
  text: string;
};

export type MenuHighlight = Pick<
  MenuMetadata,
  "itemName" | "category" | "price" | "description"
>;

export const MAX_MENU_ROWS = 500;

// Header aliases, checked in order. English columns win over Portuguese ones
// so the agent answers in English, but PT names are kept for search.
const COLUMNS = {
  category: ["categorytitleen", "category", "categoria", "categorytitlept"],
  subcategory: ["subcategorytitleen", "subcategory", "subcategorytitlept"],
  name: ["itemnameen", "itemname", "name", "item", "dish", "itemnamept"],
  altName: ["itemnamept"],
  price: ["itemprice", "price", "preco", "preço"],
  description: ["itemdescriptionen", "description", "itemdescriptionpt"],
  portion: ["portionsize", "portion", "pieces"],
  dietary: ["dietary", "diet", "dietarytags", "allergens"],
  availability: ["availability", "available"],
} as const;

type Row = Record<string, unknown>;

function pick(row: Row, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

/** Handles both "3,95" (PT locale) and "3.00" / numeric cells. */
export function parsePrice(raw: string): number {
  const cleaned = raw.replace(/[^\d.,-]/g, "");
  const normalized =
    cleaned.includes(",") && !cleaned.includes(".")
      ? cleaned.replace(",", ".")
      : cleaned.replace(/,/g, "");
  const price = Number.parseFloat(normalized);
  return Number.isFinite(price) ? Math.round(price * 100) / 100 : 0;
}

const MEAT = /\b(pork|chicken|duck|veal|beef|bbq|lamb|bacon|ham|porco|galinha|frango|pato|vitela)\b/i;
const SEAFOOD = /\b(shrimp|prawns?|crab|squid|cuttlefish|fish|seafood|camar[aã]o|gambas|lulas|choco|peixe)\b/i;
const SPICY = /\b(chil+i|szechuan|sichuan|spicy|malagueta|picante)\b/i;
const PEANUT = /\b(peanuts?|amendoim)\b/i;
const ALCOHOL = /\b(beer|wine|heineken|tsingtao|lello|mateus|draft|cerveja|vinho)\b/i;
const NON_ALCOHOLIC = /\b(non-alcoholic|s\/ ?[aá]lcool|alcohol[- ]free)\b/i;
const DRINK_CATEGORY = /\b(beverages?|drinks?|bebidas)\b/i;

/**
 * The sample menu has no dietary column, so tags are inferred from the dish
 * name/description. A "Dietary" column in the sheet always takes precedence.
 */
export function inferDietary(text: string, category: string): string[] {
  const tags = new Set<string>();
  const isDrink = DRINK_CATEGORY.test(category);
  const hasMeat = MEAT.test(text);
  const hasSeafood = SEAFOOD.test(text);

  if (hasMeat) tags.add("contains-meat");
  if (hasSeafood) tags.add("contains-seafood");
  if (!isDrink && !hasMeat && !hasSeafood) tags.add("vegetarian");
  if (SPICY.test(text)) tags.add("spicy");
  if (PEANUT.test(text)) tags.add("contains-peanuts");
  if (isDrink) {
    tags.add(
      ALCOHOL.test(text) && !NON_ALCOHOLIC.test(text)
        ? "alcoholic"
        : "non-alcoholic",
    );
  }
  return [...tags];
}

function normalizeHeaders(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.toLowerCase().replace(/[\s_-]/g, "")] = value;
  }
  return out;
}

export function parseMenuWorkbook(buffer: ArrayBuffer): Document<MenuMetadata>[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("The spreadsheet has no sheets.");

  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: false });
  if (rows.length > MAX_MENU_ROWS) {
    throw new Error(`Menus are limited to ${MAX_MENU_ROWS} rows for the demo.`);
  }

  const docs: Document<MenuMetadata>[] = [];
  for (const rawRow of rows) {
    const row = normalizeHeaders(rawRow);
    let itemName = pick(row, COLUMNS.name);
    let altName = pick(row, COLUMNS.altName);
    if (!itemName) continue;

    const availability = pick(row, COLUMNS.availability);
    if (availability === "0" || /^(no|false)$/i.test(availability)) continue;

    const category = pick(row, COLUMNS.category) || "Other";
    const subcategory = pick(row, COLUMNS.subcategory);
    const description = pick(row, COLUMNS.description);
    // Some rows have the description pasted into the English name column.
    if (altName && itemName.toLowerCase() === description.toLowerCase()) {
      [itemName, altName] = [altName, itemName];
    }
    const price = parsePrice(pick(row, COLUMNS.price));
    const portionSize = Number.parseInt(pick(row, COLUMNS.portion), 10) || 1;

    const explicitDietary = pick(row, COLUMNS.dietary);
    const dietary = explicitDietary
      ? explicitDietary.split(/[,;/]/).map((t) => t.trim().toLowerCase()).filter(Boolean)
      : inferDietary(`${itemName} ${altName} ${description}`, category);

    const text = [
      `Item: ${itemName}`,
      altName && altName !== itemName ? `Also called: ${altName}` : "",
      `Category: ${category}${subcategory ? ` > ${subcategory}` : ""}`,
      `Price: €${price.toFixed(2)}`,
      portionSize > 1 ? `Portion: ${portionSize} pieces` : "",
      description ? `Description: ${description}` : "",
      `Dietary: ${dietary.join(", ") || "unknown"}${explicitDietary ? "" : " (inferred from ingredients)"}`,
    ]
      .filter(Boolean)
      .join("\n");

    docs.push(
      new Document<MenuMetadata>({
        pageContent: text,
        metadata: { itemName, altName, category, subcategory, price, dietary, description, portionSize, text },
      }),
    );
  }

  disambiguateDuplicateNames(docs);

  if (docs.length === 0) {
    throw new Error("No menu items found. Make sure the first row has headers like ItemName, Category and Price.");
  }
  return docs;
}

/** "Lello White / Red" as glass and bottle -> distinct names, so orders are unambiguous. */
function disambiguateDuplicateNames(docs: Document<MenuMetadata>[]) {
  const counts = new Map<string, number>();
  for (const d of docs) counts.set(d.metadata.itemName, (counts.get(d.metadata.itemName) ?? 0) + 1);
  for (const d of docs) {
    const meta = d.metadata;
    if ((counts.get(meta.itemName) ?? 0) < 2) continue;
    const suffix = meta.description || `€${meta.price.toFixed(2)}`;
    const renamed = `${meta.itemName} (${suffix})`;
    d.pageContent = d.pageContent.replace(`Item: ${meta.itemName}`, `Item: ${renamed}`);
    meta.itemName = renamed;
    meta.text = d.pageContent;
  }
}

/** Turns "dim sum montijo.xlsx" into "Dim Sum Montijo". */
export function restaurantNameFromFile(fileName: string): string {
  return fileName
    .replace(/\.xlsx$/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Our Restaurant";
}
