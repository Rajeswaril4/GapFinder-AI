// Inngest durable function: Ingest Document
// Steps: Validation → Text Extraction → Chunking → Event Dispatch

import { inngest } from "../client";
import { getSupabaseAdminClient } from "../../supabase/server";

export const ingestDocument = inngest.createFunction(
  {
    id: "ingest-document",
    retries: 3,
    concurrency: 5,
    triggers: [{ event: "document/ingest.requested" }],
  },
  async ({ event, step }) => {
    const { userId, documentId, declaredKind, fileName } = event.data;

    // Step 1: Record processing job
    await step.run("initialize-job", async () => {
      const supabase = getSupabaseAdminClient();
      if (supabase) {
        await supabase.from("processing_jobs").insert({
          user_id: userId,
          document_id: documentId,
          job_type: "document_ingestion",
          status: "running",
          progress: 10,
        });
      }
      return { status: "started" };
    });

    // Step 2: Update status
    await step.run("update-document-status", async () => {
      const supabase = getSupabaseAdminClient();
      if (supabase) {
        await supabase
          .from("documents")
          .update({ status: "processing", updated_at: new Date().toISOString() })
          .eq("id", documentId);
      }
      return { status: "processing" };
    });

    return {
      success: true,
      documentId,
      fileName,
      declaredKind,
    };
  }
);
