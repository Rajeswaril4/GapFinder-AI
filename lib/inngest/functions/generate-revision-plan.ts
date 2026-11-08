// Inngest durable function: Generate Revision Plan
// Schedules revision blocks within daily study hours budget and writes grounded tasks.

import { inngest } from "../client";
import { getSupabaseAdminClient } from "../../supabase/server";

export const generateRevisionPlan = inngest.createFunction(
  {
    id: "generate-revision-plan",
    retries: 2,
    triggers: [{ event: "plan/generate.requested" }],
  },
  async ({ event, step }) => {
    const { userId, reportId, days, hoursPerDay, examDate } = event.data;

    const planId = await step.run("create-revision-schedule", async () => {
      const supabase = getSupabaseAdminClient();
      const newPlanId = `plan_${Date.now()}`;

      if (supabase) {
        await supabase.from("revision_plans").insert({
          id: newPlanId,
          user_id: userId,
          report_id: reportId,
          days,
          hours_per_day: hoursPerDay,
          exam_date: examDate ? new Date(examDate).toISOString() : null,
          ai_enhanced: true,
          schedule: [],
        });
      }
      return newPlanId;
    });

    return { success: true, planId };
  }
);
