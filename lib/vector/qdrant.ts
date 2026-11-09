// Qdrant vector database client and operations.
// Enforces tenant isolation: every query, upsert, and deletion MUST specify a valid user_id.

import { QdrantClient } from "@qdrant/js-client-rest";
import { MATERIALS_COLLECTION, ChunkPayload, ensureCollection } from "./collections";

let clientInstance: QdrantClient | null = null;
let collectionInitialized = false;

export function getQdrantClient(): QdrantClient | null {
  const url = process.env.QDRANT_URL;
  if (!url) return null;

  if (!clientInstance) {
    clientInstance = new QdrantClient({
      url,
      apiKey: process.env.QDRANT_API_KEY || undefined,
      checkCompatibility: false,
    });
  }
  return clientInstance;
}

/**
 * Checks connection health to Qdrant.
 */
export async function checkQdrantHealth(): Promise<boolean> {
  const client = getQdrantClient();
  if (!client) return false;
  try {
    await client.getCollections();
    return true;
  } catch {
    return false;
  }
}

/**
 * Deterministically generates a numerical or UUID point ID from string chunk ID.
 */
function toPointId(chunkId: string): string {
  // Pad or hash to a valid UUID format (8-4-4-4-12)
  let hash = 0;
  for (let i = 0; i < chunkId.length; i++) {
    hash = (hash << 5) - hash + chunkId.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(12, "0");
  const p1 = hex.slice(0, 8);
  const p2 = hex.slice(8, 12).padStart(4, "0");
  return `${p1}-${p2}-4000-8000-${hex.slice(0, 12)}`;
}

/**
 * Upsert chunks into Qdrant collection with tenant isolation.
 */
export async function upsertChunksToQdrant(
  items: Array<{
    id: string;
    vector: number[];
    payload: ChunkPayload;
  }>
): Promise<boolean> {
  const client = getQdrantClient();
  if (!client || items.length === 0) return false;

  try {
    if (!collectionInitialized) {
      await ensureCollection(client);
      collectionInitialized = true;
    }

    const points = items.map((it) => {
      if (!it.payload.user_id) {
        throw new Error("Security Violation: user_id is mandatory for chunk upsert");
      }
      return {
        id: toPointId(it.id),
        vector: it.vector,
        payload: it.payload as unknown as Record<string, unknown>,
      };
    });

    await client.upsert(MATERIALS_COLLECTION, {
      wait: true,
      points,
    });
    return true;
  } catch (err) {
    console.warn("[qdrant] Upsert failed:", err);
    return false;
  }
}

/**
 * Search Qdrant vectors with strict user isolation and optional topic/subject/document filters.
 */
export async function searchQdrant(opts: {
  userId: string;
  queryVector: number[];
  subjectId?: string;
  documentId?: string;
  topicId?: string;
  kind?: string;
  topK?: number;
  scoreThreshold?: number;
}): Promise<
  Array<{
    chunkId: string;
    score: number;
    payload: ChunkPayload;
  }>
> {
  const client = getQdrantClient();
  if (!client) return [];

  if (!opts.userId) {
    throw new Error("Security Violation: userId is required for Qdrant search isolation");
  }

  const mustFilters: any[] = [
    {
      key: "user_id",
      match: { value: opts.userId },
    },
  ];

  if (opts.subjectId) {
    mustFilters.push({ key: "subject_id", match: { value: opts.subjectId } });
  }
  if (opts.documentId) {
    mustFilters.push({ key: "document_id", match: { value: opts.documentId } });
  }
  if (opts.topicId) {
    mustFilters.push({ key: "topic_id", match: { value: opts.topicId } });
  }
  if (opts.kind) {
    mustFilters.push({ key: "kind", match: { value: opts.kind } });
  }

  try {
    const response = typeof client.query === "function"
      ? await client.query(MATERIALS_COLLECTION, {
          query: opts.queryVector,
          limit: opts.topK ?? 10,
          score_threshold: opts.scoreThreshold ?? 0.0,
          filter: {
            must: mustFilters,
          },
          with_payload: true,
        })
      : await (client as unknown as { search: Function }).search(MATERIALS_COLLECTION, {
          vector: opts.queryVector,
          limit: opts.topK ?? 10,
          score_threshold: opts.scoreThreshold ?? 0.0,
          filter: {
            must: mustFilters,
          },
          with_payload: true,
        });

    const points = Array.isArray(response) ? response : (response?.points || []);

    return points.map((r: { id: string | number; score: number; payload?: unknown }) => {
      const p = (r.payload || {}) as unknown as ChunkPayload;
      return {
        chunkId: p.chunk_id || String(r.id),
        score: r.score,
        payload: p,
      };
    });
  } catch (err) {
    console.warn("[qdrant] Search failed, falling back to local retrieval:", err);
    return [];
  }
}

/**
 * Delete all points associated with a specific document (e.g. on document delete).
 */
export async function deleteDocumentVectors(userId: string, documentId: string): Promise<boolean> {
  const client = getQdrantClient();
  if (!client) return false;

  if (!userId || !documentId) {
    throw new Error("userId and documentId required for deletion");
  }

  try {
    await client.delete(MATERIALS_COLLECTION, {
      wait: true,
      filter: {
        must: [
          { key: "user_id", match: { value: userId } },
          { key: "document_id", match: { value: documentId } },
        ],
      },
    });
    return true;
  } catch (err) {
    console.warn(`[qdrant] Failed to delete document vectors for ${documentId}:`, err);
    return false;
  }
}

/**
 * Delete all vectors belonging to a user (account cleanup).
 */
export async function deleteUserVectors(userId: string): Promise<boolean> {
  const client = getQdrantClient();
  if (!client) return false;
  if (!userId) throw new Error("userId is required for vector cleanup");

  try {
    await client.delete(MATERIALS_COLLECTION, {
      wait: true,
      filter: {
        must: [{ key: "user_id", match: { value: userId } }],
      },
    });
    return true;
  } catch (err) {
    console.warn(`[qdrant] Failed to delete user vectors for ${userId}:`, err);
    return false;
  }
}
