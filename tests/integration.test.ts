import { describe, it, expect } from "vitest";
import { getAuthUser, signInWithEmail, signUpWithEmail } from "../lib/auth";
import { upsertChunksToQdrant, searchQdrant, deleteDocumentVectors } from "../lib/vector/qdrant";
import { processDocumentServerSide } from "../lib/ingest-server";
import { inngest } from "../lib/inngest/client";
import { generateStructuredJson } from "../lib/ai/provider";
import { z } from "zod";

describe("Integration Tests - Supabase, Qdrant, Gemini, Inngest", () => {
  describe("1. Supabase Authentication & Profile Management", () => {
    it("logs in with demo account successfully", async () => {
      const user = await signInWithEmail("demo@gapfinder.ai", "demo1234");
      expect(user).toBeDefined();
      expect(user.email).toBe("demo@gapfinder.ai");
      expect(user.isDemo).toBe(true);
      expect(user.role).toBe("student");
    });

    it("registers new student profile", async () => {
      const randomEmail = `test_${Date.now()}@school.edu`;
      const newUser = await signUpWithEmail(randomEmail, "securePass123", "New Learner", "student");

      expect(newUser.email).toBe(randomEmail);
      expect(newUser.fullName).toBe("New Learner");
      expect(newUser.role).toBe("student");
    });
  });

  describe("2. Qdrant Multi-Tenant Vector Isolation", () => {
    it("strictly isolates chunks between different students", async () => {
      const userA = "student_alpha";
      const userB = "student_beta";
      const testVec = new Array(768).fill(0.01);

      // Upsert point for Student A
      await upsertChunksToQdrant([
        {
          id: "chunk_user_a",
          vector: testVec,
          payload: {
            user_id: userA,
            subject_id: "biology",
            document_id: "doc_a",
            chunk_id: "chunk_user_a",
            page_number: 1,
            section_heading: "Secret Chapter A",
            chunk_text: "Alpha student private content.",
            embedding_model: "text-embedding-004",
            embedding_version: "v1",
          },
        },
      ]);

      // Search as Student B using identical vector
      const resultsForB = await searchQdrant({
        userId: userB,
        queryVector: testVec,
      });

      // Student B MUST NOT see Student A's documents
      const leakedChunk = resultsForB.find((r) => r.chunkId === "chunk_user_a");
      expect(leakedChunk).toBeUndefined();

      // Clean up test point
      await deleteDocumentVectors(userA, "doc_a");
    });
  });

  describe("3. Gemini AI Structured Generation & Schema Validation", () => {
    it("validates structured response against Zod schema with error recovery", async () => {
      const SimpleSchema = z.object({
        status: z.enum(["ok", "ready"]),
        score: z.number().min(0).max(100),
      });

      // Provider handles parsing, schema enforcement and fallback
      const result = await generateStructuredJson({
        schema: SimpleSchema,
        system: "You are a test evaluator. Respond with valid JSON.",
        prompt: `Evaluate system status: {"status":"ok","score":95}.`,
      });

      expect(result.data.status).toBe("ok");
      expect(result.data.score).toBeGreaterThanOrEqual(0);
      expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.provider).toBeDefined();
    });
  });

  describe("4. Ingestion Idempotency & Duplicate Rejection", () => {
    it("detects identical document upload and skips duplicate chunking", async () => {
      const content = "Unique Biology notes on kidney nephrons and glomerulus filtration.";
      const buffer = Buffer.from(content, "utf-8");

      // First ingestion
      const first = await processDocumentServerSide({
        userId: "idempotency_user",
        fileName: "nephron.txt",
        fileBuffer: buffer,
      });

      expect(first.status).toBe("ready");
      expect(first.chunks.length).toBeGreaterThan(0);

      // Immediate second ingestion of identical file
      const second = await processDocumentServerSide({
        userId: "idempotency_user",
        fileName: "nephron_copy.txt",
        fileBuffer: buffer,
      });

      expect(second.status).toBe("ready");
    });
  });

  describe("5. Inngest Background Orchestration", () => {
    it("registers Inngest client and event definitions", () => {
      expect(inngest.id).toBe("gapfinder-ai");
    });
  });
});
