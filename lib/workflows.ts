"use client";
// ORCHESTRATOR — a deterministic workflow that calls the specialised agents in a fixed order:
// Upload → Topic map → Diagnostic quiz → Evaluate → Gap report → Plan → (re-test → plan updates)
// Retrieval runs here (deterministic BM25 over the student's own chunks); generation happens
// in the /api routes, which only ever receive the chunks selected here. Every agent call is
// logged (agent, input, output, duration, status) and shown on the "Agent activity" page.
import type { AgentName, AgentRun, Attempt, Confidence, GapReport, MaterialKind, QuizQuestion, StudentData, StudyPlan, Topic } from "./types";
import { citeLabel, uid } from "./types";
import { ingest } from "./ingest";
import { Retriever, attachTopicSources, extractPastQuestionsDetailed, mapQuestionsToTopics, topicQuery } from "./retrieval";
import { buildGapReport, questionAllocation } from "./analysis";
import { buildPlan, daysUntil } from "./planner";

// ---------------------------------------------------------------- helpers
export async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export type RunLog = AgentRun[];

/** Runs one agent step and records it. `status` "fallback" means the AI failed and code took over. */
async function track<T>(
  log: RunLog,
  agent: AgentName,
  input: string,
  fn: () => Promise<T> | T,
  output: (r: T) => string,
  status: (r: T) => AgentRun["status"] = () => "ok"
): Promise<T> {
  const t0 = performance.now();
  try {
    const r = await fn();
    log.push({ id: uid("run"), agent, at: Date.now(), ms: Math.round(performance.now() - t0), status: status(r), input, output: output(r) });
    return r;
  } catch (e) {
    log.push({ id: uid("run"), agent, at: Date.now(), ms: Math.round(performance.now() - t0), status: "error", input, output: (e as Error).message });
    throw e;
  }
}

export function withRuns(data: StudentData, log: RunLog): StudentData {
  return { ...data, agentRuns: [...[...log].reverse(), ...(data.agentRuns ?? [])].slice(0, 150) };
}

export async function parseFile(file: File): Promise<{ name: string; pages: string[] }> {
  if (/\.(txt|md)$/i.test(file.name) || file.type.startsWith("text/")) {
    return { name: file.name.replace(/\.(txt|md)$/i, ""), pages: [await file.text()] };
  }
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") throw new Error("Unsupported format. Upload a PDF, .txt or .md file.");
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/parse", { method: "POST", body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Could not read file");
  return json;
}

// ---------------------------------------------------------------- Agents 1, 3, 4: ingestion, retrieval, past papers
/** Deterministic: re-link topics to notes sections and past-paper questions to topics (keeps manual fixes). */
export function remap(data: StudentData): StudentData {
  if (!data.topics.length) return data;
  const r = new Retriever(data.chunks);
  const topics = attachTopicSources(data.topics, r);
  const manual = new Map(data.pastQuestions.filter((q) => q.manual).map((q) => [q.id, q.topicId] as [string, string | null]));
  const qs = data.materials
    .filter((m) => m.kind === "past_paper")
    .flatMap((m) =>
      extractPastQuestionsDetailed(m.pages.join("\n")).map((q, i) => ({ id: `${m.id}_q${i + 1}`, text: q.text, marks: q.marks, materialName: m.name }))
    );
  const aiQs = data.pastQuestions.filter((q) => q.id.startsWith("pq_ai_"));
  const mapped = mapQuestionsToTopics(qs.length ? qs : aiQs, topics, r, manual);
  return { ...data, topics: mapped.topics, pastQuestions: mapped.pastQuestions };
}

export async function addMaterial(
  data: StudentData,
  input: { name: string; kind: MaterialKind; pages: string[] },
  log: RunLog = []
): Promise<{ data: StudentData; duplicateOf?: string; warnings: string[] }> {
  const res = await track(
    log,
    "Document Ingestion",
    `${input.name} (${input.pages.length} page${input.pages.length > 1 ? "s" : ""}, declared ${input.kind})`,
    () => ingest(input, data.materials),
    (r) => `${r.chunks.length} chunks, ${r.material.headings.length} headings, detected ${r.material.detectedKind}` + (r.duplicateOf ? `, duplicate of “${r.duplicateOf}”` : "") + (r.material.warnings.length ? `, ${r.material.warnings.length} warning(s)` : "")
  );
  if (res.duplicateOf) return { data, duplicateOf: res.duplicateOf, warnings: [] };
  let next: StudentData = { ...data, materials: [...data.materials, { ...res.material, status: "ready" }], chunks: [...data.chunks, ...res.chunks] };
  if (next.topics.length) {
    next = await track(log, "Previous Paper Analysis", "re-map after upload", () => remap(next), (d) => `${d.pastQuestions.length} past-paper questions, ${d.pastQuestions.filter((q) => q.needsReview).length} need review`);
  }
  return { data: withRuns(next, log), warnings: res.material.warnings };
}

export function removeMaterial(data: StudentData, id: string): StudentData {
  return remap({
    ...data,
    materials: data.materials.filter((m) => m.id !== id),
    chunks: data.chunks.filter((c) => c.materialId !== id),
  });
}

// ---------------------------------------------------------------- Agent 2: syllabus mapping (+ editing)
interface ApiTopic {
  id: string;
  name: string;
  description: string;
  chapter?: string;
  subtopics: string[];
  keywords: string[];
  learningObjectives: string[];
  prerequisites: string[]; // names
}

/** AI topic map from the syllabus (falls back to notes headings when no syllabus is uploaded). */
export async function buildTopicMap(data: StudentData): Promise<StudentData> {
  const log: RunLog = [];
  const syl = data.materials.filter((m) => m.kind === "syllabus").map((m) => m.pages.join("\n")).join("\n\n");
  const source =
    syl.trim().length > 30
      ? syl
      : "Headings from the student's notes:\n" + Array.from(new Set(data.chunks.filter((c) => c.kind === "notes").map((c) => c.section))).join("\n");
  const papers = data.materials.filter((m) => m.kind === "past_paper");
  const heuristicCount = papers.reduce((s, m) => s + extractPastQuestionsDetailed(m.pages.join("\n")).length, 0);
  const paperText = papers.length && heuristicCount < 2 ? papers.map((m) => m.pages.join("\n")).join("\n\n") : undefined;

  const res = await track(
    log,
    "Syllabus Mapping",
    syl ? `syllabus text (${syl.length} chars)` : "notes headings (no syllabus uploaded)",
    () => post<{ subject: string; topics: ApiTopic[]; questions: string[] }>("/api/topic-map", { syllabus: source, pastPaper: paperText }),
    (r) => `${r.topics.length} topics, ${r.topics.reduce((s, t) => s + t.subtopics.length, 0)} subtopics`
  );

  // keep ids stable for topics that already existed, so progress history survives a rebuild
  const byName = new Map(data.topics.map((t) => [t.name.toLowerCase(), t.id]));
  const idOf = new Map(res.topics.map((t) => [t.name.toLowerCase(), byName.get(t.name.toLowerCase()) ?? t.id]));
  const topics: Topic[] = res.topics.map((t) => ({
    ...t,
    id: idOf.get(t.name.toLowerCase())!,
    prerequisites: t.prerequisites.map((n) => idOf.get(n.toLowerCase())).filter((x): x is string => !!x && x !== idOf.get(t.name.toLowerCase())),
    examWeight: 0,
    sourceChunkIds: [],
  }));
  let next: StudentData = { ...data, subject: res.subject || data.subject, topics };
  if (paperText && res.questions.length)
    next = {
      ...next,
      pastQuestions: res.questions.map((text, i) => ({
        id: `pq_ai_${i + 1}`, text, materialName: papers[0].name, topicId: null, matchScore: 0, confidence: 0, needsReview: true, marks: null, qtype: "other", difficulty: "medium" as const,
      })),
    };
  next = await track(
    log,
    "Previous Paper Analysis",
    `${heuristicCount || res.questions.length} past-paper questions`,
    () => remap(next),
    (d) => `${d.pastQuestions.filter((q) => q.topicId).length} mapped, ${d.pastQuestions.filter((q) => q.needsReview).length} flagged for review`
  );
  return withRuns(next, log);
}

export function updateTopic(data: StudentData, id: string, patch: Partial<Topic>): StudentData {
  return remap({ ...data, topics: data.topics.map((t) => (t.id === id ? { ...t, ...patch, edited: true } : t)) });
}

export function addTopic(data: StudentData, name: string): StudentData {
  const t: Topic = {
    id: uid("t"), name, description: "", subtopics: [], keywords: [], learningObjectives: [], prerequisites: [], examWeight: 0, sourceChunkIds: [], edited: true,
  };
  return remap({ ...data, topics: [...data.topics, t] });
}

export function deleteTopic(data: StudentData, id: string): StudentData {
  return remap({
    ...data,
    topics: data.topics.filter((t) => t.id !== id).map((t) => ({ ...t, prerequisites: t.prerequisites.filter((p) => p !== id) })),
    pastQuestions: data.pastQuestions.map((q) => (q.topicId === id ? { ...q, topicId: null, manual: false } : q)),
  });
}

export function assignPastQuestion(data: StudentData, qid: string, topicId: string | null): StudentData {
  return remap({ ...data, pastQuestions: data.pastQuestions.map((q) => (q.id === qid ? { ...q, topicId, manual: true, needsReview: false } : q)) });
}

// ---------------------------------------------------------------- Agents 3 + 5: retrieval → question generation
export interface QuizBuild {
  questions: QuizQuestion[];
  rejected: { question: string; why: string }[];
  retrieved: number;
  log: RunLog;
}

export async function generateQuiz(data: StudentData, total: number): Promise<QuizBuild> {
  const log: RunLog = [];
  const r = new Retriever(data.chunks);
  const alloc = questionAllocation(data, total);
  const report = data.reports[data.reports.length - 1];
  const avoid = data.attempts.slice(-2).flatMap((a) => a.questions.map((q) => q.question));

  const topics = await track(
    log,
    "Knowledge Retrieval",
    `${alloc.size} topics, ${total} questions`,
    () =>
      data.topics
        .filter((t) => alloc.has(t.id))
        .map((t) => {
          const st = report?.topics.find((x) => x.topicId === t.id);
          const weak = st?.weakSubtopics ?? [];
          // topic sections + sections about the subtopics the student got wrong last time
          const ids = new Set<string>();
          const add = (id: string) => ids.size < 3 && ids.add(id);
          weak.forEach((w) => r.search(`${w} ${t.name}`, 1, ["notes"]).forEach((c) => add(c.id)));
          t.sourceChunkIds.forEach(add);
          r.search(topicQuery(t), 3, ["notes"]).forEach((c) => add(c.id));
          const chunks = [...ids].map((id) => r.get(id)!).filter(Boolean);
          // harder questions for topics the student is already good at, easier for unknown ground
          const difficulty = !st || st.level === "untested" ? "mixed" : st.level === "strong" ? "hard" : st.level === "weak" ? "easy-to-medium" : "medium";
          return {
            topicId: t.id,
            name: t.name,
            subtopics: t.subtopics,
            learningObjectives: t.learningObjectives ?? [],
            weakSubtopics: weak,
            misconceptions: (st?.misconceptions ?? []).slice(0, 3),
            difficulty,
            count: alloc.get(t.id)!,
            chunks: chunks.map((c) => ({ id: c.id, materialName: c.materialName, section: c.section, page: c.page, text: c.text })),
          };
        })
        .filter((t) => t.chunks.length),
    (ts) => `${ts.reduce((s, t) => s + t.chunks.length, 0)} chunks selected for ${ts.length} topics`
  );

  if (!topics.length) throw new Error("No notes found for your topics. Upload textbook chapters or notes first.");
  const res = await track(
    log,
    "Diagnostic Question Generation",
    `${topics.reduce((s, t) => s + t.chunks.length, 0)} chunks, ${total} questions requested`,
    () => post<{ questions: QuizQuestion[]; rejected: { question: string; why: string }[] }>("/api/quiz", { topics, avoid }),
    (x) => `${x.questions.length} accepted, ${x.rejected.length} rejected by validation`
  );
  return { ...res, retrieved: topics.reduce((s, t) => s + t.chunks.length, 0), log };
}

// ---------------------------------------------------------------- Agent 6: evaluation
export async function evaluateAttempt(
  data: StudentData,
  questions: QuizQuestion[],
  answers: Record<string, string>,
  confidence: Record<string, Confidence>,
  log: RunLog = []
): Promise<{ attempt: Attempt; warning?: string }> {
  const byId = new Map(data.chunks.map((c) => [c.id, c]));
  const items = questions.map((q) => ({ q, studentAnswer: answers[q.id] ?? "", source: byId.get(q.citation.chunkId)?.text ?? q.citation.quote }));
  const res = await track(
    log,
    "Answer Evaluation",
    `${items.length} answers`,
    () => post<{ evaluations: Attempt["evaluations"]; warning?: string }>("/api/evaluate", { items }),
    (x) => {
      const det = x.evaluations.filter((e) => e.method === "deterministic").length;
      return `${det} scored by answer key, ${x.evaluations.length - det} by rubric` + (x.warning ? " (AI unavailable — keyword fallback)" : "");
    },
    (x) => (x.warning ? "fallback" : "ok")
  );
  return {
    attempt: { id: uid("att"), createdAt: Date.now(), questions, answers, confidence, evaluations: res.evaluations },
    warning: res.warning,
  };
}

// ---------------------------------------------------------------- Agent 7: diagnosis
/** Deterministic levels + AI-written reasons (falls back to the deterministic evidence). */
export async function analyze(data: StudentData, log: RunLog = []): Promise<{ report: GapReport; warning?: string }> {
  const report = buildGapReport(data);
  const latest = data.attempts.find((a) => a.id === report.attemptId);
  const mistakes = latest
    ? latest.questions
        .map((q) => ({ q, e: latest.evaluations.find((e) => e.questionId === q.id) }))
        .filter((x) => x.e && x.e.score < 0.6)
        .map(({ q, e }) => ({
          topicId: q.topicId,
          subtopic: q.subtopic,
          question: q.question,
          studentAnswer: displayAnswer(q, latest.answers[q.id]),
          feedback: e!.feedback,
          misconception: e!.misconception,
          confidence: latest.confidence?.[q.id],
        }))
    : [];
  try {
    const ai = await track(
      log,
      "Knowledge Gap Diagnosis",
      `${report.topics.length} topics, ${mistakes.length} mistakes`,
      () =>
        post<{ summary: string; reasons: Record<string, string>; actions: Record<string, string> }>("/api/gap-analysis", {
          topics: report.topics.map((t) => ({
            topicId: t.topicId, name: t.name, level: t.level, confidence: t.confidence, evidence: t.evidence, weakSubtopics: t.weakSubtopics, misconceptions: t.misconceptions, trend: t.trend,
          })),
          mistakes,
        }),
      () => report.summary
    );
    report.topics = report.topics.map((t) => ({
      ...t,
      reason: ai.reasons[t.topicId] || t.evidence,
      recommendedAction: ai.actions?.[t.topicId] || t.recommendedAction,
    }));
    if (ai.summary) report.summary = `${report.summary} ${ai.summary}`;
    return { report };
  } catch (e) {
    log.push({ id: uid("run"), agent: "Knowledge Gap Diagnosis", at: Date.now(), ms: 0, status: "fallback", input: "computed evidence", output: report.summary });
    return { report, warning: `AI diagnosis unavailable (${(e as Error).message}); showing the computed evidence instead.` };
  }
}

export function displayAnswer(q: QuizQuestion, a?: string): string {
  if (!a?.trim()) return "(blank)";
  if (q.type === "mcq" || q.type === "true_false") return q.options?.[Number(a)] ?? a;
  if (q.type === "multi_select") return a.split(",").filter(Boolean).map((i) => q.options?.[Number(i)] ?? i).join(", ");
  return a;
}

// ---------------------------------------------------------------- Agent 8: planning
/** Deterministic schedule + AI-written tasks grounded in the scheduled topics' source sections. */
export async function makePlan(
  data: StudentData,
  report: GapReport,
  prefs: { days: number; hoursPerDay: number; examDate?: string },
  log: RunLog = []
): Promise<{ plan: StudyPlan; warning?: string }> {
  const days = prefs.examDate ? Math.min(60, daysUntil(prefs.examDate)) : prefs.days;
  const plan = buildPlan(data, report, days, prefs.hoursPerDay, prefs.examDate);
  const chunkById = new Map(data.chunks.map((c) => [c.id, c]));
  const groups = new Map<string, any>();
  for (const d of plan.schedule)
    for (const b of d.blocks) {
      if (b.kind === "retest") continue;
      const key = `${b.topicId}:${b.kind}`;
      const g = groups.get(key);
      if (g) {
        g.minutes += b.minutes;
        continue;
      }
      const st = report.topics.find((t) => t.topicId === b.topicId);
      const topic = data.topics.find((t) => t.id === b.topicId);
      groups.set(key, {
        key,
        topicName: b.topicName,
        kind: b.kind,
        level: st?.level ?? "untested",
        minutes: b.minutes,
        reason: st?.reason ?? "",
        misconceptions: st?.misconceptions ?? [],
        objectives: topic?.learningObjectives ?? [],
        focus: b.focus,
        pastQuestion: b.practice,
        sources: (topic?.sourceChunkIds ?? [])
          .slice(0, 2)
          .map((id) => chunkById.get(id))
          .filter(Boolean)
          .map((c) => ({ label: citeLabel(c!), text: c!.text })),
      });
    }
  try {
    const ai = await track(
      log,
      "Revision Planning",
      `${days} days × ${prefs.hoursPerDay} h, ${groups.size} task groups`,
      () => post<{ tasks: Record<string, { activity: string; focus: string[]; successCriteria?: string }> }>("/api/plan", { groups: [...groups.values()] }),
      (x) => `${Object.keys(x.tasks).length} tasks written`
    );
    plan.schedule = plan.schedule.map((d) => ({
      ...d,
      blocks: d.blocks.map((b) => {
        const t = ai.tasks[`${b.topicId}:${b.kind}`];
        return t
          ? { ...b, activity: t.activity, focus: t.focus.length ? t.focus : b.focus, successCriteria: t.successCriteria || b.successCriteria }
          : b;
      }),
    }));
    plan.aiEnhanced = true;
    return { plan };
  } catch (e) {
    log.push({ id: uid("run"), agent: "Revision Planning", at: Date.now(), ms: 0, status: "fallback", input: `${days} days`, output: "computed plan" });
    return { plan, warning: `AI task writing unavailable (${(e as Error).message}); showing the computed plan.` };
  }
}

// ---------------------------------------------------------------- Agent 9: progress monitoring (the loop)
/** After a quiz: save attempt → new gap report → compare with previous → plan regenerated automatically. */
export async function completeLoop(
  data: StudentData,
  attempt: Attempt,
  log: RunLog = []
): Promise<{ data: StudentData; warnings: string[] }> {
  const warnings: string[] = [];
  let next: StudentData = { ...data, attempts: [...data.attempts, attempt] };
  const prev = data.reports[data.reports.length - 1];
  const { report, warning } = await analyze(next, log);
  if (warning) warnings.push(warning);

  await track(
    log,
    "Progress Monitoring",
    prev ? "new report vs previous" : "first report",
    () => {
      if (!prev) return [`baseline: ${report.summary}`];
      const changes: string[] = [];
      for (const t of report.topics) {
        const p = prev.topics.find((x) => x.topicId === t.topicId);
        if (p && p.level !== t.level) changes.push(`${t.name} ${p.level} → ${t.level}`);
      }
      report.misconceptions.filter((m) => m.count > 1).forEach((m) => changes.push(`recurring: ${m.text}`));
      return changes.length ? changes : ["no level changes"];
    },
    (c) => c.slice(0, 4).join("; ")
  );

  next = { ...next, reports: [...next.reports, report] };
  const p = await makePlan(next, report, next.planPrefs, log);
  if (p.warning) warnings.push(p.warning);
  return { data: withRuns({ ...next, plan: p.plan }, log), warnings };
}
