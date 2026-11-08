// AGENT 8 — Personalised Revision Planning (deterministic scheduler). Time is allocated from
// the gap report's priorities; the LLM later only rewrites each block's task text (see /api/plan).
// Guarantees: never schedules more minutes per day than the student has; weakest / most
// exam-important / prerequisite topics first; spaced reviews; a re-test at the end.
import type { GapReport, PlanBlock, PlanDay, Priority, StudentData, StudyPlan, TopicStatus } from "./types";
import { citeLabel, uid } from "./types";
import { truncate } from "./text";
import { CONFIG } from "./config";

const MIN_MINUTES: Record<TopicStatus["level"], number> = { weak: 30, untested: 25, medium: 20, strong: 10 };
const MAX_BLOCK = CONFIG.plan.maxBlockMinutes;
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

/** Days from today until the exam date (inclusive of today, at least 1). */
export function daysUntil(examDate: string, now = new Date()): number {
  const exam = new Date(examDate + "T00:00:00");
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.round((exam.getTime() - today.getTime()) / 86_400_000));
}

const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function priorityLabel(s: TopicStatus): Priority {
  if (s.level === "weak" || s.priority >= 0.5) return "high";
  if (s.level === "medium" || s.level === "untested" || s.priority >= 0.3) return "medium";
  return "low";
}

export function buildPlan(
  data: StudentData,
  report: GapReport,
  days: number,
  hoursPerDay: number,
  examDate?: string
): StudyPlan {
  const cap = Math.round(hoursPerDay * 60);
  const retestMinutes = cap >= 45 ? CONFIG.plan.retestMinutes : 0;
  const budget = days * cap - retestMinutes;
  const topicsById = new Map(data.topics.map((t) => [t.id, t]));
  const chunkById = new Map(data.chunks.map((c) => [c.id, c]));

  // 1) allocate minutes by priority^1.5, respecting a per-level minimum
  let statuses = [...report.topics].sort((a, b) => b.priority - a.priority);
  const weight = (s: TopicStatus) => Math.pow(Math.max(0.05, s.priority), 1.5);
  let alloc = new Map<string, number>();
  const allocate = () => {
    alloc = new Map();
    const sum = statuses.reduce((s, x) => s + weight(x), 0) || 1;
    statuses.forEach((s) => alloc.set(s.topicId, Math.max(MIN_MINUTES[s.level], round5((budget * weight(s)) / sum))));
  };
  allocate();
  // if minimums overflow the budget, drop the lowest-priority (strongest) topics
  while ([...alloc.values()].reduce((a, b) => a + b, 0) > budget * 1.05 && statuses.length > 1) {
    statuses = statuses.slice(0, -1);
    allocate();
  }
  const total = [...alloc.values()].reduce((a, b) => a + b, 0);
  if (total > budget) for (const [k, v] of alloc) alloc.set(k, Math.max(5, Math.floor((v * budget) / total / 5) * 5));

  // 2) turn allocations into blocks: main study + a spaced review later
  const main: PlanBlock[] = [];
  const reviews: PlanBlock[] = [];
  for (const s of statuses) {
    const minutes = alloc.get(s.topicId) ?? 0;
    const t = topicsById.get(s.topicId);
    const sources = Array.from(
      new Set(
        (t?.sourceChunkIds ?? [])
          .map((id) => chunkById.get(id))
          .filter(Boolean)
          .map((c) => citeLabel(c!))
      )
    );
    const focus = (s.weakSubtopics.length ? s.weakSubtopics : t?.subtopics ?? []).slice(0, 3);
    const pq = data.pastQuestions.find((q) => q.topicId === s.topicId);
    const kind: PlanBlock["kind"] =
      s.level === "weak" || s.level === "untested" ? "learn" : s.level === "medium" ? "practice" : "review";
    const reviewPart = (s.level === "weak" || s.level === "medium") && minutes >= 30 ? round5(minutes * 0.2) : 0;
    let left = minutes - reviewPart;
    while (left > 0) {
      const m = Math.min(MAX_BLOCK, left);
      main.push(block(s, kind, m, focus, sources, pq?.text));
      left -= m;
    }
    if (reviewPart) reviews.push(block(s, "review", reviewPart, focus, sources));
  }

  // 3) pack into days (interleaved by priority, reviews ≥ 2 days later)
  const start = new Date();
  const schedule: PlanDay[] = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    date: examDate ? localISO(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)) : undefined,
    blocks: [],
  }));
  const used = new Array(days).fill(0);
  const dayCap = (d: number) => cap - (d === days - 1 ? retestMinutes : 0);
  const firstDayOf = new Map<string, number>();

  const place = (b: PlanBlock, fromDay: number) => {
    // short blocks are kept whole if any day from `fromDay` has room for them
    if (b.minutes <= 45) {
      for (let d = fromDay; d < days; d++)
        if (dayCap(d) - used[d] >= b.minutes) {
          schedule[d].blocks.push({ ...b, id: uid("blk") });
          used[d] += b.minutes;
          if (!firstDayOf.has(b.topicId)) firstDayOf.set(b.topicId, d);
          return true;
        }
    }
    let remaining = b.minutes;
    for (let d = fromDay; d < days && remaining > 0; d++) {
      const free = dayCap(d) - used[d];
      if (free < 15 && free < remaining) continue;
      const m = Math.min(free, remaining);
      if (m <= 0) continue;
      schedule[d].blocks.push({ ...b, id: uid("blk"), minutes: m });
      used[d] += m;
      remaining -= m;
      if (!firstDayOf.has(b.topicId)) firstDayOf.set(b.topicId, d);
    }
    return remaining <= 0;
  };

  // interleave: every topic's 1st block (in priority order), then every 2nd block, …
  const nth = new Map<string, number>();
  const ordered = main
    .map((b, i) => {
      const k = nth.get(b.topicId) ?? 0;
      nth.set(b.topicId, k + 1);
      return { b, k, i };
    })
    .sort((x, y) => x.k - y.k || x.i - y.i)
    .map((x) => x.b);
  for (const b of ordered) place(b, 0);
  for (const r of reviews) {
    const from = Math.min(days - 1, (firstDayOf.get(r.topicId) ?? 0) + 2);
    if (!place(r, from)) place(r, 0);
  }
  if (retestMinutes) {
    schedule[days - 1].blocks.push({
      id: uid("blk"),
      topicId: "all",
      topicName: "Follow-up assessment",
      minutes: retestMinutes,
      kind: "retest",
      priority: "high",
      activity: "Take a new diagnostic quiz. Your gap report and this plan will update automatically from the results.",
      focus: [],
      sources: [],
      successCriteria: "Every topic you revised this week moves up at least one level.",
    });
  }

  return { createdAt: Date.now(), reportId: report.id, days, hoursPerDay, examDate, schedule, aiEnhanced: false };
}

function block(
  s: TopicStatus,
  kind: PlanBlock["kind"],
  minutes: number,
  focus: string[],
  sources: string[],
  pastQ?: string
): PlanBlock {
  const f = focus.length ? focus.join(", ") : s.name;
  const target = Math.round(CONFIG.mastery.strong * 100);
  const activity =
    kind === "learn"
      ? `Re-learn ${s.name} from your notes, concentrating on ${f}. Write a one-page summary in your own words, then answer the practice question below without notes.`
      : kind === "practice"
      ? `Practise ${s.name}: re-read the sections below for ${f}, answer 3 questions from memory, and check them against the notes.`
      : `Quick recall of ${s.name}: list the key points of ${f} without notes, then check them against the source.`;
  const successCriteria =
    kind === "learn"
      ? `You can explain ${f} without notes, and score ${target}%+ on ${s.name} in the next quiz.`
      : kind === "practice"
      ? `3/3 practice answers match the notes; reach ${target}% on ${s.name} next quiz.`
      : `All key points recalled correctly.`;
  return {
    id: uid("blk"),
    topicId: s.topicId,
    topicName: s.name,
    minutes,
    kind,
    priority: kind === "review" && s.level !== "weak" ? "low" : priorityLabel(s),
    activity,
    focus,
    sources: sources.slice(0, 2),
    practice: pastQ ? truncate(pastQ, 220) : undefined,
    successCriteria,
  };
}
