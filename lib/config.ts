// All tunable numbers in one place. The diagnosis model is a transparent weighted
// average — not a validated psychometric score — so every weight is visible here.
export const CONFIG = {
  mastery: {
    strong: 0.8, // mastery >= 80% → strong
    weak: 0.5, // mastery < 50% → weak (in between → medium)
    minQuestionsForConfidence: { medium: 2, high: 4 }, // evidence needed before we trust a level
    recencyDecay: 0.5, // each older attempt counts half as much as the next newer one
    difficultyWeight: { easy: 0.8, medium: 1, hard: 1.3 },
    typeWeight: { mcq: 1, true_false: 0.7, multi_select: 1.1, fill_blank: 1, short: 1.2, numerical: 1.2 },
    untestedAssumption: 0.4, // only used for PRIORITY of unassessed topics, never shown as mastery
  },
  priority: { weakness: 0.55, examImportance: 0.25, misconceptions: 0.1, prerequisite: 0.1 },
  retrieval: { chunkChars: 750, overlapChars: 120, topK: 10, contextChunks: 4, minExplainScore: 1.2 },
  mapping: { minScore: 1.0, reviewBelowConfidence: 0.45 },
  plan: { maxBlockMinutes: 60, retestMinutes: 25 },
} as const;
