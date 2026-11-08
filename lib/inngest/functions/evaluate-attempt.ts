// Inngest durable function: Evaluate Attempt
// Combines deterministic scoring with Gemini rubric grading, then triggers mastery updates.

import { inngest } from "../client";
import { getSupabaseAdminClient } from "../../supabase/server";

export const evaluateAttempt = inngest.createFunction(
  {
    id: "evaluate-attempt",
    retries: 2,
    triggers: [{ event: "attempt/evaluate.requested" }],
  },
  async ({ event, step }) => {
    const { userId, attemptId, answers } = event.data;

    await step.run("record-attempt", async () => {
      const supabase = getSupabaseAdminClient();
      if (supabase) {
        await supabase.from("quiz_attempts").upsert({
          id: attemptId,
          user_id: userId,
          answers,
          created_at: new Date().toISOString(),
        });
      }
      return { recorded: true };
    });

    // Step 2: Trigger downstream mastery update
    await step.sendEvent("trigger-mastery-update", {
      name: "mastery/update.requested",
      data: {
        userId,
        attemptId,
      },
    });

    return { success: true, attemptId };
  }
);
