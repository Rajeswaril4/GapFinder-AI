// RETRIEVAL LAYER — everything in this file is deterministic (BM25), no LLM.
// It decides WHICH source text the generator is allowed to see.
import { BM25 } from "./bm25";
import type { Chunk, Difficulty, MaterialKind, PastQuestion, Topic } from "./types";
import { CONFIG } from "./config";
import { normalizeWhitespace } from "./text";

export interface RetrievedChunk extends Chunk {
  score: number;
}

export class Retriever {
  private index: BM25;
  private byId: Map<string, Chunk>;

  constructor(private chunks: Chunk[]) {
    this.index = new BM25(chunks.map((c) => ({ id: c.id, text: `${c.section}\n${c.text}` })));
    this.byId = new Map(chunks.map((c) => [c.id, c]));
  }

  get(id: string) {
    return this.byId.get(id);
  }

  all() {
    return this.chunks;
  }

  /**
   * Top-k chunks for a query. `kinds` restricts the source type (e.g. only notes/textbook);
   * if nothing matches in the preferred kinds we fall back to all material.
   */
  search(query: string, k = 4, kinds?: MaterialKind[]): RetrievedChunk[] {
    const run = (filter?: (id: string) => boolean) =>
      this.index.search(query, k, filter).map((h) => ({ ...(this.byId.get(h.id) as Chunk), score: h.score }));
    if (kinds?.length) {
      const set = new Set(kinds);
      const preferred = run((id) => set.has(this.byId.get(id)!.kind));
      if (preferred.length) return preferred;
    }
    return run();
  }
}

export function topicQuery(t: Pick<Topic, "name" | "subtopics" | "keywords">): string {
  return [t.name, t.name, ...t.subtopics, ...t.keywords].join(" ");
}

/** For each topic, find where it is covered in the notes/textbook. */
export function attachTopicSources(topics: Topic[], retriever: Retriever): Topic[] {
  // Each notes section is "owned" by the single topic it matches best, so a section
  // never counts as evidence for two topics. Ties to the topic that the retriever ranks highest.
  // Front matter (committees, publishers, prefaces, pledges) is filtered out.
  const notes = retriever.all().filter((c) => c.kind === "notes" && !c.section.toLowerCase().includes("front matter"));
  const pool = notes.length ? notes : retriever.all().filter((c) => !c.section.toLowerCase().includes("front matter"));
  const topicIdx = new BM25(topics.map((t) => ({ id: t.id, text: topicQuery(t) })));
  const owned = new Map<string, string[]>();
  for (const c of pool) {
    // the section heading is the strongest signal; fall back to the body text
    const heading = c.section.split(" > ").pop() ?? "";
    const byHeading = topicIdx.search(heading, 2);
    const clear = byHeading[0] && (!byHeading[1] || byHeading[0].score > byHeading[1].score * 1.3);
    const [best] = clear ? byHeading : topicIdx.search(`${heading} ${heading} ${c.text}`, 1);
    if (best) owned.set(best.id, [...(owned.get(best.id) ?? []), c.id]);
  }
  return topics.map((t) => {
    const rank = new Map(retriever.search(topicQuery(t), 50, ["notes"]).map((c, i) => [c.id, i]));
    let ids = (owned.get(t.id) ?? []).sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99));
    if (!ids.length) ids = retriever.search(topicQuery(t), 2, ["notes"]).map((c) => c.id);
    return { ...t, sourceChunkIds: ids.slice(0, 6) };
  });
}

/** Pull individual questions (with marks, when printed) out of a past paper. Heuristic: "Q1.", "1)", "2." styles. */
export function extractPastQuestionsDetailed(text: string): { text: string; marks: number | null }[] {
  const t = "\n" + text.replace(/\r/g, "");
  const MARK = String.raw`(?:Q(?:uestion)?\s*\.?\s*\d+[a-z]?\s*[.):-]?|\d{1,2}\s*[.)]|\(\s*[a-z]\s*\))`;
  const MARKS = /\s*[\[(]\s*(\d+)\s*marks?\s*[\])]\s*$/i;
  const parts = t
    .split(new RegExp(String.raw`\n\s*(?=${MARK}\s+)`, "i"))
    .map((p) => {
      const clean = normalizeWhitespace(p.replace(new RegExp(String.raw`^\s*${MARK}\s*`, "i"), ""));
      const m = clean.match(MARKS);
      return { text: clean.replace(MARKS, ""), marks: m ? Number(m[1]) : null };
    })
    .filter((p) => p.text.length > 15 && p.text.length < 800);
  // first part is often a header ("Board Exam 2023 ..."): drop it if it has no question cue
  if (parts.length > 1 && !/[?]|explain|describe|define|what|why|how|state|draw|differentiate|name|list|give/i.test(parts[0].text))
    parts.shift();
  return parts;
}

export function extractPastQuestions(text: string): string[] {
  return extractPastQuestionsDetailed(text).map((p) => p.text);
}

/** AGENT 4 helpers — classify a past-paper question. */
export function classifyQuestion(text: string, marks: number | null): { qtype: string; difficulty: Difficulty } {
  const t = text.toLowerCase();
  const qtype = /\bcalculate|\bfind the value|\bcompute|\d+\s*(?:kg|m\/s|n|j|v|ohm|°c|cm|mol)\b/.test(t)
    ? "numerical"
    : /\bdraw|diagram|label/.test(t)
    ? "diagram"
    : /differen|distinguish|compare/.test(t)
    ? "compare"
    : /\bdefine|what is|what are|\bname\b|\blist\b|\bstate\b/.test(t)
    ? "recall"
    : /explain|describe|why|how/.test(t)
    ? "explain"
    : "other";
  const difficulty: Difficulty =
    marks != null ? (marks <= 1 ? "easy" : marks <= 3 ? "medium" : "hard") : qtype === "recall" ? "easy" : qtype === "explain" || qtype === "compare" ? "medium" : "hard";
  return { qtype, difficulty };
}

/**
 * AGENT 4 — Previous Paper Analysis. Maps each past-paper question to the syllabus topic it
 * belongs to. Each topic is represented by its name, subtopics, keywords AND the text of the
 * notes sections retrieved for it — so a question that uses textbook vocabulary
 * ("chlorophyll", "stomata") still lands on the right topic. Low-confidence matches are
 * flagged for the student to review instead of being guessed.
 */
export function mapQuestionsToTopics(
  questions: { id: string; text: string; materialName: string; marks?: number | null }[],
  topics: Topic[],
  retriever: Retriever,
  manual: Map<string, string | null> = new Map()
): { pastQuestions: PastQuestion[]; topics: Topic[] } {
  const topicDocs = topics.map((t) => ({
    id: t.id,
    text: [topicQuery(t), ...t.sourceChunkIds.map((id) => retriever.get(id)?.text ?? "")].join("\n"),
  }));
  const idx = new BM25(topicDocs);
  const counts = new Map<string, number>();
  const valid = new Set(topics.map((t) => t.id));
  const pastQuestions: PastQuestion[] = questions.map((q) => {
    const marks = q.marks ?? null;
    const { qtype, difficulty } = classifyQuestion(q.text, marks);
    if (manual.has(q.id) && (manual.get(q.id) === null || valid.has(manual.get(q.id)!))) {
      const topicId = manual.get(q.id)!;
      if (topicId) counts.set(topicId, (counts.get(topicId) ?? 0) + 1);
      return { ...q, marks, qtype, difficulty, topicId, matchScore: 0, confidence: 1, needsReview: false, manual: true };
    }
    const [best, second] = idx.search(q.text, 2);
    const ok = !!best && best.score > CONFIG.mapping.minScore;
    // confidence = how clearly the best topic beats the runner-up, and how strong the match is
    const margin = best ? (best.score - (second?.score ?? 0)) / best.score : 0;
    const confidence = best ? Number(Math.min(1, 0.6 * margin + 0.4 * Math.min(1, best.score / 6)).toFixed(2)) : 0;
    if (ok) counts.set(best.id, (counts.get(best.id) ?? 0) + 1);
    return {
      ...q,
      marks,
      qtype,
      difficulty,
      topicId: ok ? best.id : null,
      matchScore: best ? Number(best.score.toFixed(2)) : 0,
      confidence: ok ? confidence : 0,
      needsReview: !ok || confidence < CONFIG.mapping.reviewBelowConfidence,
    };
  });
  return {
    pastQuestions,
    topics: topics.map((t) => ({ ...t, examWeight: counts.get(t.id) ?? 0 })),
  };
}
