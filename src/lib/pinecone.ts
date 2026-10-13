import "server-only";
import { Pinecone } from "@pinecone-database/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { MenuMetadata } from "./menu";

let client: Pinecone | undefined;

export function menuIndex() {
  client ??= new Pinecone({ apiKey: requireEnv("PINECONE_API_KEY") });
  return client.index<MenuMetadata>(requireEnv("PINECONE_INDEX"));
}

let embeddingsPromise: Promise<OpenAIEmbeddings> | undefined;

/**
 * Embeddings sized to match the Pinecone index. text-embedding-3 models can
 * shorten their output, so an existing 1024-dim index works as well as 1536.
 */
export function getEmbeddings(): Promise<OpenAIEmbeddings> {
  embeddingsPromise ??= (async () => {
    client ??= new Pinecone({ apiKey: requireEnv("PINECONE_API_KEY") });
    const { dimension } = await client.describeIndex(requireEnv("PINECONE_INDEX"));
    return new OpenAIEmbeddings({
      model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
      ...(dimension ? { dimensions: dimension } : {}),
    });
  })().catch((error) => {
    embeddingsPromise = undefined;
    throw error;
  });
  return embeddingsPromise;
}

/** Session namespaces are server-generated UUIDs; reject anything else. */
export const NAMESPACE_PATTERN = /^session-[0-9a-f-]{36}$/;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
