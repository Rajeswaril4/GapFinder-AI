import { describe, it, expect } from "vitest";
import { levelOf, summarizeStudent } from "../lib/admin-summary";

describe("admin summary", () => {
  it("maps mastery to a level", () => {
    expect(levelOf(null)).toBe("untested");
    expect(levelOf(0.49)).toBe("weak");
    expect(levelOf(0.5)).toBe("medium");
    expect(levelOf(0.8)).toBe("strong");
  });

  it("tolerates empty or malformed data", () => {
    const s = summarizeStudent(undefined);
    expect(s.mastery).toBeNull();
    expect(s.attempts).toEqual([]);
    expect(summarizeStudent({ attempts: "oops", reports: 5 }).level).toBe("untested");
  });

  it("summarises attempts, latest report and weak topics", () => {
    const s = summarizeStudent({
      subject: "Biology",
      materials: [{ name: "Notes", kind: "notes" }],
      topics: [{}, {}],
      attempts: [{ createdAt: 1, questions: [{}, {}], evaluations: [{ score: 1 }, { score: 0 }] }],
      reports: [
        { overallMastery: 0.9, topics: [] },
        { overallMastery: 0.4, coverage: { assessed: 1, total: 2 }, summary: "x", topics: [{ name: "Excretion", level: "weak" }] },
      ],
      plan: { schedule: [{}, {}, {}] },
    });
    expect(s.subject).toBe("Biology");
    expect(s.attempts[0].score).toBe(0.5);
    expect(s.mastery).toBe(0.4);
    expect(s.level).toBe("weak");
    expect(s.weakTopics).toEqual(["Excretion"]);
    expect(s.planDays).toBe(3);
  });
});
