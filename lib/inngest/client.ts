// Inngest client configuration for durable background workflows.
// Handles events, automatic retries, idempotency keys, and step execution.

import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "gapfinder-ai",
  eventKey: process.env.INNGEST_EVENT_KEY,
  isDev: process.env.NODE_ENV !== "production",
});

// Event type definitions for type-safe event dispatch
export type GapFinderEvents = {
  "document/ingest.requested": {
    data: {
      userId: string;
      documentId: string;
      subjectId?: string;
      fileName: string;
      fileUrl?: string;
      declaredKind: "syllabus" | "notes" | "past_paper";
      hash?: string;
    };
  };
  "syllabus/map.requested": {
    data: {
      userId: string;
      subjectId: string;
      syllabusText: string;
      pastPaperText?: string;
    };
  };
  "embeddings/index.requested": {
    data: {
      userId: string;
      documentId: string;
      chunkIds: string[];
      texts: string[];
    };
  };
  "past-paper/analyze.requested": {
    data: {
      userId: string;
      subjectId: string;
      documentId: string;
      paperText: string;
    };
  };
  "diagnostic/generate.requested": {
    data: {
      userId: string;
      quizId: string;
      topicIds: string[];
      totalQuestions: number;
    };
  };
  "attempt/evaluate.requested": {
    data: {
      userId: string;
      attemptId: string;
      answers: Record<string, string>;
      confidence: Record<string, string>;
    };
  };
  "mastery/update.requested": {
    data: {
      userId: string;
      attemptId: string;
    };
  };
  "plan/generate.requested": {
    data: {
      userId: string;
      reportId: string;
      days: number;
      hoursPerDay: number;
      examDate?: string;
    };
  };
};
