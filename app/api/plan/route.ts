// AGENT 8 — Revision Planning (generation part): rewrites the deterministic schedule's study
// blocks into concrete, source-grounded tasks with success criteria. Timing, order and priority
// come from lib/planner.ts and are not changed here.
import { z } from "zod";
import { fail, generateJson } from "@/lib/llm";

export const maxDuration = 60;

const Body = z.object({
  groups: z.array(
    z.object({
      key: z.string(),
      topicName: z.string(),
      kind: z.string(),
      level: z.string(),
      minutes: z.number(),
      reason: z.string().default(""),
      misconceptions: z.array(z.string()).default([]),
      objectives: z.array(z.string()).default([]),
      focus: z.array(z.string()).default([]),
      pastQuestion: z.string().optional().nullable(),
      sources: z.array(z.object({ label: z.string(), text: z.string() })).default([]),
    })
  ),
});

const Schema = z.object({
  tasks: z.array(
    z.object({
      key: z.string(),
      activity: z.string(),
      focus: z.array(z.string()).default([]),
      successCriteria: z.string().optional().nullable(),
    })
  ),
});

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
    const { groups } = parsed.data;
    if (!groups.length) return Response.json({ tasks: {} });

    const prompt =
      groups
        .slice(0, 14)
        .map(
          (g) =>
            `KEY ${g.key} | ${g.topicName} | ${g.kind} block, ${g.minutes} min total | level=${g.level}\n` +
            `Diagnosis: ${g.reason}\nFocus: ${g.focus.join(", ") || "-"}\n` +
            (g.misconceptions.length ? `Misconceptions to fix: ${g.misconceptions.join("; ")}\n` : "") +
            (g.objectives.length ? `Learning objectives: ${g.objectives.join("; ")}\n` : "") +
            (g.pastQuestion ? `Past-paper question on this topic: ${g.pastQuestion}\n` : "") +
            g.sources.map((s) => `SOURCE [${s.label}]: ${s.text.slice(0, 350)}`).join("\n")
        )
        .join("\n\n") +
      `\n\nReturn {"tasks":[{"key","activity","focus","successCriteria"}]} with one task per KEY.`;

    const out = await generateJson({
      schema: Schema,
      temperature: 0.4,
      system:
        "You are the Revision Planning Agent turning a revision schedule into concrete tasks. For each KEY write an 'activity' of " +
        "2-3 imperative sentences that tells the student exactly what to read (name the source section), what to write or " +
        "practise, and how to self-check — targeting the diagnosed mistakes and misconceptions. Use only the sources given. " +
        "'learn' = rebuild understanding, 'practice' = answer questions, 'review' = quick recall. 'focus' = 1-3 short subtopic names. " +
        "'successCriteria' = one measurable sentence (e.g. 'Explain photolysis without notes and score 80%+ on Nutrition next quiz').",
      prompt,
    });
    return Response.json({
      tasks: Object.fromEntries(out.tasks.map((t) => [t.key, { activity: t.activity, focus: t.focus, successCriteria: t.successCriteria ?? undefined }])),
    });
  } catch (e) {
    return fail(e);
  }
}
