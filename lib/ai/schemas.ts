import { z } from "zod";

export const DifficultySchema = z.enum(["easy", "medium", "hard"]);
export const QuestionTypeSchema = z.enum([
  "mcq",
  "multi_select",
  "true_false",
  "fill_blank",
  "short",
  "numerical",
]);

// ---------------- Topic Map Schemas ----------------
export const GeneratedTopicSchema = z.object({
  name: z.string().min(2),
  description: z.string().default(""),
  chapter: z.string().optional().nullable(),
  subtopics: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  learningObjectives: z.array(z.string()).default([]),
  prerequisites: z.array(z.string()).default([]),
});

export const TopicMapResultSchema = z.object({
  subject: z.string().default("My Subject"),
  topics: z.array(GeneratedTopicSchema).min(1),
  questions: z.array(z.string()).optional(),
});

// ---------------- Quiz Generation Schemas ----------------
export const GeneratedQuizQuestionSchema = z.object({
  topicId: z.string(),
  subtopic: z.string().default(""),
  type: QuestionTypeSchema,
  difficulty: DifficultySchema.default("medium"),
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

export const QuizResultSchema = z.object({
  questions: z.array(GeneratedQuizQuestionSchema),
});

// ---------------- Evaluation Schemas ----------------
export const EvaluatedItemSchema = z.object({
  questionId: z.string(),
  score: z.coerce.number().min(0).max(1).default(0),
  pointsMet: z.array(z.string()).optional().nullable(),
  pointsMissed: z.array(z.string()).optional().nullable(),
  feedback: z.string().default(""),
  misconception: z.string().optional().nullable(),
});

export const EvaluationResultSchema = z.object({
  evaluations: z.array(EvaluatedItemSchema),
});

// ---------------- Gap Analysis Schemas ----------------
export const TopicAnalysisItemSchema = z.object({
  topicId: z.string(),
  reason: z.string(),
  action: z.string().optional().nullable(),
});

export const GapAnalysisResultSchema = z.object({
  summary: z.string().default(""),
  topics: z.array(TopicAnalysisItemSchema),
});

// ---------------- Revision Plan Schemas ----------------
export const PlanTaskItemSchema = z.object({
  key: z.string(),
  activity: z.string(),
  focus: z.array(z.string()).default([]),
  successCriteria: z.string().optional().nullable(),
});

export const PlanResultSchema = z.object({
  tasks: z.array(PlanTaskItemSchema),
});
