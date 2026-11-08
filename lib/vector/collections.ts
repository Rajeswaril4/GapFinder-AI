// Qdrant collections configuration and initialization.
// Defines vector parameters (768-dim cosine) and payload indices for multi-tenant isolation.

import { QdrantClient } from "@qdrant/js-client-rest";

export const MATERIALS_COLLECTION = process.env.QDRANT_COLLECTION || "gapfinder_materials";
export const VECTOR_SIZE = 768; // Gemini text-embedding-004 dimension

export interface ChunkPayload {
  user_id: string;
  subject_id: string;
  document_id: string;
  chunk_id: string;
  topic_id?: string | null;
  kind?: string;
  page_number: number;
  section_heading: string;
  chunk_text: string;
  embedding_model: string;
  embedding_version: string;
}

/**
 * Creates the collection if it does not already exist, and sets up payload indices.
 */
export async function ensureCollection(client: QdrantClient, collectionName = MATERIALS_COLLECTION): Promise<boolean> {
  try {
    const collections = await client.getCollections();
    const exists = collections.collections.some((c) => c.name === collectionName);

    if (!exists) {
      await client.createCollection(collectionName, {
        vectors: {
          size: VECTOR_SIZE,
          distance: "Cosine",
        },
      });

      // Create payload indices for fast user-isolated and topic-filtered search
      const fields = ["user_id", "subject_id", "document_id", "topic_id", "kind"];
      for (const field of fields) {
        try {
          await client.createPayloadIndex(collectionName, {
            field_name: field,
            field_schema: "keyword",
          });
        } catch {
          // Payload index might already exist or not supported on free tier
        }
      }
    }
    return true;
  } catch (err) {
    console.warn(`[qdrant] Unable to ensure collection ${collectionName}:`, err);
    return false;
  }
}
