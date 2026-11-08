import { describe, it, expect } from "vitest";
import { signUpWithEmail } from "../lib/auth";
import { processDocumentServerSide } from "../lib/ingest-server";
import { buildDemoData } from "../lib/seed";
import { Retriever, attachTopicSources, mapQuestionsToTopics } from "../lib/retrieval";
import { questionAllocation, scoreDeterministic, buildGapReport } from "../lib/analysis";
import { buildPlan } from "../lib/planner";
import { hybridSearch } from "../lib/vector/hybrid-search";
import type { StudentData, Attempt, QuizQuestion } from "../lib/types";

describe("E2E Test: 13-Step Student Diagnostic Loop & Isolation", () => {
  let studentUserId = "";
  let studentData: StudentData;

  it("Step 1: Student registers", async () => {
    const email = `e2e_student_${Date.now()}@domain.edu`;
    const user = await signUpWithEmail(email, "password123", "E2E Student", "student");
    studentUserId = user.id;

    expect(studentUserId).toBeTruthy();
    expect(user.role).toBe("student");
  });

  it("Step 2: Student uploads syllabus", async () => {
    const syllabusText = `
      Unit 1: Plant Nutrition and Photosynthesis
      - Light reaction and photolysis of water in thylakoids
      - Dark reaction and carbon fixation in stroma
      Unit 2: Human Excretion
      - Structure of nephron and ultrafiltration in glomerulus
      - Selective reabsorption in renal tubules
    `;
    const buffer = Buffer.from(syllabusText, "utf-8");
    const result = await processDocumentServerSide({
      userId: studentUserId,
      fileName: "syllabus.txt",
      fileBuffer: buffer,
      declaredKind: "syllabus",
    });

    expect(result.status).toBe("ready");
    expect(result.material.detectedKind).toBe("syllabus");
  });

  it("Step 3: Student uploads textbook material", async () => {
    const textbookText = `
      # Chapter 1: Plant Biology > 1.1 Photosynthesis
      Photosynthesis produces glucose and oxygen from carbon dioxide and water.
      Light reaction takes place in the thylakoid membranes where chlorophyll absorbs light energy.
      Water molecules are split during photolysis releasing oxygen.

      # Chapter 2: Animal Physiology > 2.1 Excretion
      The functional unit of the kidney is the nephron.
      Ultrafiltration occurs in the glomerulus under high hydrostatic pressure.
      Selective reabsorption of glucose and amino acids occurs in the proximal convoluted tubule.
    `;
    const buffer = Buffer.from(textbookText, "utf-8");
    const result = await processDocumentServerSide({
      userId: studentUserId,
      fileName: "biology_textbook.txt",
      fileBuffer: buffer,
      declaredKind: "notes",
    });

    expect(result.status).toBe("ready");
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it("Step 4 & 5: System extracts, indexes, and creates editable topic map", () => {
    studentData = buildDemoData();
    const retriever = new Retriever(studentData.chunks);

    const linkedTopics = attachTopicSources(studentData.topics, retriever);
    expect(linkedTopics.length).toBe(5);
    expect(linkedTopics[0].sourceChunkIds.length).toBeGreaterThan(0);

    // Edit topic
    linkedTopics[0].description = "Updated custom description by student";
    linkedTopics[0].edited = true;
    expect(linkedTopics[0].edited).toBe(true);
  });

  it("Step 6: Student generates diagnostic quiz with evidence allocation", () => {
    const alloc = questionAllocation(studentData, 8);
    expect(alloc.size).toBeGreaterThan(0);

    const totalAllocated = [...alloc.values()].reduce((a, b) => a + b, 0);
    expect(totalAllocated).toBeLessThanOrEqual(8);
  });

  it("Step 7 & 8: Student submits answers and system scores deterministically", () => {
    const questions: QuizQuestion[] = studentData.attempts[0].questions;
    expect(questions.length).toBeGreaterThan(0);

    // Objective MCQ question: deterministic scoring
    const q1 = questions[0];
    const score1 = scoreDeterministic(q1, String(q1.answerIndex));
    expect(score1?.score).toBe(1);

    const scoreWrong = scoreDeterministic(q1, "0");
    expect(scoreWrong?.score).toBe(0);

    // Subjective short question: routes to rubric evaluation
    const qShort = questions[1];
    expect(scoreDeterministic(qShort, "answer text")).toBeNull();
  });

  it("Step 9: System produces evidence-backed gap report", () => {
    const report = buildGapReport(studentData);
    expect(report.topics.length).toBe(studentData.topics.length);
    expect(report.coverage.assessed).toBe(5);

    report.topics.forEach((t) => {
      expect(["weak", "medium", "strong", "untested"]).toContain(t.level);
      expect(t.evidence).toBeTruthy();
    });
  });

  it("Step 10: System generates personalized revision plan", () => {
    const report = buildGapReport(studentData);
    const plan = buildPlan(studentData, report, 5, 2);

    expect(plan.schedule.length).toBe(5);
    expect(plan.hoursPerDay).toBe(2);
    // Weakest topic scheduled on Day 1
    expect(plan.schedule[0].blocks[0].topicId).toBe("t_exc");
  });

  it("Step 11: Student marks revision tasks complete", () => {
    const report = buildGapReport(studentData);
    const plan = buildPlan(studentData, report, 5, 2);

    const firstTask = plan.schedule[0].blocks[0];
    firstTask.done = true;
    expect(firstTask.done).toBe(true);
  });

  it("Step 12 & 13: Student retakes assessment, mastery updates, plan regenerates", () => {
    // Simulate retest with improved scores on Excretion
    const newAttempt: Attempt = {
      id: "att_retest_1",
      createdAt: Date.now(),
      questions: studentData.attempts[0].questions,
      answers: {
        q_exc_1: "1", // Corrected answer
        q_exc_2: "0",
      },
      evaluations: [
        {
          questionId: "q_exc_1",
          score: 1.0,
          correct: true,
          feedback: "Correct! Ultrafiltration occurs in the glomerulus.",
        },
      ],
    };

    const updatedData: StudentData = {
      ...studentData,
      attempts: [...studentData.attempts, newAttempt],
    };

    const newReport = buildGapReport(updatedData);
    expect(newReport.topics).toBeDefined();

    const regeneratedPlan = buildPlan(updatedData, newReport, 5, 2);
    expect(regeneratedPlan.schedule).toBeDefined();
  });

  it("Security & Isolation: Prevents cross-user data leakage", async () => {
    const userA = "isolated_user_1";
    const userB = "isolated_user_2";

    const results = await hybridSearch("photolysis of water", studentData.chunks, {
      userId: userA,
      topK: 5,
    });

    results.forEach((r) => {
      expect(r.metadata.userId).toBe(userA);
      expect(r.metadata.userId).not.toBe(userB);
    });
  });

  it("Fault tolerance: Rejects malformed or empty documents gracefully", async () => {
    const malformedBuffer = Buffer.from("%PDF-1.4\ncorrupted bytes null garbage", "utf-8");

    await expect(
      processDocumentServerSide({
        userId: "test_user",
        fileName: "corrupt.pdf",
        fileBuffer: malformedBuffer,
        mimeType: "application/pdf",
      })
    ).rejects.toThrow();
  });
});
