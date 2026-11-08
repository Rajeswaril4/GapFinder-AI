// AGENT 6 — Answer Evaluation. Objective questions (MCQ, true/false, multi-select, exact
// fill-ins, numerical with tolerance) are scored in CODE by the answer key. Only subjective
// answers (short answers, near-miss fill-ins) are scored by the model, against a rubric of key
// points from the cited source. The model also explains every wrong answer and names the
// misconception — but it can never change an objective score.
import { z } from "zod";
import { fail, generateJson } from "@/lib/llm";
import type { Correctness, Evaluation, QuizQuestion } from "@/lib/types";
import { scoreDeterministic } from "@/lib/analysis";
import { tokenize } from "@/lib/text";

export const maxDuration = 60;

interface Item {
  q: QuizQuestion;
  studentAnswer: string;
  source: string; // text of the cited chunk
}

const Schema = z.object({
  evaluations: z.array(
    z.object({
      questionId: z.string(),
      score: z.coerce.number().min(0).max(1).default(0),
      pointsMet: z.array(z.string()).optional().nullable(),
      pointsMissed: z.array(z.string()).optional().nullable(),
      feedback: z.string().default(""),
      misconception: z.string().optional().nullable(),
    })
  ),
});

function studentText(q: QuizQuestion, a: string): string {
  if (!a?.trim()) return "(no answer)";
  if (q.type === "mcq" || q.type === "true_false") return q.options?.[Number(a)] ?? a;
  if (q.type === "multi_select") return a.split(",").filter(Boolean).map((i) => q.options?.[Number(i)] ?? i).join(", ");
  return a.trim();
}

const correctnessOf = (score: number, blank: boolean): Correctness =>
  blank ? "unanswered" : score >= 0.99 ? "correct" : score > 0 ? "partially_correct" : "incorrect";

/** Keyword-overlap rubric fallback for when the model is unavailable. */
function rubricFallback(it: Item): { score: number; evidence: string } {
  const points = it.q.rubric?.length ? it.q.rubric : [it.q.modelAnswer];
  const got = new Set(tokenize(it.studentAnswer || ""));
  const met = points.filter((p) => {
    const w = tokenize(p);
    return w.length && w.filter((x) => got.has(x)).length / w.length >= 0.5;
  });
  return { score: Number((met.length / points.length).toFixed(2)), evidence: `Keyword check: ${met.length}/${points.length} key points found.` };
}

export async function POST(req: Request) {
  let items: Item[] = [];
  try {
    items = ((await req.json()) as { items: Item[] }).items ?? [];
    if (!items.length) return Response.json({ evaluations: [] });

    // 1) deterministic scoring first
    const det = new Map(items.map((it) => [it.q.id, scoreDeterministic(it.q, it.studentAnswer)]));
    // 2) the model sees everything that is not a blank or an objectively-correct answer
    const forModel = items.filter((it) => it.studentAnswer?.trim() && !(det.get(it.q.id) && det.get(it.q.id)!.score >= 0.99));

    let ai = new Map<string, z.infer<typeof Schema>["evaluations"][number]>();
    let warning: string | undefined;
    if (forModel.length) {
      try {
        const out = await generateJson({
          schema: Schema,
          temperature: 0.1,
          system:
            "You are the Answer Evaluation Agent: a kind but precise examiner. Judge each answer ONLY against the SOURCE, the CORRECT " +
            "ANSWER and the RUBRIC given. For subjective answers, award the fraction of rubric points clearly met (partial credit is " +
            "fine; accept synonyms and spelling variants). For each answer write 1-2 sentences saying why it is right or wrong, " +
            "referring to the source. If wrong, name the specific misconception in a few words (e.g. 'confuses stroma with grana').",
          prompt:
            forModel
              .map(
                (it, n) =>
                  `#${n + 1} questionId=${it.q.id} type=${it.q.type}\nQUESTION: ${it.q.question}\n` +
                  (it.q.options ? `OPTIONS: ${it.q.options.map((o, i) => `(${String.fromCharCode(65 + i)}) ${o}`).join("  ")}\n` : "") +
                  `CORRECT ANSWER: ${it.q.modelAnswer}\n` +
                  (it.q.rubric?.length ? `RUBRIC: ${it.q.rubric.map((r, i) => `[${i + 1}] ${r}`).join(" ")}\n` : "") +
                  `STUDENT ANSWER: ${studentText(it.q, it.studentAnswer)}\nSOURCE: ${it.source.slice(0, 700)}`
              )
              .join("\n\n") +
            `\n\nReturn {"evaluations":[{"questionId","score","pointsMet","pointsMissed","feedback","misconception"}]}, one per question. score is 0-1.`,
        });
        ai = new Map(out.evaluations.map((e) => [e.questionId, e]));
      } catch (e) {
        const res = fail(e);
        warning = (await res.json()).error;
      }
    }

    const evaluations: Evaluation[] = items.map((it) => {
      const q = it.q;
      const blank = !it.studentAnswer?.trim();
      const d = det.get(q.id);
      const e = ai.get(q.id);
      let score: number;
      let method: Evaluation["method"];
      let evidence: string;
      if (d) {
        score = d.score; // objective: the answer key decides
        method = "deterministic";
        evidence = d.evidence;
      } else if (e) {
        score = e.score;
        method = "rubric_ai";
        evidence =
          (e.pointsMet?.length ? `Met: ${e.pointsMet.join("; ")}. ` : "") + (e.pointsMissed?.length ? `Missed: ${e.pointsMissed.join("; ")}.` : "") ||
          "Rubric-scored.";
      } else {
        const f = rubricFallback(it);
        score = f.score;
        method = "fallback";
        evidence = f.evidence;
      }
      const ok = score >= 0.99;
      return {
        questionId: q.id,
        score,
        correct: score >= 0.6,
        correctness: correctnessOf(score, blank),
        method,
        feedback: blank
          ? `No answer given. Correct answer: ${q.modelAnswer}.`
          : ok
          ? `Correct. ${q.explanation}`
          : e?.feedback || `The correct answer is: ${q.modelAnswer}. ${q.explanation}`,
        misconception: score < 0.6 ? e?.misconception || undefined : undefined,
        evidence,
      };
    });
    return Response.json({ evaluations, warning });
  } catch (e) {
    return fail(e);
  }
}
