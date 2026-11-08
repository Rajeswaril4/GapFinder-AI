// Sanity tests for the deterministic core (retrieval, mapping, gap analysis, planner).
// Run: npx tsx tests/core.test.ts
import assert from "node:assert/strict";
import { buildDemoData } from "../lib/seed";
import { Retriever, extractPastQuestions } from "../lib/retrieval";
import { questionAllocation } from "../lib/analysis";
import { overlapRatio } from "../lib/text";
import { scoreDeterministic, confidenceFor, levelFor } from "../lib/analysis";
import { ingest, detectKind } from "../lib/ingest";
import { buildPlan, daysUntil } from "../lib/planner";
import type { QuizQuestion } from "../lib/types";

const d = buildDemoData();

// chunking
assert.ok(d.chunks.length >= 10, "chunks created");
assert.ok(d.chunks.some((c) => c.section.includes("6.2 Light Reaction")), "section headings detected");
assert.ok(d.chunks.some((c) => c.page === 3), "page numbers tracked");

// retrieval
const r = new Retriever(d.chunks);
const top = r.search("what is photolysis of water", 1, ["notes"])[0];
assert.match(top.section, /Light Reaction/, "BM25 finds the light reaction section");
assert.match(r.search("why do muscles get cramps", 1, ["notes"])[0].section, /Respiration/);

// past paper extraction + mapping
assert.equal(extractPastQuestions(d.materials[2].pages[0]).length, 12, "12 past questions extracted");
const byTopic = Object.fromEntries(d.topics.map((t) => [t.id, t.examWeight]));
console.log("exam weights", byTopic);
const unmapped = d.pastQuestions.filter((q) => !q.topicId);
assert.equal(unmapped.length, 0, "every past question mapped");
const wrong = d.pastQuestions.filter((q) => {
  const expect: Record<string, string> = {
    pq_1: "t_nut", pq_2: "t_dig", pq_3: "t_nut", pq_4: "t_resp", pq_5: "t_trans", pq_6: "t_exc",
    pq_7: "t_nut", pq_8: "t_resp", pq_9: "t_dig", pq_10: "t_nut", pq_11: "t_trans", pq_12: "t_exc",
  };
  return expect[q.id] !== q.topicId;
});
assert.equal(wrong.length, 0, "mapping correct: " + JSON.stringify(wrong.map((w) => [w.id, w.topicId])));

// seeded citations are grounded
for (const a of d.attempts)
  for (const q of a.questions) {
    const c = d.chunks.find((x) => x.id === q.citation.chunkId)!;
    assert.ok(c.text.includes(q.citation.quote), "seed quote inside cited chunk: " + q.id);
    assert.ok(overlapRatio(q.citation.quote, c.text) > 0.9);
  }

// gap report
const rep = d.reports[1];
console.log(rep.topics.map((t) => `${t.name}: ${t.level} m=${t.mastery.toFixed(2)} p=${t.priority}`).join("\n"));
assert.equal(rep.topics.find((t) => t.topicId === "t_exc")!.level, "weak");
assert.equal(rep.topics.find((t) => t.topicId === "t_trans")!.level, "strong");
assert.ok(rep.topics.find((t) => t.topicId === "t_exc")!.misconceptions.some((m) => m.includes("×2")), "recurring misconception detected");
assert.equal(rep.coverage.assessed, 5);
assert.ok(rep.topics.every((t) => t.evidenceItems.length > 0), "every assessed topic has evidence");
assert.equal(d.reports[0].topics.find((t) => t.topicId === "t_nut")!.level, "weak");
assert.equal(rep.topics.find((t) => t.topicId === "t_nut")!.level, "medium", "nutrition improved");
assert.equal(rep.topics[0].topicId, "t_exc", "weakest topic first");

// plan
const plan = d.plan!;
const perDay = plan.schedule.map((day) => day.blocks.reduce((s, b) => s + b.minutes, 0));
console.log("minutes per day", perDay);
perDay.forEach((m) => assert.ok(m <= plan.hoursPerDay * 60, "day fits time budget"));
assert.ok(perDay.reduce((a, b) => a + b, 0) >= plan.days * plan.hoursPerDay * 60 * 0.8, "uses most of the time");
assert.equal(plan.schedule[0].blocks[0].topicId, "t_exc", "plan starts with weakest topic");
assert.ok(plan.schedule.at(-1)!.blocks.some((b) => b.kind === "retest"));

// allocation
const alloc = questionAllocation(d, 10);
const total = [...alloc.values()].reduce((a, b) => a + b, 0);
console.log("allocation", Object.fromEntries(alloc));
assert.ok(total <= 10 && total >= 5);
assert.ok((alloc.get("t_exc") ?? 0) >= (alloc.get("t_trans") ?? 0), "weak topic gets more questions");

// thresholds + not assessed + confidence
assert.equal(levelFor(0.79, 3), "medium");
assert.equal(levelFor(0.8, 3), "strong");
assert.equal(levelFor(0.49, 3), "weak");
assert.equal(levelFor(0, 0), "untested", "no answers ⇒ not assessed, never weak");
assert.equal(confidenceFor(1), "low");
assert.equal(confidenceFor(4), "high");

// deterministic scoring
const base = { id: "x", topicId: "t", topicName: "T", subtopic: "s", difficulty: "medium", marks: 1, question: "q", modelAnswer: "m", explanation: "", citation: { chunkId: "c", materialName: "M", section: "S", page: 1, quote: "" } } as const;
const q = (o: Partial<QuizQuestion>) => ({ ...base, ...o }) as QuizQuestion;
assert.equal(scoreDeterministic(q({ type: "mcq", options: ["a", "b", "c", "d"], answerIndex: 2 }), "2")!.score, 1);
assert.equal(scoreDeterministic(q({ type: "true_false", options: ["True", "False"], answerIndex: 1 }), "0")!.score, 0);
assert.equal(scoreDeterministic(q({ type: "multi_select", answerIndices: [0, 2, 3] }), "0,2")!.score, 0.67);
assert.equal(scoreDeterministic(q({ type: "multi_select", answerIndices: [0, 2, 3] }), "0,1")!.score, 0, "wrong pick cancels a right one");
assert.equal(scoreDeterministic(q({ type: "numerical", numericAnswer: 9.8, tolerance: 0.02 }), "9.75 m/s2")!.score, 1);
assert.equal(scoreDeterministic(q({ type: "numerical", numericAnswer: 9.8, tolerance: 0.02 }), "9.5")!.score, 0);
assert.equal(scoreDeterministic(q({ type: "fill_blank", acceptedAnswers: ["Haemoglobin", "hemoglobin"] }), " hemoglobin ")!.score, 1);
assert.equal(scoreDeterministic(q({ type: "fill_blank", acceptedAnswers: ["haemoglobin"] }), "blood"), null, "near-miss goes to the rubric");
assert.equal(scoreDeterministic(q({ type: "short" }), "anything"), null);
assert.equal(scoreDeterministic(q({ type: "mcq", answerIndex: 0 }), "")!.score, 0);

// ingestion
assert.equal(detectKind(d.materials[2].pages[0]), "past_paper");
assert.equal(detectKind(d.materials[0].pages[0]), "syllabus");
assert.equal(detectKind(d.materials[1].pages.join("\n")), "notes");
const dup = ingest({ name: "copy", kind: "notes", pages: d.materials[1].pages }, d.materials);
assert.equal(dup.duplicateOf, d.materials[1].name, "duplicate detected");
assert.throws(() => ingest({ name: "empty", kind: "notes", pages: ["  "] }, []), "empty document rejected");
const scanned = ingest({ name: "scan", kind: "notes", pages: ["Chapter 1\nSome real text about cells and tissues in plants.", " "] }, []);
assert.ok(scanned.material.warnings.some((w) => w.includes("Page 2")), "blank page flagged");
assert.equal(scanned.material.pages.length, 2, "no page dropped");

// past-paper analysis
const pq1 = d.pastQuestions.find((x) => x.id === "pq_5")!;
assert.equal(pq1.marks, 5);
assert.equal(pq1.difficulty, "hard");
assert.ok(d.pastQuestions.every((x) => x.confidence >= 0 && x.confidence <= 1));

// plan never exceeds available time, exam date respected
for (const [days, h] of [[1, 0.5], [3, 1], [7, 3]] as const) {
  const p = buildPlan(d, rep, days, h);
  p.schedule.forEach((day) => assert.ok(day.blocks.reduce((s, b) => s + b.minutes, 0) <= h * 60, `fits ${days}d×${h}h`));
}
const in4 = new Date(Date.now() + 4 * 86400000);
const iso = `${in4.getFullYear()}-${String(in4.getMonth() + 1).padStart(2, "0")}-${String(in4.getDate()).padStart(2, "0")}`;
assert.equal(daysUntil(iso), 4);
assert.ok(plan.schedule.flatMap((x) => x.blocks).every((b) => b.priority && b.successCriteria), "blocks have priority + success criteria");

console.log("\nALL CORE TESTS PASSED");
