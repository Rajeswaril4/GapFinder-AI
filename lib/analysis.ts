// AGENT 7 — Knowledge Gap Diagnosis (deterministic part) + AGENT 9 — Progress Monitoring.
// Turns graded answers into topic-level mastery with a transparent weighted model:
//   mastery(topic) = Σ recency × difficulty × type × score  /  Σ recency × difficulty × type
// The numbers here decide weak / medium / strong / not assessed. The LLM only writes the
// explanation afterwards and cannot change a level. This is a heuristic, not a validated
// psychometric measure — Bayesian Knowledge Tracing / IRT could replace it later.
import type {
  Attempt,
  Confidence,
  EvidenceItem,
  GapReport,
  Level,
  QuizQuestion,
  StudentData,
  TopicStatus,
} from "./types";
import { citeLabel, uid } from "./types";
import { CONFIG } from "./config";

const M = CONFIG.mastery;
export const THRESHOLDS = { weak: M.weak, strong: M.strong };

export function levelFor(mastery: number, n: number): Level {
  if (n === 0) return "untested";
  if (mastery < M.weak) return "weak";
  if (mastery < M.strong) return "medium";
  return "strong";
}

export function confidenceFor(n: number): Confidence {
  if (n >= M.minQuestionsForConfidence.high) return "high";
  if (n >= M.minQuestionsForConfidence.medium) return "medium";
  return "low";
}

export function questionWeight(q: Pick<QuizQuestion, "difficulty" | "type">): number {
  return (M.difficultyWeight[q.difficulty ?? "medium"] ?? 1) * (M.typeWeight[q.type] ?? 1);
}

const sorted = (a: Attempt[]) => [...a].sort((x, y) => x.createdAt - y.createdAt);

interface Row {
  attemptIdx: number;
  recency: number;
  q: QuizQuestion;
  score: number;
  misconception?: string;
}

function rows(attempts: Attempt[]): Row[] {
  const s = sorted(attempts);
  return s.flatMap((a, i) => {
    const ev = new Map(a.evaluations.map((e) => [e.questionId, e]));
    const recency = Math.pow(M.recencyDecay, s.length - 1 - i);
    return a.questions
      .filter((q) => ev.has(q.id))
      .map((q) => ({ attemptIdx: i, recency, q, score: ev.get(q.id)!.score, misconception: ev.get(q.id)!.misconception }));
  });
}

/** Weighted mastery for every topic across all attempts. */
export function masteryByTopic(attempts: Attempt[]): Map<string, { mastery: number; n: number }> {
  const acc = new Map<string, { w: number; e: number; n: number }>();
  for (const r of rows(attempts)) {
    const w = r.recency * questionWeight(r.q);
    const cur = acc.get(r.q.topicId) ?? { w: 0, e: 0, n: 0 };
    cur.w += w;
    cur.e += w * r.score;
    cur.n += 1;
    acc.set(r.q.topicId, cur);
  }
  const out = new Map<string, { mastery: number; n: number }>();
  for (const [k, v] of acc) out.set(k, { mastery: v.w ? v.e / v.w : 0, n: v.n });
  return out;
}

/** Per-topic score for one attempt, weighted by marks (used by the progress dashboard). */
export function attemptTopicScores(a: Attempt): Record<string, number> {
  const ev = new Map(a.evaluations.map((e) => [e.questionId, e]));
  const acc: Record<string, { e: number; t: number }> = {};
  for (const q of a.questions) {
    const e = ev.get(q.id);
    if (!e) continue;
    const m = q.marks || 1;
    acc[q.topicId] = acc[q.topicId] ?? { e: 0, t: 0 };
    acc[q.topicId].e += e.score * m;
    acc[q.topicId].t += m;
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.t ? v.e / v.t : 0]));
}

/** Marks-weighted score of one attempt. */
export function attemptScore(a: Attempt): number {
  const ev = new Map(a.evaluations.map((e) => [e.questionId, e]));
  let e = 0;
  let t = 0;
  for (const q of a.questions) {
    const x = ev.get(q.id);
    if (!x) continue;
    e += x.score * (q.marks || 1);
    t += q.marks || 1;
  }
  return t ? e / t : 0;
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function buildGapReport(data: StudentData): GapReport {
  const all = rows(data.attempts);
  const attempts = sorted(data.attempts);
  const latestIdx = attempts.length - 1;
  const latest = attempts[latestIdx];
  const mastery = masteryByTopic(data.attempts);
  const maxWeight = Math.max(1, ...data.topics.map((t) => t.examWeight));
  const chunkById = new Map(data.chunks.map((c) => [c.id, c]));

  // misconception counts per topic (recurring = seen more than once)
  const misByTopic = new Map<string, Map<string, number>>();
  for (const r of all)
    if (r.misconception && r.score < 0.6) {
      const m = misByTopic.get(r.q.topicId) ?? new Map<string, number>();
      m.set(r.misconception, (m.get(r.misconception) ?? 0) + 1);
      misByTopic.set(r.q.topicId, m);
    }

  // which topics are prerequisites of other topics (used to boost priority)
  const prereqOf = new Map<string, string[]>();
  for (const t of data.topics) for (const p of t.prerequisites ?? []) prereqOf.set(p, [...(prereqOf.get(p) ?? []), t.id]);

  const firstPass = data.topics.map((t) => {
    const m = mastery.get(t.id);
    return { t, m, level: levelFor(m?.mastery ?? 0, m?.n ?? 0) };
  });
  const levelById = new Map(firstPass.map((x) => [x.t.id, x.level]));

  const topics: TopicStatus[] = firstPass.map(({ t, m, level }) => {
    const tr = all.filter((r) => r.q.topicId === t.id);
    const latestRows = tr.filter((r) => r.attemptIdx === latestIdx);
    const attempted = latestRows.length;
    const earned = latestRows.reduce((s, r) => s + r.score, 0);
    const n = m?.n ?? 0;
    const confidence = confidenceFor(n);

    // subtopics with mistakes in the latest attempt that covered this topic
    const lastIdxForTopic = tr.length ? Math.max(...tr.map((r) => r.attemptIdx)) : -1;
    const lastRows = tr.filter((r) => r.attemptIdx === lastIdxForTopic);
    const wrong = new Map<string, number>();
    lastRows.filter((r) => r.score < 0.6).forEach((r) => wrong.set(r.q.subtopic || t.name, (wrong.get(r.q.subtopic || t.name) ?? 0) + 1));
    const weakSubtopics = [...wrong.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);

    const mis = [...(misByTopic.get(t.id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]);
    const misconceptions = mis.map(([text, c]) => (c > 1 ? `${text} (×${c})` : text));

    // trend between the last two attempts that covered this topic
    const idxs = Array.from(new Set(tr.map((r) => r.attemptIdx))).sort((a, b) => a - b);
    const scoreAt = (i: number) => attemptTopicScores(attempts[i])[t.id];
    const trend = idxs.length >= 2 ? scoreAt(idxs[idxs.length - 1]) - scoreAt(idxs[idxs.length - 2]) : null;

    const evidenceItems: EvidenceItem[] = tr
      .sort((a, b) => b.attemptIdx - a.attemptIdx)
      .slice(0, 8)
      .map((r) => {
        const c = chunkById.get(r.q.citation.chunkId);
        return {
          attempt: r.attemptIdx + 1,
          question: r.q.question,
          subtopic: r.q.subtopic,
          score: r.score,
          citation: c ? citeLabel(c) : citeLabel(r.q.citation),
        };
      });

    const effective = m ? m.mastery : M.untestedAssumption;
    const examShare = t.examWeight / maxWeight;
    const misShare = Math.min(1, mis.reduce((s, [, c]) => s + c, 0) / 3);
    const dependents = (prereqOf.get(t.id) ?? []).filter((id) => levelById.get(id) !== "strong").length;
    const prereqShare = Math.min(1, dependents / 2);
    const P = CONFIG.priority;
    const priority = Number(
      (P.weakness * (1 - effective) + P.examImportance * examShare + P.misconceptions * misShare + P.prerequisite * prereqShare).toFixed(3)
    );

    const needsReassessment = level === "untested" || confidence === "low" || lastIdxForTopic < latestIdx - 1;

    let evidence: string;
    if (!m) evidence = `Not assessed yet — no questions answered. Appears in ${t.examWeight} past-paper question(s).`;
    else {
      const correct = tr.filter((r) => r.score >= 0.6).length;
      evidence =
        (attempted
          ? `Latest quiz: ${fmt(earned)}/${attempted} correct` +
            (weakSubtopics.length && earned < attempted ? `; mistakes mostly in ${weakSubtopics.slice(0, 2).join(" and ")}` : "") +
            ". "
          : "Not in the latest quiz. ") +
        `${correct}/${n} correct across all attempts; weighted mastery ${Math.round(m.mastery * 100)}% (${confidence} confidence). ` +
        `Appears in ${t.examWeight} past-paper question(s).`;
    }

    const focus = (weakSubtopics.length ? weakSubtopics : t.subtopics).slice(0, 2).join(" and ") || t.name;
    const recommendedAction =
      level === "untested"
        ? "Take a diagnostic quiz that includes this topic to measure it."
        : level === "weak"
        ? `Re-learn ${focus} from your notes, write a summary, then answer 3 practice questions.`
        : level === "medium"
        ? `Practise ${focus} with past-paper questions until you reach ${Math.round(M.strong * 100)}%.`
        : "Keep it fresh with a short spaced review.";

    return {
      topicId: t.id,
      name: t.name,
      level,
      mastery: m?.mastery ?? 0,
      confidence,
      attempted,
      earned,
      questionsAttempted: n,
      correctAnswers: tr.filter((r) => r.score >= 0.6).length,
      examWeight: t.examWeight,
      priority,
      weakSubtopics,
      misconceptions,
      evidenceItems,
      trend,
      needsReassessment,
      recommendedAction,
      evidence,
      reason: evidence,
    };
  });

  topics.sort((a, b) => b.priority - a.priority);
  const counts = { weak: 0, medium: 0, strong: 0, untested: 0 } as Record<Level, number>;
  topics.forEach((t) => counts[t.level]++);
  const assessed = topics.filter((t) => t.level !== "untested");
  const misconceptions = topics
    .flatMap((t) => [...(misByTopic.get(t.topicId) ?? new Map()).entries()].map(([text, count]) => ({ text, topicName: t.name, count })))
    .sort((a, b) => b.count - a.count);

  return {
    id: uid("rep"),
    createdAt: Date.now(),
    attemptId: latest?.id ?? "",
    topics,
    overallMastery: assessed.length ? assessed.reduce((s, t) => s + t.mastery, 0) / assessed.length : 0,
    coverage: { assessed: assessed.length, total: topics.length },
    misconceptions,
    summary: `${counts.weak} weak, ${counts.medium} medium, ${counts.strong} strong, ${counts.untested} not assessed.`,
  };
}

/**
 * How many questions to ask per topic in the next diagnostic.
 * First quiz: cover everything. Later quizzes: spend more questions on weak/unassessed topics.
 */
export function questionAllocation(data: StudentData, total: number): Map<string, number> {
  const report = data.reports[data.reports.length - 1];
  const topics = data.topics;
  const out = new Map<string, number>();
  if (!topics.length) return out;
  const weights = topics.map((t) => {
    const st = report?.topics.find((x) => x.topicId === t.id);
    const base = !st || st.level === "untested" ? 2 : st.level === "weak" ? 3 : st.level === "medium" ? 2 : 1;
    return { id: t.id, w: base + t.examWeight * 0.3 + (st?.needsReassessment ? 0.5 : 0) };
  });
  const sum = weights.reduce((s, x) => s + x.w, 0);
  weights.forEach((x) => out.set(x.id, Math.max(1, Math.round((x.w / sum) * total))));
  // trim to the requested total, removing from the lowest-weight topics first
  let current = [...out.values()].reduce((a, b) => a + b, 0);
  const byLowWeight = [...weights].sort((a, b) => a.w - b.w);
  let i = 0;
  while (current > total && i < byLowWeight.length * 3) {
    const id = byLowWeight[i % byLowWeight.length].id;
    if ((out.get(id) ?? 0) > 1 || current - total >= topics.length) {
      out.set(id, (out.get(id) ?? 0) - 1);
      if ((out.get(id) ?? 0) === 0) out.delete(id);
      current--;
    }
    i++;
  }
  return out;
}

/** Scores an objective answer in code. Returns null for types that need rubric evaluation. */
export function scoreDeterministic(q: QuizQuestion, answer: string): { score: number; evidence: string } | null {
  const a = (answer ?? "").trim();
  if (!a) return { score: 0, evidence: "No answer given." };
  switch (q.type) {
    case "mcq":
    case "true_false": {
      const ok = Number(a) === q.answerIndex;
      return { score: ok ? 1 : 0, evidence: `Answer key: option ${String.fromCharCode(65 + (q.answerIndex ?? 0))}.` };
    }
    case "multi_select": {
      const want = new Set(q.answerIndices ?? []);
      const got = new Set(a.split(",").filter(Boolean).map(Number));
      const hits = [...got].filter((x) => want.has(x)).length;
      const wrong = [...got].filter((x) => !want.has(x)).length;
      const score = Math.max(0, (hits - wrong) / Math.max(1, want.size));
      return { score: Number(score.toFixed(2)), evidence: `${hits} of ${want.size} correct options chosen, ${wrong} incorrect option(s) chosen (each wrong pick cancels a right one).` };
    }
    case "fill_blank": {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
      const ok = (q.acceptedAnswers ?? [q.modelAnswer]).some((x) => norm(x) === norm(a));
      return ok ? { score: 1, evidence: "Matches an accepted answer." } : null; // not exact → let the rubric judge synonyms
    }
    case "numerical": {
      const n = Number(a.replace(/[^0-9eE.+-]/g, ""));
      if (!Number.isFinite(n) || q.numericAnswer == null) return { score: 0, evidence: "Not a number." };
      const tol = Math.abs(q.numericAnswer) * (q.tolerance ?? 0.02) || 1e-9;
      const ok = Math.abs(n - q.numericAnswer) <= tol;
      return { score: ok ? 1 : 0, evidence: `Expected ${q.numericAnswer}${q.unit ? " " + q.unit : ""} ±${Math.round((q.tolerance ?? 0.02) * 100)}%; got ${n}.` };
    }
    default:
      return null;
  }
}
