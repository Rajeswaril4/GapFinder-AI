// AGENT 5 — Diagnostic Question Generation (grounded). Writes questions ONLY from the chunks
// that retrieval selected. Every question then goes through VALIDATION before the student sees it:
//   • it must cite one of the supplied chunks, and its supporting quote must be found in that chunk
//   • the answer itself must be supported by the chunk (fill-in / short answers)
//   • per-type structure: 4 distinct MCQ options with one key, a proper multi-select key, T/F key,
//     a blank in fill-in questions, a finite numeric answer whose source contains numbers, a rubric
// Anything that fails is discarded, so questions cannot come from the model's memory.
import { z } from "zod";
import { fail, generateJson } from "@/lib/llm";
import { overlapRatio } from "@/lib/text";
import type { Difficulty, QuestionType, QuizQuestion } from "@/lib/types";

export const maxDuration = 60;

const InChunk = z.object({ id: z.string(), materialName: z.string(), section: z.string(), page: z.number(), text: z.string() });
const Body = z.object({
  topics: z
    .array(
      z.object({
        topicId: z.string(),
        name: z.string(),
        subtopics: z.array(z.string()).default([]),
        learningObjectives: z.array(z.string()).default([]),
        weakSubtopics: z.array(z.string()).default([]),
        misconceptions: z.array(z.string()).default([]),
        difficulty: z.string().default("mixed"),
        count: z.number().int().min(1).max(10),
        chunks: z.array(InChunk).min(1),
      })
    )
    .min(1)
    .max(15),
  avoid: z.array(z.string()).default([]),
});

const TYPES = ["mcq", "multi_select", "true_false", "fill_blank", "short", "numerical"] as const;
const Q = z.object({
  topicId: z.string(),
  subtopic: z.string().default(""),
  type: z.enum(TYPES),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  marks: z.coerce.number().int().min(1).max(5).default(1),
  question: z.string().min(8),
  options: z.array(z.string()).optional().nullable(),
  answerIndex: z.coerce.number().int().optional().nullable(),
  answerIndices: z.array(z.coerce.number().int()).optional().nullable(),
  acceptedAnswers: z.array(z.string()).optional().nullable(),
  numericAnswer: z.coerce.number().optional().nullable(),
  tolerance: z.coerce.number().optional().nullable(),
  unit: z.string().optional().nullable(),
  rubric: z.array(z.string()).optional().nullable(),
  modelAnswer: z.string().default(""),
  explanation: z.string().default(""),
  learningObjective: z.string().optional().nullable(),
  misconceptionTags: z.array(z.string()).optional().nullable(),
  chunkId: z.string(),
  quote: z.string().default(""),
});
const Schema = z.object({ questions: z.array(Q) });
type GenQ = z.infer<typeof Q>;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Returns why a generated question is invalid, or "" when it passes. */
function validate(q: GenQ, chunkText: string): string {
  if (overlapRatio(q.quote, chunkText) < 0.6) return "quote not found in the cited source";
  const opts = q.options ?? [];
  const distinct = new Set(opts.map(norm)).size === opts.length;
  switch (q.type) {
    case "mcq":
      if (opts.length !== 4 || !distinct) return "MCQ needs 4 distinct options";
      if (q.answerIndex == null || q.answerIndex < 0 || q.answerIndex > 3) return "MCQ answer key missing";
      if (/all of the above|none of the above/i.test(opts.join(" "))) return "ambiguous option (all/none of the above)";
      return "";
    case "true_false":
      if (q.answerIndex !== 0 && q.answerIndex !== 1) return "true/false answer key missing";
      return "";
    case "multi_select": {
      const k = q.answerIndices ?? [];
      if (opts.length < 4 || opts.length > 5 || !distinct) return "multi-select needs 4-5 distinct options";
      if (!k.length || k.length >= opts.length || k.some((i) => i < 0 || i >= opts.length)) return "multi-select answer key invalid";
      return "";
    }
    case "fill_blank":
      if (!/_{2,}|\[blank\]/i.test(q.question)) return "fill-in question has no blank";
      if (!q.acceptedAnswers?.length) return "fill-in has no accepted answer";
      if (overlapRatio(q.acceptedAnswers[0], chunkText) < 0.5) return "fill-in answer not in the source";
      return "";
    case "numerical":
      if (q.numericAnswer == null || !Number.isFinite(q.numericAnswer)) return "numerical answer missing";
      if (!/\d/.test(chunkText)) return "numerical question from a source with no numbers";
      return "";
    case "short":
      if ((q.rubric?.length ?? 0) < 1) return "short answer has no rubric";
      if (overlapRatio(q.modelAnswer, chunkText) < 0.35) return "model answer not supported by the source";
      return "";
  }
}

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid quiz request: " + parsed.error.issues[0].message }, { status: 400 });
    const { topics, avoid } = parsed.data;

    const chunkById = new Map<string, z.infer<typeof InChunk>>();
    const context = topics
      .map((t) => {
        const blocks = t.chunks
          .map((c) => {
            chunkById.set(c.id, c);
            return `  [chunk ${c.id}] (${c.materialName} › ${c.section}, p.${c.page})\n  ${c.text.slice(0, 900)}`;
          })
          .join("\n\n");
        return (
          `TOPIC ${t.topicId}: ${t.name} — subtopics: ${t.subtopics.join(", ")}\n` +
          (t.learningObjectives.length ? `Learning objectives: ${t.learningObjectives.join("; ")}\n` : "") +
          (t.weakSubtopics.length ? `Student previously got wrong: ${t.weakSubtopics.join(", ")}\n` : "") +
          (t.misconceptions.length ? `Known misconceptions to probe: ${t.misconceptions.join("; ")}\n` : "") +
          `Target difficulty: ${t.difficulty}\nQUESTIONS NEEDED: ${t.count}\nSOURCE CHUNKS:\n${blocks}`
        );
      })
      .join("\n\n=====\n\n");
    const total = topics.reduce((s, t) => s + t.count, 0);

    const out = await generateJson({
      schema: Schema,
      temperature: 0.5,
      system:
        "You are the Diagnostic Question Generation Agent. You write a DIAGNOSTIC quiz that reveals what the student does not know. " +
        "Use ONLY facts stated in the SOURCE CHUNKS. Never use outside knowledge. Each question must be answerable from a single chunk; " +
        "copy a short supporting sentence from that chunk word-for-word as the quote. Questions must be unambiguous, with exactly one " +
        "defensible answer. Prefer questions that expose misconceptions (processes, differences, cause-and-effect, application) over trivia. " +
        "Distractors must be plausible misconceptions, not jokes.",
      prompt:
        `${context}\n\n` +
        `Write exactly ${total} questions (the number given per topic). Use a MIX of types:\n` +
        `- "mcq": 4 options, answerIndex 0-3 (about 40% of questions)\n` +
        `- "multi_select": 4-5 options, answerIndices = all correct indexes (2-3 of them)\n` +
        `- "true_false": options ["True","False"], answerIndex 0 for True or 1 for False\n` +
        `- "fill_blank": the question contains "____"; acceptedAnswers = the missing word(s) as in the source, plus spelling variants\n` +
        `- "short": 1-2 sentence answer; modelAnswer = ideal answer; rubric = 2-4 key points that earn credit\n` +
        `- "numerical": ONLY if the source gives numbers or a formula; numericAnswer, unit, tolerance (e.g. 0.02)\n` +
        `Set difficulty (easy/medium/hard) and marks (1-3, more for harder or longer answers). ` +
        `learningObjective = which objective it tests; misconceptionTags = the misconceptions the wrong options represent.\n` +
        (avoid.length ? `Do NOT repeat these earlier questions:\n- ${avoid.slice(0, 20).join("\n- ")}\n` : "") +
        `Return {"questions":[{"topicId","subtopic","type","difficulty","marks","question","options","answerIndex","answerIndices","acceptedAnswers","numericAnswer","tolerance","unit","rubric","modelAnswer","explanation","learningObjective","misconceptionTags","chunkId","quote"}]} ` +
        `(omit fields that don't apply). "explanation" says why the answer is correct, using the source. "chunkId" must be one of the chunk ids above.`,
    });

    const topicById = new Map(topics.map((t) => [t.topicId, t]));
    const seen = new Set<string>();
    const accepted: QuizQuestion[] = [];
    const rejected: { question: string; why: string }[] = [];

    for (const q of out.questions) {
      const chunk = chunkById.get(q.chunkId.replace(/^chunk\s*/i, "").trim());
      const topic = topicById.get(q.topicId) ?? topics.find((t) => t.chunks.some((c) => c.id === chunk?.id));
      if (q.type === "true_false") q.options = ["True", "False"];
      let why = !chunk ? "cites a chunk that was not retrieved" : !topic ? "unknown topic" : validate(q, chunk.text);
      if (!why && seen.has(norm(q.question))) why = "duplicate";
      if (why) {
        rejected.push({ question: q.question, why });
        continue;
      }
      seen.add(norm(q.question));
      const opts = q.options ?? undefined;
      const modelAnswer =
        q.type === "mcq" || q.type === "true_false"
          ? opts![q.answerIndex!]
          : q.type === "multi_select"
          ? q.answerIndices!.map((i) => opts![i]).join(", ")
          : q.type === "fill_blank"
          ? q.acceptedAnswers![0]
          : q.type === "numerical"
          ? `${q.numericAnswer}${q.unit ? " " + q.unit : ""}`
          : q.modelAnswer;
      accepted.push({
        id: `q_${Math.random().toString(36).slice(2, 10)}`,
        type: q.type as QuestionType,
        topicId: topic!.topicId,
        topicName: topic!.name,
        subtopic: q.subtopic || topic!.name,
        difficulty: q.difficulty as Difficulty,
        marks: q.marks,
        question: q.question.trim(),
        options: ["mcq", "multi_select", "true_false"].includes(q.type) ? opts : undefined,
        answerIndex: q.answerIndex ?? undefined,
        answerIndices: q.answerIndices ?? undefined,
        acceptedAnswers: q.acceptedAnswers ?? undefined,
        numericAnswer: q.numericAnswer ?? undefined,
        tolerance: q.tolerance ?? (q.type === "numerical" ? 0.02 : undefined),
        unit: q.unit ?? undefined,
        rubric: q.rubric ?? undefined,
        modelAnswer,
        explanation: q.explanation,
        learningObjective: q.learningObjective ?? undefined,
        misconceptionTags: q.misconceptionTags ?? undefined,
        citation: { chunkId: chunk!.id, materialName: chunk!.materialName, section: chunk!.section, page: chunk!.page, quote: q.quote },
      });
    }

    if (!accepted.length)
      return Response.json({ error: "No question passed validation. Try again or add more notes.", rejected }, { status: 422 });
    return Response.json({ questions: accepted, rejected });
  } catch (e) {
    return fail(e);
  }
}
