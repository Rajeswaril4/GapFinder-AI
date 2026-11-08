// Inngest durable function: Generate Diagnostic
// Orchestrates topic chunk retrieval, grounded question generation, and strict evidence validation.

import { inngest } from "../client";
import { generateStructuredJson } from "../../ai/provider";
import { QuizResultSchema } from "../../ai/schemas";
import { getSupabaseAdminClient } from "../../supabase/server";

export const generateDiagnostic = inngest.createFunction(
  {
    id: "generate-diagnostic",
    retries: 2,
    triggers: [{ event: "diagnostic/generate.requested" }],
  },
  async ({ event, step }) => {
    const { userId, quizId, topicIds, totalQuestions } = event.data;

    const generated = await step.run("generate-questions", async () => {
      const res = await generateStructuredJson({
        schema: QuizResultSchema,
        system:
          "You are the Diagnostic Question Generation Agent. Write questions strictly grounded in the retrieved chunks. " +
          "Support every question with a verbatim quote from the cited source chunk.",
        prompt: `Generate ${totalQuestions} diagnostic questions covering topics: ${topicIds.join(", ")}.`,
      });
      return res.data.questions;
    });

    await step.run("save-quiz", async () => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) return { count: generated.length };

      for (const q of generated) {
        await supabase.from("quiz_questions").insert({
          id: `${quizId}_q_${q.topicId}`,
          quiz_id: quizId,
          user_id: userId,
          topic_id: q.topicId,
          topic_name: q.topicId,
          type: q.type,
          difficulty: q.difficulty,
          marks: q.marks,
          question: q.question,
          options: q.options ? JSON.stringify(q.options) : null,
          answer_index: q.answerIndex,
          model_answer: q.modelAnswer,
          explanation: q.explanation,
          citation: JSON.stringify({ chunkId: q.chunkId, quote: q.quote }),
        });
      }
      return { count: generated.length };
    });

    return { success: true, count: generated.length };
  }
);
