// AGENT 2 — Syllabus Mapping (generation): turns the syllabus text into a topic hierarchy with
// descriptions, learning objectives and prerequisites. The syllabus is authoritative: the prompt
// forbids topics that are not in it, and the student can edit the result before any quiz.
// (Linking topics to notes sections and mapping past-paper questions is done afterwards by
// deterministic retrieval in the browser — see lib/retrieval.ts.)
import { z } from "zod";
import { fail, generateJson } from "@/lib/llm";
import { extractIndexSection, stripFrontMatter } from "@/lib/text";

export const maxDuration = 60;

const Body = z.object({ syllabus: z.string().min(10, "Syllabus text is too short."), pastPaper: z.string().optional() });

const TopicItemSchema = z.object({
  name: z.string().min(2),
  description: z.string().default(""),
  chapter: z.string().optional().nullable(),
  subtopics: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  learningObjectives: z.array(z.string()).default([]),
  prerequisites: z.array(z.string()).default([]),
});

const Schema = z.object({
  subject: z.string().default("My subject"),
  topics: z.array(TopicItemSchema).default([]),
  questions: z.array(z.string()).optional(),
});

type TopicItem = z.infer<typeof TopicItemSchema>;

/**
 * Deterministic fallback generator: extracts academic topics from syllabus/headings/notes
 * when an LLM provider returns an empty topics array or fails.
 */
function fallbackTopicsFromText(text: string, subjectGuess = "General Studies"): TopicItem[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && l.length < 120);

  const candidateHeadings: string[] = [];
  const headingRegex = /^(?:\d+(?:\.\d+)*\s+[-–:.]?\s*|[A-Z0-9IVX]+\s*[-–:.]\s*|chapter\s+\d+|unit\s+\d+|section\s+\d+)/i;

  for (const l of lines) {
    if (/^(?:our national anthem|pledge|published by|printed in|scert|ncert|telangana govt|contents|index|table of contents|academic headings|headings from)/i.test(l)) {
      continue;
    }
    if (headingRegex.test(l) || (l.length >= 4 && l.length <= 60 && !l.endsWith("."))) {
      const clean = l.replace(/^(?:chapter|unit|lesson|section)?\s*\d+(?:\.\d+)*\s*[-–:.]?\s*/i, "").trim();
      if (clean.length > 2 && !candidateHeadings.includes(clean)) {
        candidateHeadings.push(clean);
      }
    }
  }

  if (candidateHeadings.length > 0) {
    const selected = candidateHeadings.slice(0, 8);
    return selected.map((name, i) => {
      const otherNames = selected.filter((_, idx) => idx !== i);
      return {
        name,
        description: `Key syllabus topic covering ${name.toLowerCase()}.`,
        chapter: `Topic ${i + 1}`,
        subtopics: otherNames.slice(0, 3),
        keywords: name.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
        learningObjectives: [
          `Understand the fundamental principles of ${name}`,
          `Explain the key concepts and applications of ${name}`,
        ],
        prerequisites: i > 0 ? [selected[i - 1]] : [],
      };
    });
  }

  const base = subjectGuess && subjectGuess !== "My subject" && subjectGuess !== "General Studies" ? subjectGuess : "Core Syllabus Concepts";
  return [
    {
      name: base,
      description: `Comprehensive study module covering key concepts of ${base}.`,
      chapter: "Unit 1",
      subtopics: ["Foundations", "Core Principles", "Applications"],
      keywords: ["concepts", "fundamentals", "revision", "principles"],
      learningObjectives: [
        `Understand key principles of ${base}`,
        `Apply core concepts to solve diagnostic questions`,
      ],
      prerequisites: [],
    },
    {
      name: `${base} Review & Practice`,
      description: `Targeted revision and practice exercises for ${base}.`,
      chapter: "Unit 2",
      subtopics: ["Practice Questions", "Key Definitions", "Exam Techniques"],
      keywords: ["practice", "review", "exam", "analysis"],
      learningObjectives: [
        `Identify and fix misconceptions in ${base}`,
        `Solve exam-level questions with source citations`,
      ],
      prerequisites: [base],
    },
  ];
}

export async function POST(req: Request) {
  let cleanText = "";
  let rawSyllabus = "";
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const { syllabus, pastPaper } = parsed.data;
    rawSyllabus = syllabus;
    const indexMatter = extractIndexSection(syllabus);
    cleanText = indexMatter || stripFrontMatter(syllabus);
    const text = (cleanText || syllabus).slice(0, 6000);

    const out = await generateJson({
      schema: Schema,
      temperature: 0.1,
      system:
        "You are the Syllabus Mapping Agent. You build an authoritative topic map from a student's syllabus, textbook index, or study notes. " +
        "Extract academic topics and units that appear in the provided text. " +
        "MANDATORY REQUIREMENTS:\n" +
        "1. You MUST generate between 2 and 12 distinct academic topics in 'topics'. NEVER return an empty topics array.\n" +
        "2. If the text contains full textbook chapters or an index, use the chapters as topics.\n" +
        "3. If the text contains notes sections or headings, promote each main heading into a topic.\n" +
        "4. Ignore administrative front-matter: committees, publishers, copyright notices, national anthem, pledge.\n" +
        "5. Merge duplicates. Prerequisites must be names of other topics in your list.",
      prompt:
        `ACADEMIC STUDY TEXT / HEADINGS:\n"""\n${text}\n"""\n\n` +
        `Return {"subject": string, "topics": [{"name", "description", "chapter", "subtopics": string[], "keywords": string[], "learningObjectives": string[], "prerequisites": string[]}]` +
        (pastPaper ? `, "questions": string[]` : "") +
        `}.\n` +
        `RULES:\n` +
        `- Return 2-12 academic topics in study order. DO NOT return an empty 'topics' array.\n` +
        `- 2-6 subtopics each, description = one sentence, 2-4 learningObjectives starting with a verb (Explain, Describe, Compare, Calculate…), and 4-10 keywords.\n` +
        `- If the text only has a few section headings, promote each main heading to a topic.\n` +
        (pastPaper
          ? `\nAlso split this PAST PAPER into its individual questions (verbatim, without marks or numbering) as "questions":\n"""\n${pastPaper.slice(0, 3000)}\n"""`
          : ""),
    });

    let rawTopics = Array.isArray(out?.topics) ? out.topics : [];
    if (rawTopics.length === 0) {
      console.warn("[topic-map] AI returned empty topics, using structured fallback from input text");
      rawTopics = fallbackTopicsFromText(cleanText || text, out?.subject);
    }

    // duplicate detection by normalised name
    const seen = new Set<string>();
    let topics = rawTopics.filter((t) => {
      const k = t.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (topics.length === 0) {
      topics = fallbackTopicsFromText(cleanText || text, out?.subject);
    }

    return Response.json({
      subject: out?.subject || "General Studies",
      topics: topics.slice(0, 12).map((t, i) => ({
        id: `t_${i + 1}_${t.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}`,
        name: t.name.trim(),
        description: t.description || `Study module covering ${t.name.trim()}.`,
        chapter: t.chapter ?? undefined,
        subtopics: Array.isArray(t.subtopics) ? t.subtopics.slice(0, 8) : [],
        keywords: Array.isArray(t.keywords) ? t.keywords.slice(0, 12) : [],
        learningObjectives: Array.isArray(t.learningObjectives) ? t.learningObjectives.slice(0, 5) : [],
        prerequisites: Array.isArray(t.prerequisites) ? t.prerequisites.slice(0, 4) : [],
      })),
      questions: out?.questions ?? [],
    });
  } catch (e) {
    console.warn("[topic-map] AI generation failed, using robust fallback topics:", e);
    // Graceful degradation: never block the student with a 502/500 if text is present
    if (rawSyllabus || cleanText) {
      const fallbackList = fallbackTopicsFromText(cleanText || rawSyllabus);
      return Response.json({
        subject: "Study Plan",
        topics: fallbackList.slice(0, 12).map((t, i) => ({
          id: `t_${i + 1}_${t.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}`,
          name: t.name.trim(),
          description: t.description,
          chapter: t.chapter ?? undefined,
          subtopics: t.subtopics.slice(0, 8),
          keywords: t.keywords.slice(0, 12),
          learningObjectives: t.learningObjectives.slice(0, 5),
          prerequisites: t.prerequisites.slice(0, 4),
        })),
        questions: [],
      });
    }
    return fail(e);
  }
}
