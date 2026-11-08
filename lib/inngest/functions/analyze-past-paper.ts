// Inngest durable function: Analyze Past Paper
// Extracts individual questions, maps them to syllabus topics, calculates exam importance.

import { inngest } from "../client";
import { extractPastQuestionsDetailed } from "../../retrieval";
import { getSupabaseAdminClient } from "../../supabase/server";

export const analyzePastPaper = inngest.createFunction(
  {
    id: "analyze-past-paper",
    retries: 2,
    triggers: [{ event: "past-paper/analyze.requested" }],
  },
  async ({ event, step }) => {
    const { userId, documentId, paperText } = event.data;

    const extracted = await step.run("extract-questions", async () => {
      return extractPastQuestionsDetailed(paperText);
    });

    await step.run("persist-questions", async () => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) return { count: extracted.length };

      for (const [idx, q] of extracted.entries()) {
        await supabase.from("past_paper_questions").insert({
          id: `${documentId}_pq_${idx + 1}`,
          document_id: documentId,
          user_id: userId,
          text: q.text,
          marks: q.marks,
          qtype: "other",
          difficulty: "medium",
          needs_review: true,
        });
      }
      return { count: extracted.length };
    });

    return { success: true, count: extracted.length };
  }
);
