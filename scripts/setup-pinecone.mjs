// One-time setup: creates the serverless index the app upserts menus into.
// Usage: node --env-file=.env.local scripts/setup-pinecone.mjs
import { Pinecone } from "@pinecone-database/pinecone";

const name = process.env.PINECONE_INDEX;
if (!process.env.PINECONE_API_KEY || !name) {
  console.error("Set PINECONE_API_KEY and PINECONE_INDEX in .env.local first.");
  process.exit(1);
}

const pc = new Pinecone();
await pc.createIndex({
  name,
  dimension: 1536, // text-embedding-3-small
  metric: "cosine",
  spec: { serverless: { cloud: "aws", region: "us-east-1" } },
  suppressConflicts: true,
  waitUntilReady: true,
});
// suppressConflicts keeps an existing index, so verify it is usable.
const { dimension, metric } = await pc.describeIndex(name);
if (metric !== "cosine" || dimension > 1536) {
  console.error(`Index "${name}" is ${dimension}-dim/${metric}; the app needs cosine and <= 1536 dims.`);
  process.exit(1);
}
console.log(`Pinecone index "${name}" is ready (${dimension} dims; embeddings will match).`);
