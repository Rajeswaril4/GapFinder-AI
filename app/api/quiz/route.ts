
// AGENT 5 — Diagnostic Question Generation (grounded).
// Generates questions ONLY from retrieved source chunks.
// Every question must pass validation before being shown to the student.

import { z } from "zod";

import { fail, generateJson } from "@/lib/llm";
import { overlapRatio } from "@/lib/text";

import type {
  Difficulty,
  QuestionType,
  QuizQuestion,
} from "@/lib/types";

export const maxDuration = 60;

// --------------------------------------------------
// 1. INPUT VALIDATION
// --------------------------------------------------

const InChunk = z.object({
  id: z.string(),
  materialName: z.string(),
  section: z.string(),
  page: z.number(),
  text: z.string(),
});

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

// --------------------------------------------------
// 2. QUESTION TYPES
// --------------------------------------------------

const TYPES = [
  "mcq",
  "multi_select",
  "true_false",
  "fill_blank",
  "short",
  "numerical",
] as const;

// Convert common AI-generated aliases into valid types.

const QuestionTypeSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();

  const aliases: Record<string, string> = {
    multiple_choice: "mcq",
    "multiple-choice": "mcq",
    "multiple choice": "mcq",

    multiple_select: "multi_select",
    "multiple-select": "multi_select",

    "true/false": "true_false",
    "true-false": "true_false",

    "fill-in-the-blank": "fill_blank",
    "fill in the blank": "fill_blank",

    short_answer: "short",
    "short-answer": "short",
  };

  return aliases[normalized] ?? normalized;
}, z.enum(TYPES));

// --------------------------------------------------
// 3. GENERATED QUESTION SCHEMA
// --------------------------------------------------

const Q = z.object({
  topicId: z.string(),

  subtopic: z.string().default(""),

  type: QuestionTypeSchema,

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

const Schema = z.object({
  questions: z.array(Q),
});

type GenQ = z.infer<typeof Q>;

// --------------------------------------------------
// 4. HELPER FUNCTIONS
// --------------------------------------------------

const norm = (s: string) =>
  s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Returns an error message if the generated question is invalid.
 * Returns an empty string if the question passes validation.
 */

function validate(q: GenQ, chunkText: string): string {
  // Supporting quote must come from the retrieved source.
  if (overlapRatio(q.quote, chunkText) < 0.6) {
    return "quote not found in the cited source";
  }

  const opts = q.options ?? [];

  const distinct = new Set(opts.map(norm)).size === opts.length;

  switch (q.type) {
    // ----------------------------------------------
    // MCQ VALIDATION
    // ----------------------------------------------

    case "mcq": {
      if (opts.length !== 4 || !distinct) {
        return "MCQ needs 4 distinct options";
      }

      if (
        q.answerIndex == null ||
        !Number.isInteger(q.answerIndex) ||
        q.answerIndex < 0 ||
        q.answerIndex >= opts.length
      ) {
        return "MCQ answer key missing or invalid";
      }

      if (/all of the above|none of the above/i.test(opts.join(" "))) {
        return "ambiguous option (all/none of the above)";
      }

      return "";
    }

    // ----------------------------------------------
    // TRUE / FALSE VALIDATION
    // ----------------------------------------------

    case "true_false": {
      if (q.answerIndex !== 0 && q.answerIndex !== 1) {
        return "true/false answer key missing";
      }

      return "";
    }

    // ----------------------------------------------
    // MULTI-SELECT VALIDATION
    // ----------------------------------------------

    case "multi_select": {
      const keys = q.answerIndices ?? [];

      if (opts.length < 4 || opts.length > 5 || !distinct) {
        return "multi-select needs 4-5 distinct options";
      }

      if (
        !keys.length ||
        keys.length >= opts.length ||
        keys.some(
          (i) =>
            !Number.isInteger(i) ||
            i < 0 ||
            i >= opts.length
        ) ||
        new Set(keys).size !== keys.length
      ) {
        return "multi-select answer key invalid";
      }

      return "";
    }

    // ----------------------------------------------
    // FILL IN THE BLANK VALIDATION
    // ----------------------------------------------

    case "fill_blank": {
      if (!/_{2,}|\[blank\]/i.test(q.question)) {
        return "fill-in question has no blank";
      }

      if (!q.acceptedAnswers?.length) {
        return "fill-in has no accepted answer";
      }

      if (
        overlapRatio(q.acceptedAnswers[0], chunkText) < 0.5
      ) {
        return "fill-in answer not in the source";
      }

      return "";
    }

    // ----------------------------------------------
    // NUMERICAL VALIDATION
    // ----------------------------------------------

    case "numerical": {
      if (
        q.numericAnswer == null ||
        !Number.isFinite(q.numericAnswer)
      ) {
        return "numerical answer missing";
      }

      if (!/\d/.test(chunkText)) {
        return "numerical question from a source with no numbers";
      }

      return "";
    }

    // ----------------------------------------------
    // SHORT ANSWER VALIDATION
    // ----------------------------------------------

    case "short": {
      if ((q.rubric?.length ?? 0) < 1) {
        return "short answer has no rubric";
      }

      if (overlapRatio(q.modelAnswer, chunkText) < 0.35) {
        return "model answer not supported by the source";
      }

      return "";
    }
  }
}

// --------------------------------------------------
// 5. API POST HANDLER
// --------------------------------------------------

export async function POST(req: Request) {
  try {
    // Validate incoming request.
    const parsed = Body.safeParse(await req.json());

    if (!parsed.success) {
      return Response.json(
        {
          error:
            "Invalid quiz request: " +
            parsed.error.issues[0].message,
        },
        { status: 400 }
      );
    }

    const { topics, avoid } = parsed.data;

    // Store actual retrieved chunks by their IDs.
    const chunkById = new Map<
      string,
      z.infer<typeof InChunk>
    >();

    // --------------------------------------------------
    // 6. BUILD SOURCE CONTEXT
    // --------------------------------------------------

    const context = topics
      .map((t) => {
        const blocks = t.chunks
          .map((c) => {
            chunkById.set(c.id, c);

            return (
              `  [chunk ${c.id}] ` +
              `(${c.materialName} › ${c.section}, p.${c.page})\n` +
              `  ${c.text.slice(0, 900)}`
            );
          })
          .join("\n\n");

        return (
          `TOPIC ${t.topicId}: ${t.name} — ` +
          `subtopics: ${t.subtopics.join(", ")}\n` +

          (t.learningObjectives.length
            ? `Learning objectives: ${t.learningObjectives.join("; ")}\n`
            : "") +

          (t.weakSubtopics.length
            ? `Student previously got wrong: ${t.weakSubtopics.join(", ")}\n`
            : "") +

          (t.misconceptions.length
            ? `Known misconceptions to probe: ${t.misconceptions.join("; ")}\n`
            : "") +

          `Target difficulty: ${t.difficulty}\n` +
          `QUESTIONS NEEDED: ${t.count}\n` +
          `SOURCE CHUNKS:\n${blocks}`
        );
      })
      .join("\n\n=====\n\n");

    const total = topics.reduce(
      (sum, t) => sum + t.count,
      0
    );

    // --------------------------------------------------
    // 7. GENERATE QUESTIONS USING AI
    // --------------------------------------------------

    const out = await generateJson({
      schema: Schema,

      temperature: 0.1,

      system:
        "You are the Diagnostic Question Generation Agent. " +
        "You write a DIAGNOSTIC quiz that reveals what the student does not know. " +
        "Use ONLY facts stated in the SOURCE CHUNKS. Never use outside knowledge. " +
        "Each question must be answerable from a single chunk. " +
        "Copy a short supporting sentence from that chunk word-for-word as the quote. " +
        "Questions must be unambiguous, with exactly one defensible answer. " +
        "Prefer questions that expose misconceptions (processes, differences, " +
        "cause-and-effect, application) over trivia. " +
        "Distractors must be plausible misconceptions, not jokes.",

      prompt:
        `${context}\n\n` +

        `Write exactly ${total} questions (the number given per topic). ` +
        `Use a MIX of types:\n` +

        `- "mcq": 4 options, answerIndex 0-3 (about 40% of questions)\n` +

        `- "multi_select": 4-5 options, answerIndices = all correct indexes (2-3 of them)\n` +

        `- "true_false": options ["True","False"], answerIndex 0 for True or 1 for False\n` +

        `- "fill_blank": the question contains "____"; acceptedAnswers = the missing word(s) as in the source, plus spelling variants\n` +

        `- "short": 1-2 sentence answer; modelAnswer = ideal answer; rubric = 2-4 key points that earn credit\n` +

        `- "numerical": ONLY if the source gives numbers or a formula; numericAnswer, unit, tolerance (e.g. 0.02)\n` +

        // Exact question-type values.
        `IMPORTANT: The type field must use ONLY these exact values: ` +
        `"mcq", "multi_select", "true_false", "fill_blank", "short", "numerical". ` +
        `Never use "multiple_choice", "multiple-choice", or other aliases. ` +
        `Do not change these values.\n\n` +

        // MCQ answer-key requirements.
        `IMPORTANT MCQ RULES:\n` +
        `For EVERY question with type "mcq", provide exactly 4 distinct options.\n` +
        `You MUST provide "answerIndex" as an integer from 0 to 3.\n` +
        `answerIndex identifies the correct option using zero-based indexing.\n` +
        `The correct answer MUST appear in the options array.\n` +
        `Never omit answerIndex, return null, or use answerIndices for an MCQ.\n` +
        `If you cannot determine the correct answer from the source, do not generate that question.\n\n` +

        `Set difficulty (easy/medium/hard) and marks (1-3, more for harder or longer answers). ` +
        `learningObjective = which objective it tests; misconceptionTags = the misconceptions the wrong options represent.\n` +

        (avoid.length
          ? `DO NOT repeat these earlier questions:\n- ${avoid
              .slice(0, 20)
              .join("\n- ")}\n`
          : "") +

        // Strict output requirements.
        `STRICT OUTPUT REQUIREMENTS:\n` +

        `Return ONLY a valid JSON object. Do not include markdown or explanations outside JSON.\n` +

        `Every question MUST contain these THREE required fields:\n` +

        `1. topicId: Copy the exact topicId from the corresponding TOPIC section.\n` +

        `2. type: Use exactly one of: mcq, multi_select, true_false, fill_blank, short, numerical.\n` +

        `3. chunkId: Copy the exact ID of the source chunk supporting this question. It must match an ID shown in SOURCE CHUNKS.\n` +

        `Never omit these fields. Never invent or modify IDs. Never use null or empty strings for them.\n` +

        `Every question must also contain a non-empty quote copied word-for-word from its cited chunk.\n\n` +

        `Use this exact JSON structure as your example:\n` +

        `{\n` +
        `  "questions": [\n` +
        `    {\n` +
        `      "topicId": "EXACT_TOPIC_ID_FROM_INPUT",\n` +
        `      "subtopic": "Supervised Learning",\n` +
        `      "type": "mcq",\n` +
        `      "difficulty": "easy",\n` +
        `      "marks": 1,\n` +
        `      "question": "What is supervised learning?",\n` +
        `      "options": ["Learning with labelled data", "Learning without data", "Random guessing", "Data deletion"],\n` +
        `      "answerIndex": 0,\n` +
        `      "modelAnswer": "Learning with labelled data",\n` +
        `      "explanation": "The source states that supervised learning uses labelled data.",\n` +
        `      "chunkId": "EXACT_CHUNK_ID_FROM_INPUT",\n` +
        `      "quote": "Exact supporting sentence copied from the source."\n` +
        `    }\n` +
        `  ]\n` +
        `}\n\n` +

        `The IDs in the example are placeholders. Replace them with actual IDs from the input.\n` +

        `For every question, use a topicId belonging to its topic section and a chunkId belonging to that topic's supplied chunks.\n` +

        `Include type-specific fields: answerIndex for mcq and true_false; answerIndices for multi_select; acceptedAnswers for fill_blank; rubric and modelAnswer for short; numericAnswer for numerical.\n` +

        `Do not omit topicId, type, chunkId or quote, even when other fields are not applicable.\n` +

        `Generate exactly the requested number of questions.`,
    });

    // --------------------------------------------------
    // 8. VALIDATE GENERATED QUESTIONS
    // --------------------------------------------------

    const topicById = new Map(
      topics.map((t) => [t.topicId, t])
    );

    const seen = new Set<string>();

    const accepted: QuizQuestion[] = [];

    const rejected: {
      question: string;
      why: string;
    }[] = [];

    for (const q of out.questions) {
      const chunkId = q.chunkId.replace(/^chunk\s*/i, "").trim();

      const chunk = chunkById.get(chunkId);

      const topic =
        topicById.get(q.topicId) ??
        topics.find((t) =>
          t.chunks.some((c) => c.id === chunk?.id)
        );

      // Set standard options for true/false questions.
      if (q.type === "true_false") {
        q.options = ["True", "False"];
      }

      let why = !chunk
        ? "cites a chunk that was not retrieved"
        : !topic
        ? "unknown topic"
        : validate(q, chunk.text);

      // Prevent duplicate questions.
      if (!why && seen.has(norm(q.question))) {
        why = "duplicate";
      }

      if (why) {
        rejected.push({
          question: q.question,
          why,
        });

        continue;
      }

      seen.add(norm(q.question));

      const opts = q.options ?? undefined;

      // Determine the correct model answer.
      const modelAnswer =
        q.type === "mcq" || q.type === "true_false"
          ? opts![q.answerIndex!]
          : q.type === "multi_select"
          ? q.answerIndices!
              .map((i: number) => opts![i])
              .join(", ")
          : q.type === "fill_blank"
          ? q.acceptedAnswers![0]
          : q.type === "numerical"
          ? `${q.numericAnswer}${q.unit ? " " + q.unit : ""}`
          : q.modelAnswer;

      // Add validated question to the accepted list.
      accepted.push({
        id: `q_${Math.random().toString(36).slice(2, 10)}`,

        type: q.type as QuestionType,

        topicId: topic!.topicId,

        topicName: topic!.name,

        subtopic: q.subtopic || topic!.name,

        difficulty: q.difficulty as Difficulty,

        marks: q.marks,

        question: q.question.trim(),

        options: ["mcq", "multi_select", "true_false"].includes(q.type)
          ? opts
          : undefined,

        answerIndex: q.answerIndex ?? undefined,

        answerIndices: q.answerIndices ?? undefined,

        acceptedAnswers: q.acceptedAnswers ?? undefined,

        numericAnswer: q.numericAnswer ?? undefined,

        tolerance:
          q.tolerance ??
          (q.type === "numerical" ? 0.02 : undefined),

        unit: q.unit ?? undefined,

        rubric: q.rubric ?? undefined,

        modelAnswer,

        explanation: q.explanation,

        learningObjective: q.learningObjective ?? undefined,

        misconceptionTags: q.misconceptionTags ?? undefined,

        citation: {
          chunkId: chunk!.id,
          materialName: chunk!.materialName,
          section: chunk!.section,
          page: chunk!.page,
          quote: q.quote,
        },
      });
    }

    // --------------------------------------------------
    // 9. RETURN API RESPONSE
    // --------------------------------------------------

    if (!accepted.length) {
      return Response.json(
        {
          error:
            "No question passed validation. Try again or add more notes.",
          rejected,
        },
        { status: 422 }
      );
    }

    return Response.json({
      questions: accepted,
      rejected,
    });

  } catch (e) {
    return fail(e);
  }
}
