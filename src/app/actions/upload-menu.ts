"use server";

import { randomUUID } from "node:crypto";
import { getEmbeddings, menuIndex } from "@/lib/pinecone";
import {
  parseMenuWorkbook,
  restaurantNameFromFile,
  type MenuHighlight,
} from "@/lib/menu";

export type MenuSession = {
  namespace: string;
  restaurantName: string;
  itemCount: number;
  categories: string[];
  highlights: MenuHighlight[];
};

export type UploadResult =
  | { ok: true; session: MenuSession }
  | { ok: false; error: string };

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const UPSERT_BATCH = 100;

export async function uploadMenu(formData: FormData): Promise<UploadResult> {
  const file = formData.get("menu");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose an .xlsx file." };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, error: "Only .xlsx spreadsheets are supported." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: "That file is over 2MB — menus should be much smaller." };
  }

  try {
    const docs = parseMenuWorkbook(await file.arrayBuffer());
    const vectors = await (await getEmbeddings()).embedDocuments(docs.map((d) => d.pageContent));

    // Every upload gets its own namespace, so demo sessions never see each
    // other's menus and the frontend can scope chat queries to it.
    const namespace = `session-${randomUUID()}`;
    const index = menuIndex().namespace(namespace);

    const records = docs.map((doc, i) => ({
      id: `item-${i}`,
      values: vectors[i],
      metadata: doc.metadata,
    }));
    for (let i = 0; i < records.length; i += UPSERT_BATCH) {
      await index.upsert(records.slice(i, i + UPSERT_BATCH));
    }
    await waitUntilQueryable(namespace, records.length);

    const categories = [...new Set(docs.map((d) => d.metadata.category))];
    const highlights = categories
      .flatMap((category) =>
        docs.filter((d) => d.metadata.category === category).slice(0, 2),
      )
      .slice(0, 8)
      .map(({ metadata: { itemName, category, price, description } }) => ({
        itemName,
        category,
        price,
        description,
      }));

    return {
      ok: true,
      session: {
        namespace,
        restaurantName: restaurantNameFromFile(file.name),
        itemCount: docs.length,
        categories,
        highlights,
      },
    };
  } catch (error) {
    console.error("Menu upload failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, error: `Couldn't process that menu: ${message}` };
  }
}

/**
 * Pinecone serverless is eventually consistent: freshly upserted vectors can
 * take a few seconds to appear in queries. Wait briefly so the first chat
 * message doesn't hit an empty namespace.
 */
async function waitUntilQueryable(namespace: string, expected: number) {
  const index = menuIndex();
  for (let attempt = 0; attempt < 15; attempt++) {
    const stats = await index.describeIndexStats();
    if ((stats.namespaces?.[namespace]?.recordCount ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
