// Shared data model for GapFinder AI.
// Everything a student owns lives in one StudentData object (persisted per account).

export type MaterialKind = "syllabus" | "notes" | "past_paper";
/** Document lifecycle shown in the UI: Uploaded → Processing → Analyzed → Indexed → Ready */
export type DocStatus = "uploaded" | "processing" | "analyzed" | "indexed" | "ready" | "error";

export interface Material {
  id: string;
  name: string;
  kind: MaterialKind;
  detectedKind?: MaterialKind; // what the Ingestion Agent thinks the document is
  pages: string[]; // raw text, one entry per PDF page (or one entry for text input)
  createdAt: number;
  status: DocStatus;
  hash: string; // content fingerprint for duplicate detection
  wordCount: number;
  headings: string[];
  warnings: string[]; // e.g. "page 4 has almost no text (scanned?)"
}

/** A retrievable unit of source text. Citations always point at a chunk. */
export interface Chunk {
  id: string;
  materialId: string;
  materialName: string;
  kind: MaterialKind;
  section: string; // nearest heading above the chunk, e.g. "Chapter 3 > 3.2 Light reaction"
  page: number; // 1-based
  text: string;
}

export interface Topic {
  id: string;
  name: string;
  description: string;
  chapter?: string;
  subtopics: string[];
  keywords: string[];
  learningObjectives: string[];
  prerequisites: string[]; // topic ids that should be understood first
  examWeight: number; // # past-paper questions mapped to this topic
  sourceChunkIds: string[]; // where this topic is covered in notes (retrieval)
  edited?: boolean; // the student changed it by hand
}

export type Difficulty = "easy" | "medium" | "hard";

export interface PastQuestion {
  id: string;
  text: string;
  materialName: string;
  topicId: string | null;
  matchScore: number; // BM25 score of the mapping (transparency)
  confidence: number; // 0..1 mapping confidence
  needsReview: boolean; // low confidence → ask the student instead of guessing
  marks: number | null;
  qtype: string; // define / explain / describe / differentiate / numerical / diagram / …
  difficulty: Difficulty;
  manual?: boolean; // topic assigned by the student
}

export interface Citation {
  chunkId: string;
  materialName: string;
  section: string;
  page: number;
  quote: string;
}

export type QuestionType = "mcq" | "multi_select" | "true_false" | "fill_blank" | "short" | "numerical";

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  topicId: string;
  topicName: string;
  subtopic: string;
  difficulty: Difficulty;
  marks: number;
  question: string;
  options?: string[]; // mcq, multi_select, true_false
  answerIndex?: number; // mcq, true_false
  answerIndices?: number[]; // multi_select
  acceptedAnswers?: string[]; // fill_blank
  numericAnswer?: number; // numerical
  tolerance?: number; // numerical, relative (0.02 = ±2%)
  unit?: string;
  rubric?: string[]; // short: key points that earn credit
  modelAnswer: string;
  explanation: string;
  learningObjective?: string;
  misconceptionTags?: string[];
  citation: Citation;
}

export type Correctness = "correct" | "partially_correct" | "incorrect" | "unanswered";
export type Confidence = "low" | "medium" | "high";

export interface Evaluation {
  questionId: string;
  score: number; // 0..1 fraction of marks earned
  correct: boolean;
  correctness?: Correctness;
  method?: "deterministic" | "rubric_ai" | "fallback";
  feedback: string; // why it is right / wrong
  misconception?: string;
  evidence?: string; // rubric points met / missed, or the deterministic rule applied
}

export interface Attempt {
  id: string;
  createdAt: number;
  questions: QuizQuestion[];
  answers: Record<string, string>; // questionId -> answer (indices stored as "0" or "0,2")
  confidence?: Record<string, Confidence>; // student's self-rated confidence per question
  evaluations: Evaluation[];
}

export type Level = "weak" | "medium" | "strong" | "untested";

export interface EvidenceItem {
  attempt: number; // 1-based attempt number
  question: string;
  subtopic: string;
  score: number;
  citation: string;
}

export interface TopicStatus {
  topicId: string;
  name: string;
  level: Level;
  mastery: number; // 0..1, weighted by recency, difficulty and question type
  confidence: Confidence; // how much evidence the mastery is based on
  attempted: number; // questions in the latest attempt that covered this topic
  earned: number; // points earned in that attempt
  questionsAttempted: number; // across all attempts
  correctAnswers: number; // across all attempts
  examWeight: number;
  priority: number; // 0..1, higher = study first
  weakSubtopics: string[];
  misconceptions: string[];
  evidenceItems: EvidenceItem[];
  trend: number | null; // change in topic score between the last two attempts that covered it
  needsReassessment: boolean;
  recommendedAction: string;
  evidence: string; // deterministic, computed from numbers
  reason: string; // AI-written diagnosis (falls back to evidence)
}

export interface GapReport {
  id: string;
  createdAt: number;
  attemptId: string;
  topics: TopicStatus[];
  overallMastery: number; // mean mastery over assessed topics
  coverage: { assessed: number; total: number };
  misconceptions: { text: string; topicName: string; count: number }[];
  summary: string;
}

export type Priority = "high" | "medium" | "low";

export interface PlanBlock {
  id: string;
  topicId: string;
  topicName: string;
  minutes: number;
  kind: "learn" | "practice" | "review" | "retest";
  priority: Priority;
  activity: string;
  focus: string[];
  sources: string[]; // human-readable citations of sections to study
  practice?: string; // a past-paper / practice question to attempt
  successCriteria: string;
  done?: boolean;
}

export interface PlanDay {
  day: number;
  date?: string; // ISO date when an exam date is set
  blocks: PlanBlock[];
}

export interface StudyPlan {
  createdAt: number;
  reportId: string;
  days: number;
  hoursPerDay: number;
  examDate?: string;
  schedule: PlanDay[];
  aiEnhanced: boolean;
}

export type AgentName =
  | "Document Ingestion"
  | "Syllabus Mapping"
  | "Knowledge Retrieval"
  | "Previous Paper Analysis"
  | "Diagnostic Question Generation"
  | "Answer Evaluation"
  | "Knowledge Gap Diagnosis"
  | "Revision Planning"
  | "Progress Monitoring"
  | "Learning Assistant";

export interface AgentRun {
  id: string;
  agent: AgentName;
  at: number;
  ms: number;
  status: "ok" | "fallback" | "error";
  input: string;
  output: string;
}

export interface StudentData {
  version: 2;
  subject: string;
  materials: Material[];
  chunks: Chunk[];
  topics: Topic[];
  pastQuestions: PastQuestion[];
  attempts: Attempt[];
  reports: GapReport[];
  plan: StudyPlan | null;
  planPrefs: { days: number; hoursPerDay: number; examDate?: string };
  agentRuns: AgentRun[];
}

export interface User {
  email: string;
  name: string;
  passHash: string;
  demo?: boolean;
}

export function emptyData(): StudentData {
  return {
    version: 2,
    subject: "My subject",
    materials: [],
    chunks: [],
    topics: [],
    pastQuestions: [],
    attempts: [],
    reports: [],
    plan: null,
    planPrefs: { days: 5, hoursPerDay: 2 },
    agentRuns: [],
  };
}

export function citeLabel(c: { materialName: string; section: string; page: number }): string {
  return `${c.materialName} › ${c.section.split(" > ").pop()} (p. ${c.page})`;
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  mcq: "Multiple choice",
  multi_select: "Select all that apply",
  true_false: "True / false",
  fill_blank: "Fill in the blank",
  short: "Short answer",
  numerical: "Numerical",
};
