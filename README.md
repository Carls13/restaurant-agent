# Restaurant RAG Agent: digital waiter

Upload a menu spreadsheet (`.xlsx`) and chat with an AI waiter that answers from it and can add items to a cart.

## Stack

Next.js 16 (App Router) · LangGraph.js · `@langchain/openai` · Pinecone · Vercel AI SDK 7 (`useChat`) · SheetJS

## How it works

1. **Upload** (`src/app/actions/upload-menu.ts`): a server action parses the sheet (`src/lib/menu.ts`) into LangChain `Document`s with `category`, `price` and `dietary` metadata. It embeds them with OpenAI and upserts them into a **fresh `session-<uuid>` Pinecone namespace**. The namespace is returned to the browser and stored in `sessionStorage`.
2. **Agent** (`src/lib/agent/graph.ts`): a LangGraph `StateGraph`:

   ```
   START → check_question ─False→ off_topic → END
                          └True→ retrieve_docs → generate_answer ─tool call→ add_to_cart ─┐
                                                                └────────────────────────┴→ improve_answer → END
   ```

   - `check_question` returns `"True"`/`"False"` (structured output).
   - `retrieve_docs` turns the question into a search plus optional metadata filters (category / dietary / max price). It queries the session namespace and falls back to an unfiltered search if the filters match nothing.
   - `generate_answer` uses the flagship model with the `add_to_cart` tool bound.
   - `add_to_cart` checks each call against the retrieved menu. **The price always comes from the menu metadata, not from the model.**
   - `improve_answer` rewrites the draft in 1–2 casual, enthusiastic sentences.
3. **Chat** (`src/app/api/chat/route.ts`): the graph is streamed into an AI SDK UI message stream. Only `improve_answer` tokens reach the user. Each cart addition is emitted as an `add_to_cart` tool part, which `useChat` renders as a `<Receipt>` component. Chat history and cart live only in `useChat` state, so a refresh clears them.

## Setup

```bash
cp .env.example .env.local   # fill in OPENAI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX
npm install
npm run setup:pinecone       # one-time: creates a 1536-dim cosine serverless index
npm run dev
```

Then upload `dim sum montijo.xlsx` on http://localhost:3000.

### Spreadsheet format

The first sheet's header row is matched case-insensitively:

| Field | Accepted headers |
| --- | --- |
| Name | `ItemNameEn`, `ItemName`, `Name`, `Item`, `Dish` |
| Category | `CategoryTitleEn`, `Category` |
| Price | `ItemPrice`, `Price` (accepts `3,95` and `3.95`) |
| Description | `ItemDescriptionEn`, `Description` |
| Dietary | `Dietary`, `Allergens` (comma-separated). **If missing, tags are inferred from ingredients.** |

## Deploying to Vercel

Import the repo and add the same environment variables in the Vercel project settings. Run `npm run setup:pinecone` once locally first. Uploads are capped at 2MB / 500 rows.

## Notes

- Session namespaces are not deleted automatically. Clear old ones from the Pinecone console, or add a cron job that deletes `session-*` namespaces.
- Inferred dietary tags are heuristics. The waiter is told to send allergy questions to staff.
