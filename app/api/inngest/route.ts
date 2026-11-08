// Inngest background workflow endpoint for Next.js App Router.

import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { ingestDocument } from "@/lib/inngest/functions/ingest-document";
import { mapSyllabus } from "@/lib/inngest/functions/map-syllabus";
import { indexEmbeddings } from "@/lib/inngest/functions/index-embeddings";
import { analyzePastPaper } from "@/lib/inngest/functions/analyze-past-paper";
import { generateDiagnostic } from "@/lib/inngest/functions/generate-diagnostic";
import { evaluateAttempt } from "@/lib/inngest/functions/evaluate-attempt";
import { updateMastery } from "@/lib/inngest/functions/update-mastery";
import { generateRevisionPlan } from "@/lib/inngest/functions/generate-revision-plan";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ingestDocument,
    mapSyllabus,
    indexEmbeddings,
    analyzePastPaper,
    generateDiagnostic,
    evaluateAttempt,
    updateMastery,
    generateRevisionPlan,
  ],
});
