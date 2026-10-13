import "server-only";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { Document } from "@langchain/core/documents";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  Annotation,
  END,
  START,
  StateGraph,
  messagesStateReducer,
} from "@langchain/langgraph";
import { getEmbeddings, menuIndex } from "@/lib/pinecone";
import { addToCartInput, type AddToCartOutput } from "@/lib/cart";
import type { MenuMetadata } from "@/lib/menu";

export const OFF_TOPIC_REPLY = "I don't have information on that.";

const flagshipModel = new ChatOpenAI({
  model: process.env.OPENAI_MODEL ?? "gpt-6-astra",
});
const fastModel = new ChatOpenAI({
  model: process.env.OPENAI_FAST_MODEL ?? "gpt-6-luna",
});

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  namespace: Annotation<string>(),
  /** Categories present in this session's menu, used to constrain filters. */
  categories: Annotation<string[]>({ reducer: (_, next) => next, default: () => [] }),
  restaurantName: Annotation<string>({ reducer: (_, next) => next, default: () => "the restaurant" }),
  context: Annotation<Document<MenuMetadata>[]>({ reducer: (_, next) => next, default: () => [] }),
  onTopic: Annotation<boolean>({ reducer: (_, next) => next, default: () => true }),
  draft: Annotation<string>({ reducer: (_, next) => next, default: () => "" }),
  cartItems: Annotation<AddToCartOutput[]>({ reducer: (_, next) => next, default: () => [] }),
});

type State = typeof AgentState.State;

/** Recent turns only — enough to resolve "yes, two of those please". */
const recentTurns = (messages: BaseMessage[], n = 8) => messages.slice(-n);

const transcript = (messages: BaseMessage[]) =>
  recentTurns(messages)
    .map((m) => `${m.getType() === "human" ? "Guest" : "Waiter"}: ${m.text}`)
    .join("\n");

// ---------------------------------------------------------------- check_question

const verdictSchema = z.object({
  verdict: z
    .enum(["True", "False"])
    .describe("True if the latest guest message is about the restaurant, its menu, food, drinks, dietary needs, or ordering"),
});

async function checkQuestion(state: State): Promise<Partial<State>> {
  // Judge the latest message on its own, with only the previous exchange as
  // context: long transcripts (and earlier refusals in them) made small models
  // grade the whole conversation instead.
  const latest = state.messages.at(-1)?.text ?? "";
  const previous = transcript(state.messages.slice(0, -1).slice(-2));
  const { verdict } = await fastModel.withStructuredOutput(verdictSchema).invoke([
    new SystemMessage(
      `You are a gatekeeper for ${state.restaurantName}'s digital waiter. Decide whether the guest's message is on-topic. ` +
        "On-topic: menu items, ingredients, prices, allergies/dietary needs, recommendations, ordering or changing an order, " +
        "questions about their cart, order, bill or total, greetings and small talk with the waiter. " +
        "Any request to order, take, get or add a dish or drink is on-topic, even if you don't recognise the dish. " +
        "Short follow-ups like \"yes please\", \"two of those\" or \"what else?\" are on-topic when the previous exchange is about food. " +
        "Everything else (weather, coding, news, general knowledge…) is off-topic. If unsure, answer True.",
    ),
    ...(previous ? [new SystemMessage(`Previous exchange (context only):\n${previous}`)] : []),
    new HumanMessage(`Guest message to classify: ${latest}`),
  ]);
  return { onTopic: verdict === "True" };
}

function offTopic(): Partial<State> {
  return { messages: [new AIMessage(OFF_TOPIC_REPLY)] };
}

// ---------------------------------------------------------------- retrieve_docs

const DIETARY_TAGS = [
  "vegetarian",
  "contains-meat",
  "contains-seafood",
  "spicy",
  "contains-peanuts",
  "alcoholic",
  "non-alcoholic",
] as const;

async function retrieveDocs(state: State): Promise<Partial<State>> {
  const filterSchema = z.object({
    searchQueries: z
      .array(z.string())
      .min(1)
      .describe(
        "Standalone menu search queries, resolving pronouns from context. One query per dish/drink the guest names " +
          "(\"crab cakes and a glass of red wine\" -> two queries); a single query for general questions.",
      ),
    categories: z
      .array(state.categories.length ? z.enum(state.categories as [string, ...string[]]) : z.string())
      .describe(
        'Only set when the guest literally names one of the known categories (e.g. "any desserts?"). ' +
          "Generic words like dumplings, food, dishes or snacks are NOT categories — leave empty.",
      ),
    dietary: z
      .array(z.enum(DIETARY_TAGS))
      .describe("Only set if the guest asks for a dietary constraint, e.g. vegetarian or spicy; otherwise empty"),
    maxPrice: z.number().nullable().describe("Maximum unit price in euros if the guest gives a budget, else null"),
  });

  const plan = await fastModel.withStructuredOutput(filterSchema).invoke([
    new SystemMessage(
      `Turn the latest guest message into a menu search. Known categories: ${state.categories.join(", ") || "unknown"}.`,
    ),
    new SystemMessage(`Conversation:\n${transcript(state.messages)}`),
  ]);

  const filter: Record<string, unknown> = {};
  if (plan.categories.length) filter.category = { $in: plan.categories };
  if (plan.dietary.length) filter.dietary = { $in: plan.dietary };
  if (plan.maxPrice !== null) filter.price = { $lte: plan.maxPrice };

  const queries = plan.searchQueries.slice(0, 5);
  const vectors = await (await getEmbeddings()).embedDocuments(queries);
  const index = menuIndex().namespace(state.namespace);
  const hasFilter = Object.keys(filter).length > 0;

  // Filtered hits come first, but unfiltered searches always run too: a
  // misjudged filter (e.g. "dumplings" -> Gyozas) must never hide the dish
  // the guest actually named. Each named dish gets its own search so
  // multi-item orders don't blur into one vector.
  const results = await Promise.all([
    ...(hasFilter ? vectors.map((vector) => index.query({ vector, topK: 8, includeMetadata: true, filter })) : []),
    ...vectors.map((vector) => index.query({ vector, topK: queries.length > 1 ? 4 : 6, includeMetadata: true })),
  ]);
  const seen = new Set<string>();
  const matches = results
    .flatMap((r) => r.matches)
    .filter((m) => !seen.has(m.id) && seen.add(m.id))
    .slice(0, 16);

  return {
    context: matches.flatMap((m) =>
      m.metadata ? [new Document({ pageContent: m.metadata.text, metadata: m.metadata })] : [],
    ),
  };
}

// -------------------------------------------------------------- generate_answer

const addToCartTool = tool(async (input) => input, {
  name: "add_to_cart",
  description:
    "Add a menu item to the guest's cart. Call this ONLY when the guest clearly asks to order/add an item. " +
    "Use the exact item name and unit price from the menu context. Call once per distinct item.",
  schema: addToCartInput,
});

async function generateAnswer(state: State): Promise<Partial<State>> {
  const menu = state.context.map((d) => d.pageContent).join("\n\n") || "(no matching menu items)";
  const response = await flagshipModel.bindTools([addToCartTool]).invoke([
    new SystemMessage(
      `You are the digital waiter at ${state.restaurantName}. Answer ONLY from the menu context below; never invent dishes, prices or ingredients. ` +
        "Prices are in euros. Dietary tags marked as inferred are best guesses from the ingredient list — for allergies, tell the guest to confirm with staff. " +
        "If the guest wants to order something that is in the context, call add_to_cart with the exact item name, quantity (default 1) and unit price. " +
        "If the item is ambiguous or not on the menu, ask a short clarifying question instead of calling the tool. " +
        "When you recommend or describe dishes, include their unit prices. " +
        "Earlier cart additions appear in the conversation as [Added to cart: …] notes — use them to answer questions about the current order or total.\n\n" +
        `MENU CONTEXT:\n${menu}`,
    ),
    ...recentTurns(state.messages),
  ]);
  return { messages: [response], draft: response.text };
}

function routeAfterGenerate(state: State) {
  const last = state.messages.at(-1);
  return last instanceof AIMessage && last.tool_calls?.length ? "add_to_cart" : "improve_answer";
}

// ------------------------------------------------------------------ add_to_cart

/**
 * Executes the model's add_to_cart calls. The price is re-read from the
 * retrieved metadata so a hallucinated price can never reach the receipt.
 */
async function addToCart(state: State): Promise<Partial<State>> {
  const last = state.messages.at(-1) as AIMessage;
  const cartItems: AddToCartOutput[] = [];
  const notes: string[] = [];

  for (const call of last.tool_calls ?? []) {
    const parsed = addToCartInput.safeParse(call.args);
    if (call.name !== "add_to_cart" || !parsed.success) continue;

    const match = findMenuItem(state.context, parsed.data.itemName);
    if (!match) {
      notes.push(`Could not find "${parsed.data.itemName}" on the menu, so it was NOT added.`);
      continue;
    }
    // Models sometimes repeat the same call; one line per item per turn.
    if (cartItems.some((c) => c.itemName === match.metadata.itemName)) continue;
    const price = match.metadata.price;
    cartItems.push({
      itemName: match.metadata.itemName,
      quantity: parsed.data.quantity,
      price,
      lineTotal: Math.round(price * parsed.data.quantity * 100) / 100,
    });
  }

  const added = cartItems.map((c) => `${c.quantity}× ${c.itemName}`).join(", ");
  return {
    cartItems,
    draft: [state.draft, added && `Added to the cart: ${added}.`, ...notes]
      .filter(Boolean)
      .join("\n"),
  };
}

const normalizeName = (name: string) =>
  name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Exact match on the name or alternate name first; otherwise the longest
 * menu name contained in what the model sent (it sometimes appends notes).
 */
function findMenuItem(context: Document<MenuMetadata>[], requested: string) {
  const wanted = normalizeName(requested);
  const names = (d: Document<MenuMetadata>) =>
    [d.metadata.itemName, d.metadata.altName].filter(Boolean).map(normalizeName);

  const exact = context.find((d) => names(d).includes(wanted));
  if (exact) return exact;

  let best: Document<MenuMetadata> | undefined;
  let bestLength = 0;
  for (const doc of context) {
    for (const name of names(doc)) {
      if (name.length > bestLength && (wanted.includes(name) || name.includes(wanted))) {
        best = doc;
        bestLength = name.length;
      }
    }
  }
  return best;
}

// --------------------------------------------------------------- improve_answer

const PRICE_PATTERN = /€\s?(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s?(?:€|eur\b|euros?\b)|\$\s?\d/gi;

/** Every price in the text must be a real menu price or cart total — and never in dollars. */
function pricesAreGrounded(text: string, state: State) {
  const known = new Set(
    [
      ...state.context.map((d) => d.metadata.price),
      ...state.cartItems.flatMap((c) => [c.price, c.lineTotal]),
      ...[...state.draft.matchAll(PRICE_PATTERN)].map((m) => Number((m[1] ?? m[2] ?? "").replace(",", "."))),
    ].map((n) => n.toFixed(2)),
  );
  return [...text.matchAll(PRICE_PATTERN)].every((m) => {
    const amount = m[1] ?? m[2];
    return amount !== undefined && known.has(Number(amount.replace(",", ".")).toFixed(2));
  });
}

async function improveAnswer(state: State): Promise<Partial<State>> {
  const prompt = [
    new SystemMessage(
      "Rewrite the waiter's draft reply so it sounds casual, friendly and enthusiastic. " +
        "STRICT LIMIT: 1-2 sentences. Keep every fact (dish names, prices, quantities) exactly as in the draft and NEVER add new ones — " +
        "do not mention any price that is not in the draft. Prices are in euros (€), never dollars. " +
        "Only say something was added to the cart if it is listed under CART UPDATE; otherwise never claim anything was added. " +
        "Reply with the rewritten text only.",
    ),
    new SystemMessage(`Guest asked: ${state.messages.findLast((m) => m.getType() === "human")?.text ?? ""}`),
    new SystemMessage(
      `CART UPDATE: ${state.cartItems.map((c) => `${c.quantity}× ${c.itemName}`).join(", ") || "none — nothing was added this turn"}`,
    ),
    new SystemMessage(`Draft:\n${state.draft || "(empty draft — greet the guest and offer help with the menu)"}`),
  ];

  // Small models occasionally "improve" prices; retry once with a reminder,
  // then fall back to the (accurate, if less chatty) draft.
  let reply = (await fastModel.invoke(prompt)).text;
  if (!pricesAreGrounded(reply, state)) {
    reply = (
      await fastModel.invoke([
        ...prompt,
        new SystemMessage("Your previous rewrite changed or invented a price. Use only prices that appear in the draft, in €."),
      ])
    ).text;
  }
  if (!pricesAreGrounded(reply, state)) reply = state.draft;
  return { messages: [new AIMessage(reply)] };
}

// ------------------------------------------------------------------------ graph

export const waiterGraph = new StateGraph(AgentState)
  .addNode("check_question", checkQuestion)
  .addNode("off_topic", offTopic)
  .addNode("retrieve_docs", retrieveDocs)
  .addNode("generate_answer", generateAnswer)
  .addNode("add_to_cart", addToCart)
  .addNode("improve_answer", improveAnswer)
  .addEdge(START, "check_question")
  .addConditionalEdges("check_question", (s) => (s.onTopic ? "retrieve_docs" : "off_topic"), [
    "retrieve_docs",
    "off_topic",
  ])
  .addEdge("off_topic", END)
  .addEdge("retrieve_docs", "generate_answer")
  .addConditionalEdges("generate_answer", routeAfterGenerate, ["add_to_cart", "improve_answer"])
  .addEdge("add_to_cart", "improve_answer")
  .addEdge("improve_answer", END)
  .compile();
