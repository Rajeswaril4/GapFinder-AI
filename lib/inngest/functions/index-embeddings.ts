// Inngest durable function: Index Embeddings
// Generates Gemini dense embeddings and indexes chunks in Qdrant with tenant isolation.

import { inngest } from "../client";
import { getBatchEmbeddings, EMBEDDING_MODEL, EMBEDDING_VERSION } from "../../ai/embeddings";
import { upsertChunksToQdrant } from "../../vector/qdrant";
import { getSupabaseAdminClient } from "../../supabase/server";

export const indexEmbeddings = inngest.createFunction(
  {
    id: "index-embeddings",
    retries: 3,
    triggers: [{ event: "embeddings/index.requested" }],
  },
  async ({ event, step }) => {
    const { userId, documentId, chunkIds, texts } = event.data;

    const embeddings = await step.run("generate-vectors", async () => {
      return await getBatchEmbeddings(texts);
    });

    await step.run("upsert-to-qdrant", async () => {
      const points = (chunkIds as string[]).map((id: string, idx: number) => ({
        id,
        vector: embeddings[idx],
        payload: {
          user_id: userId,
          subject_id: "default",
          document_id: documentId,
          chunk_id: id,
          page_number: 1,
          section_heading: "General",
          chunk_text: texts[idx],
          embedding_model: EMBEDDING_MODEL,
          embedding_version: EMBEDDING_VERSION,
        },
      }));

      await upsertChunksToQdrant(points);
      return { indexed: points.length };
    });

    await step.run("mark-document-ready", async () => {
      const supabase = getSupabaseAdminClient();
      if (supabase) {
        await supabase
          .from("documents")
          .update({ status: "ready", updated_at: new Date().toISOString() })
          .eq("id", documentId);
      }
      return { status: "ready" };
    });

    return { success: true, count: chunkIds.length };
  }
);
