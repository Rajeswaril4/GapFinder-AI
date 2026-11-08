// Registry of the ten specialised agents (for documentation and the Agent activity page).
import type { AgentName } from "./types";

export const AGENTS: { name: AgentName; kind: "code" | "ai" | "both"; role: string; where: string }[] = [
  { name: "Document Ingestion", kind: "code", role: "Validates files, extracts text per page, detects type & headings, flags duplicates and poor extraction, chunks with overlap.", where: "lib/ingest.ts, lib/chunk.ts, api/parse" },
  { name: "Syllabus Mapping", kind: "ai", role: "Builds the topic hierarchy (subtopics, objectives, prerequisites) from the syllabus only. Student can edit it.", where: "api/topic-map" },
  { name: "Knowledge Retrieval", kind: "code", role: "BM25 search over the student's own chunks; topic-filtered; selects context and citations.", where: "lib/bm25.ts, lib/retrieval.ts" },
  { name: "Previous Paper Analysis", kind: "code", role: "Splits past papers into questions, reads marks, classifies type/difficulty, maps to topics with confidence, flags low-confidence for review.", where: "lib/retrieval.ts" },
  { name: "Diagnostic Question Generation", kind: "ai", role: "Writes 6 question types from retrieved chunks only; every question is validated (citation, quote, key) before display.", where: "api/quiz" },
  { name: "Answer Evaluation", kind: "both", role: "Objective answers scored by answer key in code; short answers scored against a rubric by the model; explains every mistake.", where: "api/evaluate, lib/analysis.ts" },
  { name: "Knowledge Gap Diagnosis", kind: "both", role: "Weighted mastery, level, confidence and priority in code; the model writes the reasons and next steps.", where: "lib/analysis.ts, api/gap-analysis" },
  { name: "Revision Planning", kind: "both", role: "Scheduler fits time budget and priorities in code; the model writes concrete tasks and success criteria.", where: "lib/planner.ts, api/plan" },
  { name: "Progress Monitoring", kind: "code", role: "Compares each new diagnosis with the previous one, detects level changes and recurring misconceptions, triggers re-planning.", where: "lib/workflows.ts" },
  { name: "Learning Assistant", kind: "ai", role: "Supplementary chat: explanations, mistakes, examples, practice — from retrieved sources with citations.", where: "api/explain" },
];
