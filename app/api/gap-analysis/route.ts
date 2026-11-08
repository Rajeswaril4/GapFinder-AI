// AGENT 7 — Knowledge Gap Diagnosis (generation part): writes the human-readable diagnosis and
// recommended action for each topic. The weak/medium/strong/not-assessed level, mastery and
// confidence are computed in code (lib/analysis.ts) and are NOT changeable here — the model only
// explains the numbers using the student's actual mistakes.
import { z } from "zod";
import { fail, generateJson } from "@/lib/llm";

export const maxDuration = 60;

const Body = z.object({
  topics: z.array(
    z.object({
      topicId: z.string(),
      name: z.string(),
      level: z.string(),
      confidence: z.string().default("low"),
      evidence: z.string(),
      weakSubtopics: z.array(z.string()).default([]),
      misconceptions: z.array(z.string()).default([]),
      trend: z.number().nullable().optional(),
    })
  ),
  mistakes: z
    .array(
      z.object({
        topicId: z.string(),
        subtopic: z.string(),
        question: z.string(),
        studentAnswer: z.string(),
        feedback: z.string(),
        misconception: z.string().optional().nullable(),
        confidence: z.string().optional().nullable(),
      })
    )
    .default([]),
});

const Schema = z.object({
  summary: z.string().default(""),
  topics: z.array(z.object({ topicId: z.string(), reason: z.string(), action: z.string().optional().nullable() })),
});

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
    const { topics, mistakes } = parsed.data;
    const prompt =
      `TOPIC RESULTS (level and confidence are final, do not change them):\n` +
      topics
        .map(
          (t) =>
            `- ${t.topicId} | ${t.name} | level=${t.level} | evidence confidence=${t.confidence}` +
            (t.trend != null ? ` | change since last attempt ${Math.round(t.trend * 100)} pts` : "") +
            ` | ${t.evidence}` +
            (t.misconceptions.length ? ` | misconceptions: ${t.misconceptions.join("; ")}` : "")
        )
        .join("\n") +
      `\n\nMISTAKES FROM THE LATEST QUIZ:\n` +
      (mistakes.length
        ? mistakes
            .slice(0, 25)
            .map(
              (m) =>
                `- [${m.topicId} / ${m.subtopic}] Q: ${m.question} | student said: ${m.studentAnswer}` +
                (m.confidence ? ` (student felt ${m.confidence} confidence)` : "") +
                ` | ${m.misconception || m.feedback}`
            )
            .join("\n")
        : "(none)") +
      `\n\nReturn {"summary": string, "topics":[{"topicId","reason","action"}]} with one entry per topic.`;

    const out = await generateJson({
      schema: Schema,
      temperature: 0.3,
      system:
        "You are the Knowledge Gap Diagnosis Agent writing for a student. For each topic, 'reason' is ONE or TWO short sentences " +
        "that explain the level using the numbers and the student's specific mistakes, e.g. 'You got 3 of 4 questions on " +
        "photosynthesis wrong, mostly about the light reaction — you placed it in the stroma.' Point out high-confidence wrong " +
        "answers (they reveal real misconceptions), recurring mistakes, and improvement. If evidence confidence is low, say more " +
        "questions are needed. For not-assessed topics, say it hasn't been tested yet. 'action' = one concrete next step. " +
        "The summary is 2 sentences: the biggest gap and what to do first. Be specific and encouraging. Use only the information given.",
      prompt,
    });

    const valid = new Set(topics.map((t) => t.topicId));
    const rows = out.topics.filter((t) => valid.has(t.topicId));
    return Response.json({
      summary: out.summary,
      reasons: Object.fromEntries(rows.map((t) => [t.topicId, t.reason])),
      actions: Object.fromEntries(rows.filter((t) => t.action).map((t) => [t.topicId, t.action])),
    });
  } catch (e) {
    return fail(e);
  }
}
