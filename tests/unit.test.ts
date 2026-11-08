import { describe, it, expect } from "vitest";
import { buildDemoData } from "../lib/seed";
import { chunkMaterial, isFrontMatterHeading, isFrontMatterPage } from "../lib/chunk";
import { isIndexPage, extractIndexMatter, extractIndexSection, stripFrontMatter } from "../lib/text";
import { extractPastQuestionsDetailed, Retriever, mapQuestionsToTopics } from "../lib/retrieval";
import { computeSha256, extractPagesFromBuffer } from "../lib/ingest-server";
import {
  deterministicFallbackEmbedding,
  cosineSimilarity,
  EMBEDDING_DIMENSION,
} from "../lib/ai/embeddings";
import { reciprocalRankFusion, hybridSearch } from "../lib/vector/hybrid-search";
import {
  scoreDeterministic,
  levelFor,
  confidenceFor,
  masteryByTopic,
  buildGapReport,
} from "../lib/analysis";
import { buildPlan, daysUntil } from "../lib/planner";
import type { QuizQuestion, Material } from "../lib/types";

describe("Unit Tests - GapFinder AI Production Suite", () => {
  const demoData = buildDemoData();

  describe("1. Document Extraction & Chunking", () => {
    it("extracts pages from text and detects empty pages", async () => {
      const text = "Chapter 1: Cell Structure\nCells are the basic unit of life.";
      const buffer = Buffer.from(text, "utf-8");
      const { pages, warnings } = await extractPagesFromBuffer(buffer, "cells.txt", "text/plain");

      expect(pages).toHaveLength(1);
      expect(pages[0]).toContain("Cell Structure");
      expect(warnings).toHaveLength(0);
    });

    it("flags empty or scanned pages", async () => {
      const text = "   \n  ";
      const buffer = Buffer.from(text, "utf-8");
      await expect(extractPagesFromBuffer(buffer, "empty.txt")).rejects.toThrow(
        /does not contain enough readable text/
      );
    });

    it("chunks materials with section headings and page preservation", () => {
      const material: Material = {
        id: "m_test",
        name: "Bio Notes",
        kind: "notes",
        pages: [
          "# Chapter 1 > 1.1 Mitochondria\nMitochondria generate ATP through cellular respiration.\nThey have a double membrane structure.",
          "Inner membrane contains cristae which increase surface area for ATP synthesis.",
        ],
        createdAt: Date.now(),
        status: "ready",
        hash: "hash_123",
        wordCount: 25,
        headings: ["1.1 Mitochondria"],
        warnings: [],
      };

      const chunks = chunkMaterial(material);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].section).toContain("1.1 Mitochondria");
      expect(chunks[0].page).toBe(1);
      expect(chunks[0].text).toContain("cellular respiration");
    });

    it("filters out textbook front-matter pages (editors, committee, preface, pledge) and preserves index & chapters", () => {
      const textbook: Material = {
        id: "m_scert",
        name: "TS-SCERT-Class-10-Biology",
        kind: "notes",
        pages: [
          // Page 1: QR / outcomes
          "SCERT Telangana\nLEARNING OUTCOMES\nThe learner differentiates organisms... how to use QR codes... DIKSHA",
          // Page 2: Editors
          "BIOLOGY CLASS - 10\nEditors\nDr. Kamal Mahendroo, Professor\nDr. Yashodhara Kaneria\nCo-ordinator Dr. T.V.S. Ramesh\nPublished by Government of Telangana",
          // Page 3: Committee
          "Text Book Development Committee\nSri G. Gopal Reddy, Director\nWriters: Dr. T.V.S. Ramesh, Sri Vinjanampati Raghava Rao",
          // Page 4: Intro
          "Intro ...\nWe believe that class-10 education is a key aspect of school education...",
          // Page 5: Academic Standards
          "ACADEMIC STANDARDS\n1. Conceptual understanding\n2. Asking questions and making hypothesis",
          // Page 6: INDEX (Page 11 in actual book)
          "INDEX\n1 Nutrition - Food supplying system (June) 1-27\n2 Respiration - The energy producing system (July) 28-54\n3 Transportation - The circulatory system (August) 55-82",
          // Page 7: Anthem & Pledge
          "OUR NATIONAL ANTHEM\nJana-gana-mana\nPLEDGE\nIndia is my country",
          // Page 8: Chapter 1
          "# Chapter 1 > Nutrition\nAutotrophic nutrition involves photosynthesis where green plants synthesize food using sunlight.",
        ],
        createdAt: Date.now(),
        status: "ready",
        hash: "hash_scert",
        wordCount: 150,
        headings: ["Nutrition"],
        warnings: [],
      };

      const chunks = chunkMaterial(textbook);
      // Pages 1-5 (front matter) and Page 7 (Anthem/Pledge) should NOT be chunked into study material
      const pages = chunks.map((c) => c.page);
      expect(pages).not.toContain(1);
      expect(pages).not.toContain(2);
      expect(pages).not.toContain(3);
      expect(pages).not.toContain(4);
      expect(pages).not.toContain(5);
      expect(pages).not.toContain(7);

      // Page 6 (INDEX) and Page 8 (Chapter 1) SHOULD be preserved
      expect(pages).toContain(6);
      expect(pages).toContain(8);

      const ch1Chunk = chunks.find((c) => c.page === 8);
      expect(ch1Chunk?.text).toContain("Autotrophic nutrition");
    });

    it("extracts authoritative INDEX section from raw textbook text", () => {
      const rawText = `
        SCERT Telangana
        BIOLOGY CLASS - 10
        Editors: Dr. Kamal Mahendroo
        Text Book Development Committee
        Intro ... We believe that class-10 education is important.
        ACADEMIC STANDARDS
        1. Conceptual understanding

        INDEX
        1 Nutrition - Food supplying system (June) 1-27
        2 Respiration - The energy producing system (July) 28-54
        3 Transportation - The circulatory system (August) 55-82
        4 Excretion - The waster disposing system (September) 83-102
        5 Coordination - The linking system (October) 103-128
        6 Reproduction - The generating system (November) 129-160
        7 Coordination in life processes (December) 161-178
        8 Heredity - From parent to progeny (January) 179-204
        9 Our environment - Our concern (February) 205-220
        10 Natural resources (March) 221-240

        OUR NATIONAL ANTHEM
        Jana-gana-mana
        PLEDGE
        India is my country

        Chapter 1 Nutrition
        Life processes require energy...
      `;

      const indexMatter = extractIndexSection(rawText);
      expect(indexMatter).not.toBeNull();
      expect(indexMatter).toContain("1 Nutrition");
      expect(indexMatter).toContain("10 Natural resources");
      expect(indexMatter).not.toContain("Dr. Kamal Mahendroo");
      expect(indexMatter).not.toContain("OUR NATIONAL ANTHEM");
      expect(indexMatter).not.toContain("PLEDGE");
    });

    it("strips front matter from syllabus text", () => {
      const withFrontMatter = `
        Text Book Development Committee
        Sri G. Gopal Reddy, Director
        Intro ...
        Unit 1: Photosynthesis
        Unit 2: Cellular Respiration
      `;
      const stripped = stripFrontMatter(withFrontMatter);
      expect(stripped).toContain("Unit 1: Photosynthesis");
      expect(stripped).toContain("Unit 2: Cellular Respiration");
      expect(stripped).not.toContain("Sri G. Gopal Reddy");
    });
  });

  describe("2. Cryptographic Fingerprinting & Deduplication", () => {
    it("computes deterministic SHA-256 hash", () => {
      const buf1 = Buffer.from("Hello world");
      const buf2 = Buffer.from("Hello world");
      const buf3 = Buffer.from("Hello different world");

      const hash1 = computeSha256(buf1);
      const hash2 = computeSha256(buf2);
      const hash3 = computeSha256(buf3);

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash1).toHaveLength(64);
    });
  });

  describe("3. Dense Embeddings & Cosine Similarity", () => {
    it("generates normalized 768-dimensional fallback embeddings", () => {
      const vec = deterministicFallbackEmbedding("Photosynthesis takes place in chloroplasts");
      expect(vec).toHaveLength(EMBEDDING_DIMENSION);

      let norm = 0;
      for (const val of vec) norm += val * val;
      expect(Math.sqrt(norm)).toBeCloseTo(1, 2);
    });

    it("evaluates cosine similarity accurately", () => {
      const v1 = deterministicFallbackEmbedding("Light reaction of photosynthesis");
      const v2 = deterministicFallbackEmbedding("Light reaction in thylakoids of chloroplast");
      const v3 = deterministicFallbackEmbedding("Renal ultrafiltration in human nephron");

      const simHigh = cosineSimilarity(v1, v2);
      const simLow = cosineSimilarity(v1, v3);

      expect(simHigh).toBeGreaterThan(simLow);
    });
  });

  describe("4. Hybrid Search & Reciprocal Rank Fusion", () => {
    it("calculates RRF correctly", () => {
      const denseRanks = new Map([
        ["chunk_a", 1],
        ["chunk_b", 2],
      ]);
      const sparseRanks = new Map([
        ["chunk_b", 1],
        ["chunk_c", 2],
      ]);

      const rrf = reciprocalRankFusion(denseRanks, sparseRanks, 60);

      // chunk_b is rank 2 in dense, rank 1 in sparse: 1/62 + 1/61
      const expectedB = 1 / 62 + 1 / 61;
      expect(rrf.get("chunk_b")).toBeCloseTo(expectedB, 5);

      // chunk_b should rank first because it matches both dense and sparse
      expect(rrf.get("chunk_b")!).toBeGreaterThan(rrf.get("chunk_a")!);
    });

    it("enforces tenant isolation: rejects search without userId", async () => {
      await expect(
        hybridSearch("water photolysis", demoData.chunks, { userId: "" })
      ).rejects.toThrow(/Security Violation: userId is required/);
    });

    it("retrieves grounded chunks with citations", async () => {
      const results = await hybridSearch("photolysis of water", demoData.chunks, {
        userId: "student_123",
        kinds: ["notes"],
        topK: 3,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].section).toMatch(/Light Reaction/i);
      expect(results[0].metadata.userId).toBe("student_123");
    });
  });

  describe("5. Topic Mapping & Past Paper Analysis", () => {
    it("extracts past-paper questions with marks", () => {
      const paperText = `
        1. Explain the process of digestion in the stomach. [3 marks]
        2. What is the role of bile in fat emulsification? [2 marks]
        3. Define aerobic respiration. (1 mark)
      `;
      const questions = extractPastQuestionsDetailed(paperText);
      expect(questions).toHaveLength(3);
      expect(questions[0].marks).toBe(3);
      expect(questions[1].marks).toBe(2);
      expect(questions[2].marks).toBe(1);
    });

    it("maps past-paper questions to authoritative syllabus topics", () => {
      const retriever = new Retriever(demoData.chunks);
      const mapped = mapQuestionsToTopics(
        [
          { id: "q1", text: "Explain how water moves up through xylem vessels due to transpiration pull.", materialName: "Paper 2023" },
          { id: "q2", text: "Describe nephron function and urine formation.", materialName: "Paper 2023" },
        ],
        demoData.topics,
        retriever
      );

      const q1 = mapped.pastQuestions.find((q) => q.id === "q1")!;
      const q2 = mapped.pastQuestions.find((q) => q.id === "q2")!;

      expect(q1.topicId).toBe("t_trans");
      expect(q2.topicId).toBe("t_exc");
    });
  });

  describe("6. Deterministic Question Scoring", () => {
    const base: QuizQuestion = {
      id: "q_eval",
      type: "mcq",
      topicId: "t_nut",
      topicName: "Nutrition",
      subtopic: "Light Reaction",
      difficulty: "medium",
      marks: 1,
      question: "Where do light reactions take place?",
      options: ["Stroma", "Thylakoid membrane", "Outer membrane", "Matrix"],
      answerIndex: 1,
      modelAnswer: "Thylakoid membrane",
      explanation: "Light reactions occur in the thylakoid membranes.",
      citation: {
        chunkId: "c1",
        materialName: "Notes",
        section: "6.2",
        page: 2,
        quote: "thylakoid membrane",
      },
    };

    it("scores MCQ correctly", () => {
      expect(scoreDeterministic(base, "1")?.score).toBe(1);
      expect(scoreDeterministic(base, "0")?.score).toBe(0);
    });

    it("scores true/false questions", () => {
      const tf = { ...base, type: "true_false" as const, options: ["True", "False"], answerIndex: 0 };
      expect(scoreDeterministic(tf, "0")?.score).toBe(1);
      expect(scoreDeterministic(tf, "1")?.score).toBe(0);
    });

    it("scores multi-select with partial credit and penalty", () => {
      const ms = {
        ...base,
        type: "multi_select" as const,
        options: ["A", "B", "C", "D"],
        answerIndices: [0, 2],
      };
      expect(scoreDeterministic(ms, "0,2")?.score).toBe(1);
      expect(scoreDeterministic(ms, "0")?.score).toBe(0.5);
      expect(scoreDeterministic(ms, "0,1")?.score).toBe(0); // wrong option cancels out credit
    });

    it("scores numerical questions with tolerance", () => {
      const num = {
        ...base,
        type: "numerical" as const,
        numericAnswer: 9.8,
        tolerance: 0.02,
      };
      expect(scoreDeterministic(num, "9.8")?.score).toBe(1);
      expect(scoreDeterministic(num, "9.75 m/s^2")?.score).toBe(1);
      expect(scoreDeterministic(num, "10.5")?.score).toBe(0);
    });

    it("scores exact fill-in-the-blank questions", () => {
      const fib = {
        ...base,
        type: "fill_blank" as const,
        acceptedAnswers: ["chlorophyll", "chloroplast pigments"],
      };
      expect(scoreDeterministic(fib, "Chlorophyll")?.score).toBe(1);
      expect(scoreDeterministic(fib, "mitochondria")).toBeNull();
    });
  });

  describe("7. Evidence-Backed Mastery Diagnosis", () => {
    it("never classifies an unassessed topic as weak", () => {
      expect(levelFor(0, 0)).toBe("untested");
      expect(levelFor(0.4, 0)).toBe("untested");
    });

    it("assigns accurate levels based on deterministic mastery thresholds", () => {
      expect(levelFor(0.85, 3)).toBe("strong");
      expect(levelFor(0.65, 3)).toBe("medium");
      expect(levelFor(0.45, 3)).toBe("weak");
    });

    it("calculates confidence based on evidence count", () => {
      expect(confidenceFor(1)).toBe("low");
      expect(confidenceFor(2)).toBe("medium");
      expect(confidenceFor(5)).toBe("high");
    });

    it("builds evidence-backed gap report with recurring misconceptions", () => {
      const report = buildGapReport(demoData);
      expect(report.topics.length).toBe(demoData.topics.length);
      expect(report.overallMastery).toBeGreaterThan(0);
      expect(report.coverage.assessed).toBe(5);

      const weakTopic = report.topics.find((t) => t.level === "weak");
      expect(weakTopic).toBeDefined();
      expect(weakTopic?.evidence).toContain("correct across all attempts");
    });
  });

  describe("8. Adaptive Revision Scheduling", () => {
    it("never exceeds the daily study time budget", () => {
      const report = buildGapReport(demoData);
      const plan = buildPlan(demoData, report, 5, 2);

      const dailyMinutes = plan.schedule.map((day) =>
        day.blocks.reduce((sum, b) => sum + b.minutes, 0)
      );

      dailyMinutes.forEach((mins) => {
        expect(mins).toBeLessThanOrEqual(120);
      });
    });

    it("prioritizes weakest topics first", () => {
      const report = buildGapReport(demoData);
      const plan = buildPlan(demoData, report, 5, 2);

      expect(plan.schedule[0].blocks[0].topicId).toBe("t_exc");
    });

    it("schedules a follow-up re-test in the final day", () => {
      const report = buildGapReport(demoData);
      const plan = buildPlan(demoData, report, 5, 2);

      const lastDay = plan.schedule[plan.schedule.length - 1];
      const hasRetest = lastDay.blocks.some((b) => b.kind === "retest");
      expect(hasRetest).toBe(true);
    });

    it("computes accurate exam countdown days", () => {
      const target = "2026-11-20";
      const now = new Date("2026-11-10T10:00:00");
      expect(daysUntil(target, now)).toBe(10);
    });
  });

  describe("9. Textbook Front-Matter Filtering & Authoritative Index Extraction", () => {
    it("identifies non-academic front-matter headings correctly", () => {
      expect(isFrontMatterHeading("CLASS - 10")).toBe(true);
      expect(isFrontMatterHeading("EDITORS")).toBe(true);
      expect(isFrontMatterHeading("QR CODE TEAM")).toBe(true);
      expect(isFrontMatterHeading("Text Book Development Committee")).toBe(true);
      expect(isFrontMatterHeading("WRITERS")).toBe(true);
      expect(isFrontMatterHeading("Intro ...")).toBe(true);
      expect(isFrontMatterHeading("Dear Students...")).toBe(true);
      expect(isFrontMatterHeading("ACADEMIC STANDARDS")).toBe(true);
      expect(isFrontMatterHeading("OUR NATIONAL ANTHEM")).toBe(true);
      expect(isFrontMatterHeading("PLEDGE")).toBe(true);

      // Real academic chapter headings are NOT front-matter
      expect(isFrontMatterHeading("Chapter 1 Nutrition")).toBe(false);
      expect(isFrontMatterHeading("2.3 Light and Dark Reactions")).toBe(false);
      expect(isFrontMatterHeading("Transportation in Human Beings")).toBe(false);
    });

    it("identifies front-matter pages from textbook preambles", () => {
      const frontMatterPageText = `
        BIOLOGY CLASS - 10
        Editors
        Dr. Kamal Mahendroo, Professor, Vidya Bhawan Educational Resource Centre
        Dr. Yashodhara Kaneria, Professor
        QR CODE TEAM
        Published by the Government of Telangana, Hyderabad.
      `;
      expect(isFrontMatterPage(frontMatterPageText)).toBe(true);

      const academicPageText = `
        Chapter 1 Nutrition - Food supplying system
        Autotrophic nutrition is the process where organisms synthesize organic food materials
        using inorganic sources like carbon dioxide and water in the presence of sunlight and chlorophyll.
      `;
      expect(isFrontMatterPage(academicPageText)).toBe(false);
    });

    it("extracts authoritative INDEX matter and ignores committee/preface", () => {
      const sampleTextbookPages = [
        "BIOLOGY CLASS - 10\nEditors: Dr. Kamal Mahendroo\nGovernment of Telangana",
        "Text Book Development Committee\nWriters: Dr. T.V.S. Ramesh, Sri Ch. Keshava Rao",
        "Intro ... We believe that class-10 education is a key aspect...",
        "ACADEMIC STANDARDS\nConceptual understanding, Asking questions and making hypothesis",
        `INDEX\n1 Nutrition - Food supplying system 1 - 25 June\n2 Respiration - The energy producing system 26 - 49 July\n3 Transportation - The circulatory system 50 - 75 August\n4 Excretion - The wastage clearing system 76 - 93 September\n5 Coordination - The linking system 94 - 117 October\n6 Reproduction - The generating system 118 - 149 November\n7 Coordination in life processes 150 - 169 December\n8 Heredity - From parent to progeny 170 - 193 January\n9 Our environment - Our concern 194 - 211 February\n10 Natural resources 212 - 231 March`,
        "OUR NATIONAL ANTHEM\nJana-gana-mana-adhinayaka, jaya he\nPLEDGE\nIndia is my country",
        "Chapter 1\nNutrition\nFood supplying system\nAutotrophic nutrition is...",
      ];

      expect(isIndexPage(sampleTextbookPages[4])).toBe(true);
      expect(isIndexPage(sampleTextbookPages[0])).toBe(false);

      const extractedIndex = extractIndexMatter(sampleTextbookPages);
      expect(extractedIndex).not.toBeNull();
      expect(extractedIndex).toContain("INDEX");
      expect(extractedIndex).toContain("1 Nutrition");
      expect(extractedIndex).toContain("4 Excretion");
      expect(extractedIndex).toContain("10 Natural resources");
      expect(extractedIndex).not.toContain("Vidya Bhawan");
      expect(extractedIndex).not.toContain("PLEDGE");
    });

    it("chunks textbook with front-matter tagged cleanly instead of polluting section names", () => {
      const material: Material = {
        id: "m_scert",
        name: "TS-SCERT-Class-10-Biology",
        kind: "notes",
        pages: [
          "BIOLOGY CLASS - 10\nEditors\nDr. Kamal Mahendroo\nGovernment of Telangana",
          "ACADEMIC STANDARDS\nConceptual understanding\nAsking questions and making hypothesis",
          "Chapter 1 Nutrition\nFood supplying system\nPhotosynthesis is the synthesis of carbohydrates from CO2 and water.",
        ],
        createdAt: Date.now(),
        status: "ready",
        hash: "hash_scert",
        wordCount: 50,
        headings: [],
        warnings: [],
      };

      const chunks = chunkMaterial(material);
      expect(chunks.length).toBeGreaterThan(0);

      // Prelim pages should NOT create fake headings like "CLASS - 10" or "ACADEMIC STANDARDS"
      const sections = chunks.map((c) => c.section);
      expect(sections).not.toContain("CLASS - 10");
      expect(sections).not.toContain("ACADEMIC STANDARDS");
      expect(sections.some((s) => s.includes("Nutrition"))).toBe(true);
    });
  });
});
