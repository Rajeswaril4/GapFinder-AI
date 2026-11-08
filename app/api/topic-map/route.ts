// AGENT 2 — Syllabus Mapping (generation): turns the syllabus text into a topic hierarchy with
// descriptions, learning objectives and prerequisites. The syllabus is authoritative: the prompt
// forbids topics that are not in it, and the student can edit the result before any quiz.
// (Linking topics to notes sections and mapping past-paper questions is done afterwards by
// deterministic retrieval in the browser — see lib/retrieval.ts.)
import { z } from "zod";
import { fail, generateJson } from "@/lib/llm";
import { extractIndexSection, stripFrontMatter } from "@/lib/text";

export const maxDuration = 60;

const Body = z.object({ syllabus: z.string().min(30, "Syllabus text is too short."), pastPaper: z.string().optional() });

const Schema = z.object({
  subject: z.string().default("My subject"),
  topics: z
    .array(
      z.object({
        name: z.string().min(2),
        description: z.string().default(""),
        chapter: z.string().optional().nullable(),
        subtopics: z.array(z.string()).default([]),
        keywords: z.array(z.string()).default([]),
        learningObjectives: z.array(z.string()).default([]),
        prerequisites: z.array(z.string()).default([]),
      })
    )
    .min(1),
  questions: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const { syllabus, pastPaper } = parsed.data;
    const indexMatter = extractIndexSection(syllabus);
    const cleanText = indexMatter || stripFrontMatter(syllabus);
    const text = cleanText.slice(0, 6000);

    const out = await generateJson({
      schema: Schema,
      temperature: 0.1,
      system:
        "You are the Syllabus Mapping Agent. You build an authoritative topic map (like a table of contents) from a student's syllabus or textbook index. " +
        "The syllabus/index is strictly authoritative: use ONLY academic topics that appear in the provided text. Never add topics from your own knowledge. " +
        "CRITICAL: Ignore all administrative, editorial, and pedagogical front-matter: " +
        "do NOT create topics from committee members, writers, editors, coordinators, publishers, copyright notices, 'Intro...', " +
        "letters to teachers or students ('Dear Teachers', 'Dear Students'), QR code guides, academic standards rubrics, " +
        "national anthem, or pledge. " +
        "If a TEXTBOOK INDEX or TABLE OF CONTENTS is present, extract ONLY the academic chapters and concepts listed in it " +
        "(e.g. Nutrition, Respiration, Transportation, Excretion, Coordination, Reproduction, Heredity, Environment, Natural Resources). " +
        "Merge duplicates. Prerequisites must be names of other topics in your list.",
      prompt:
        `SYLLABUS / INDEX TEXT:\n"""\n${text}\n"""\n\n` +
        `Return {"subject": string, "topics": [{"name", "description", "chapter", "subtopics": string[], "keywords": string[], "learningObjectives": string[], "prerequisites": string[]}]` +
        (pastPaper ? `, "questions": string[]` : "") +
        `}.\nRules: 3-12 topics in syllabus order (unit/chapter level); 2-6 subtopics each, worded as in the syllabus; ` +
        `description = one sentence; 2-4 learningObjectives starting with a verb (Explain, Describe, Compare, Calculate…); ` +
        `4-10 keywords a textbook section on it would contain; prerequisites = other topics from this list that must be understood first (often empty). ` +
        `CRITICAL: ONLY extract academic subject topics from the index/syllabus. DO NOT include committee members, authors, teacher guidelines, academic standards rubrics, or front-matter preamble.` +
        (pastPaper
          ? `\n\nAlso split this PAST PAPER into its individual questions (verbatim, without marks or numbering) as "questions":\n"""\n${pastPaper.slice(0, 3000)}\n"""`
          : ""),
    });

    // duplicate detection by normalised name
    const seen = new Set<string>();
    const topics = out.topics.filter((t) => {
      const k = t.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return Response.json({
      subject: out.subject,
      topics: topics.slice(0, 12).map((t, i) => ({
        id: `t_${i + 1}_${t.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}`,
        name: t.name.trim(),
        description: t.description,
        chapter: t.chapter ?? undefined,
        subtopics: t.subtopics.slice(0, 8),
        keywords: t.keywords.slice(0, 12),
        learningObjectives: t.learningObjectives.slice(0, 5),
        prerequisites: t.prerequisites.slice(0, 4),
      })),
      questions: out.questions ?? [],
    });
  } catch (e) {
    return fail(e);
  }
}
