// Inngest durable function: Map Syllabus
// Generates topic hierarchy, learning objectives, and prerequisites with retry & idempotency.

import { inngest } from "../client";
import { generateStructuredJson } from "../../ai/provider";
import { TopicMapResultSchema } from "../../ai/schemas";
import { getSupabaseAdminClient } from "../../supabase/server";

export const mapSyllabus = inngest.createFunction(
  {
    id: "map-syllabus",
    retries: 2,
    triggers: [{ event: "syllabus/map.requested" }],
  },
  async ({ event, step }) => {
    const { userId, subjectId, syllabusText, pastPaperText } = event.data;

    const mapped = await step.run("generate-topic-hierarchy", async () => {
      const text = syllabusText.slice(0, 15000);
      const res = await generateStructuredJson({
        schema: TopicMapResultSchema,
        system:
          "You are the Syllabus Mapping Agent. Extract authoritative topics, subtopics, learning objectives and prerequisites. " +
          "Never invent topics outside the provided text. Merge duplicates.",
        prompt:
          `SYLLABUS CONTENT:\n"""\n${text}\n"""\n` +
          (pastPaperText ? `\nPAST PAPER CONTENT:\n"""\n${pastPaperText.slice(0, 6000)}\n"""\n` : ""),
      });
      return res.data;
    });

    await step.run("persist-topics", async () => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) return { persisted: false };

      for (const [idx, t] of mapped.topics.entries()) {
        const topicId = `t_${idx + 1}_${t.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}`;
        await supabase.from("topics").upsert({
          id: topicId,
          user_id: userId,
          subject_id: subjectId !== "default" ? subjectId : null,
          name: t.name,
          description: t.description,
          chapter: t.chapter || null,
          exam_weight: 0,
        });

        // Subtopics
        for (const [subIdx, st] of t.subtopics.entries()) {
          await supabase.from("subtopics").insert({
            topic_id: topicId,
            user_id: userId,
            name: st,
            sort_order: subIdx,
          });
        }

        // Learning Objectives
        for (const obj of t.learningObjectives) {
          await supabase.from("learning_objectives").insert({
            topic_id: topicId,
            user_id: userId,
            description: obj,
          });
        }
      }
      return { persisted: true, count: mapped.topics.length };
    });

    return {
      success: true,
      subject: mapped.subject,
      topicCount: mapped.topics.length,
    };
  }
);
