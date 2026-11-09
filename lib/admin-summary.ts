// Pure helpers: turn a student's saved study data into the numbers the admin dashboard shows.
// No I/O here, so it is easy to unit test.
import type { Level } from "./types";

export interface StudentSummary {
  subject: string;
  materials: { name: string; kind: string }[];
  topicCount: number;
  attempts: { at: number; questions: number; score: number }[];
  mastery: number | null;
  level: Level;
  coverage: { assessed: number; total: number } | null;
  weakTopics: string[];
  summary: string;
  hasPlan: boolean;
  planDays: number;
}

export function levelOf(mastery: number | null | undefined): Level {
  if (mastery == null) return "untested";
  return mastery >= 0.8 ? "strong" : mastery >= 0.5 ? "medium" : "weak";
}

/** `data` is the StudentData JSON saved in public.student_state (any shape is tolerated). */
export function summarizeStudent(data: any): StudentSummary {
  const d = data ?? {};
  const reports: any[] = Array.isArray(d.reports) ? d.reports : [];
  const last = reports[reports.length - 1];
  const mastery = typeof last?.overallMastery === "number" ? last.overallMastery : null;
  const attempts: any[] = Array.isArray(d.attempts) ? d.attempts : [];
  return {
    subject: String(d.subject ?? ""),
    materials: (Array.isArray(d.materials) ? d.materials : []).map((m: any) => ({ name: String(m.name ?? ""), kind: String(m.kind ?? "") })),
    topicCount: Array.isArray(d.topics) ? d.topics.length : 0,
    attempts: attempts.map((a) => {
      const ev: any[] = Array.isArray(a.evaluations) ? a.evaluations : [];
      return {
        at: Number(a.createdAt ?? 0),
        questions: Array.isArray(a.questions) ? a.questions.length : 0,
        score: ev.length ? ev.reduce((s, e) => s + (Number(e.score) || 0), 0) / ev.length : 0,
      };
    }),
    mastery,
    level: levelOf(mastery),
    coverage: last?.coverage ?? null,
    weakTopics: (Array.isArray(last?.topics) ? last.topics : []).filter((t: any) => t.level === "weak").map((t: any) => String(t.name)),
    summary: String(last?.summary ?? ""),
    hasPlan: !!d.plan,
    planDays: Array.isArray(d.plan?.schedule) ? d.plan.schedule.length : 0,
  };
}
