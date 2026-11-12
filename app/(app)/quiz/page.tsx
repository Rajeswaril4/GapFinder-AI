"use client";
import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Alert, Button, Empty, PageHead, pct, when } from "@/components/ui";
import type { Attempt, Confidence, QuizQuestion } from "@/lib/types";
import { QUESTION_TYPE_LABEL, citeLabel } from "@/lib/types";
import { attemptScore } from "@/lib/analysis";
import { completeLoop, displayAnswer, evaluateAttempt, generateQuiz, type QuizBuild } from "@/lib/workflows";

type Phase = "setup" | "taking" | "done";

export default function QuizPage() {
  const { data, update } = useApp();
  const [phase, setPhase] = useState<Phase>("setup");
  const [count, setCount] = useState(8);
  const [quiz, setQuiz] = useState<QuizBuild | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [confidence, setConfidence] = useState<Record<string, Confidence>>({});
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<Attempt | null>(null);
  const [review, setReview] = useState<string>("");

  if (!data.topics.length)
    return (
      <>
        <PageHead title="3 · Diagnostic quiz" />
        <Empty title="Build your topic map first">
          Go to <Link href="/materials">Materials</Link>, upload your syllabus and notes, then build the topic map.
        </Empty>
      </>
    );

  async function start() {
    setError("");
    setBusy("Retrieving sections from your notes and generating grounded questions…");
    try {
      const q = await generateQuiz(data, count);
      setQuiz(q);
      setAnswers({});
      setConfidence({});
      setIdx(0);
      setPhase("taking");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function submit() {
    if (!quiz) return;
    const missing = quiz.questions.filter((q) => !answers[q.id]?.trim()).length;
    if (missing && !confirm(`${missing} question(s) unanswered — they will count as wrong. Submit anyway?`)) return;
    setError("");
    setBusy("Answer Evaluation Agent is checking your answers against the sources…");
    try {
      const log = quiz.log;
      const { attempt, warning } = await evaluateAttempt(data, quiz.questions, answers, confidence, log);
      setBusy("Updating your diagnosis and revision plan…");
      const out = await completeLoop(data, attempt, log);
      await update(() => out.data);
      setWarnings([warning, ...out.warnings].filter(Boolean) as string[]);
      setResult(attempt);
      setPhase("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const safeAttempts = Array.isArray(data?.attempts) ? data.attempts : [];
  const pastAttempt = safeAttempts.find((a) => a.id === review);
  const answered = quiz ? quiz.questions.filter((q) => answers[q.id]?.trim()).length : 0;

  return (
    <>
      <PageHead
        title="3 · Diagnostic quiz"
        desc={
          <>
            Questions are generated <b>only</b> from sections retrieved from your notes, in six formats. Each one is validated before you
            see it (citation, quote, answer key) and cites its source. Answers are revealed only after you submit. Later quizzes focus on
            weak and not-yet-assessed topics.
          </>
        }
      />
      {busy && <Alert kind="info">{busy}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {(busy || error) && <div className="spacer" />}

      {phase === "setup" && (
        <div className="grid grid-2">
          <div className="card stack">
            <h2>New diagnostic</h2>
            <div>
              <label>Number of questions</label>
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[5, 8, 10, 12].map((n) => (
                  <option key={n} value={n}>{n} questions (~{Math.round(n * 1.5)} min)</option>
                ))}
              </select>
            </div>
            <p className="muted" style={{ fontSize: 13.5 }}>
              {safeAttempts.length
                ? "Adaptive: more questions on weak and unassessed topics, targeting the subtopics and misconceptions from last time. Harder questions for topics you already know."
                : "First diagnostic: covers every topic so we can find your gaps."}
            </p>
            <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
              Formats: multiple choice · select all · true/false · fill in the blank · short answer · numerical (when the source has numbers).
            </p>
            <Button onClick={start} loading={!!busy}>Generate quiz</Button>
          </div>
          <div className="card">
            <h2>Recent results</h2>
            {!safeAttempts.length ? (
              <p className="muted">None yet.</p>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {[...safeAttempts].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((a, i, arr) => (
                  <div className="row between" key={a.id}>
                    <span>Attempt {arr.length - i} · {when(a.createdAt)} · {(a.questions || []).length} Qs · <b>{pct(attemptScore(a))}</b></span>
                    <Button size="sm" variant="secondary" onClick={() => setReview(review === a.id ? "" : a.id)}>
                      {review === a.id ? "Hide" : "Review"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {phase === "setup" && pastAttempt && (
        <>
          <div className="spacer" />
          <AttemptReview attempt={pastAttempt} />
        </>
      )}

      {phase === "taking" && quiz && (() => {
        const q = quiz.questions[idx];
        return (
          <>
            <Alert kind="ok">
              Retrieved {quiz.retrieved} sections from your notes → {quiz.questions.length} questions passed validation
              {quiz.rejected.length ? `, ${quiz.rejected.length} rejected (${Array.from(new Set(quiz.rejected.map((r) => r.why))).join(", ")})` : ""}.
            </Alert>
            <div className="spacer" />
            <div className="card">
              <div className="row between" style={{ fontSize: 13 }}>
                <b>Question {idx + 1} of {quiz.questions.length}</b>
                <span className="muted">{answered} answered</span>
              </div>
              <div className="progress" style={{ margin: "8px 0 4px" }}><span style={{ width: `${((idx + 1) / quiz.questions.length) * 100}%` }} /></div>
              <div className="row" style={{ gap: 4, marginTop: 6 }}>
                {quiz.questions.map((x, i) => (
                  <button
                    key={x.id}
                    onClick={() => setIdx(i)}
                    className="chip"
                    style={{ border: i === idx ? "1px solid var(--brand)" : "1px solid transparent", cursor: "pointer", background: answers[x.id]?.trim() ? "var(--brand-soft)" : undefined }}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
            <div className="spacer" />
            <QuestionCard
              n={idx + 1}
              q={q}
              value={answers[q.id] ?? ""}
              onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
              conf={confidence[q.id]}
              onConf={(c) => setConfidence((x) => ({ ...x, [q.id]: c }))}
            />
            <div className="spacer" />
            <div className="row between">
              <div className="row">
                <Button variant="secondary" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>← Previous</Button>
                {idx < quiz.questions.length - 1 ? (
                  <Button onClick={() => setIdx((i) => i + 1)}>Next →</Button>
                ) : (
                  <Button onClick={submit} loading={!!busy}>Submit answers</Button>
                )}
              </div>
              <div className="row">
                {idx < quiz.questions.length - 1 && <Button variant="secondary" onClick={submit} loading={!!busy}>Submit now</Button>}
                <Button variant="danger" onClick={() => confirm("Discard this quiz?") && setPhase("setup")} disabled={!!busy}>Cancel</Button>
              </div>
            </div>
          </>
        );
      })()}

      {phase === "done" && result && (
        <>
          <div className="card" style={{ background: "var(--brand-soft)", borderColor: "#c7d2fe" }}>
            <div className="row between">
              <div>
                <h2 style={{ margin: 0 }}>You scored {pct(attemptScore(result))}</h2>
                <p className="muted" style={{ margin: 0 }}>Your gap report and revision plan have been updated from these results.</p>
              </div>
              <div className="row">
                <Link className="btn" href="/report">See gap report →</Link>
                <Link className="btn secondary" href="/plan">Updated plan</Link>
                <Button variant="secondary" onClick={() => { setPhase("setup"); setResult(null); }}>New quiz</Button>
              </div>
            </div>
          </div>
          {warnings.map((w) => (
            <div key={w} style={{ marginTop: 10 }}><Alert>{w}</Alert></div>
          ))}
          <div className="spacer" />
          <AttemptReview attempt={result} />
        </>
      )}
    </>
  );
}

function QuestionCard({
  n, q, value, onChange, conf, onConf,
}: { n: number; q: QuizQuestion; value: string; onChange: (v: string) => void; conf?: Confidence; onConf: (c: Confidence) => void }) {
  const picked = new Set(value.split(",").filter(Boolean));
  return (
    <div className="card">
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
        <span className="qnum">{n}</span>
        <div style={{ flex: 1 }}>
          <div className="row" style={{ gap: 6, marginBottom: 6 }}>
            <span className="badge brand">{q.topicName}</span>
            <span className="chip">{QUESTION_TYPE_LABEL[q.type]}</span>
            <span className={`badge ${q.difficulty === "hard" ? "weak" : q.difficulty === "medium" ? "medium" : "strong"}`}>{q.difficulty}</span>
            <span className="chip">{q.marks} mark{q.marks > 1 ? "s" : ""}</span>
          </div>
          <p style={{ fontWeight: 600, fontSize: 16 }}>{q.question}</p>

          {(q.type === "mcq" || q.type === "true_false") &&
            q.options!.map((o, i) => (
              <label key={i} className={`option ${value === String(i) ? "selected" : ""}`}>
                <input type="radio" name={q.id} checked={value === String(i)} onChange={() => onChange(String(i))} />
                <span><b>{String.fromCharCode(65 + i)}.</b> {o}</span>
              </label>
            ))}
          {q.type === "multi_select" && (
            <>
              <p className="muted" style={{ fontSize: 13 }}>Select all that apply.</p>
              {q.options!.map((o, i) => (
                <label key={i} className={`option ${picked.has(String(i)) ? "selected" : ""}`}>
                  <input
                    type="checkbox"
                    checked={picked.has(String(i))}
                    onChange={(e) => {
                      const next = new Set(picked);
                      e.target.checked ? next.add(String(i)) : next.delete(String(i));
                      onChange([...next].sort().join(","));
                    }}
                  />
                  <span><b>{String.fromCharCode(65 + i)}.</b> {o}</span>
                </label>
              ))}
            </>
          )}
          {q.type === "fill_blank" && <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Type the missing word(s)" />}
          {q.type === "numerical" && (
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Your answer" style={{ maxWidth: 220 }} />
              {q.unit && <span className="muted">{q.unit}</span>}
            </div>
          )}
          {q.type === "short" && <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder="Write your answer in 1-3 sentences" />}

          <div className="row between" style={{ marginTop: 10 }}>
            <div className="row" style={{ gap: 6, fontSize: 13 }}>
              <span className="muted">How sure are you? (optional)</span>
              <div className="conf">
                {(["low", "medium", "high"] as Confidence[]).map((c) => (
                  <button key={c} type="button" className={conf === c ? "on" : ""} onClick={() => onConf(c)}>{c}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="cite" style={{ marginTop: 10 }}>📖 Source: {citeLabel(q.citation)}</div>
        </div>
      </div>
    </div>
  );
}

function AttemptReview({ attempt }: { attempt: Attempt }) {
  const ev = new Map(attempt.evaluations.map((e) => [e.questionId, e]));
  return (
    <div className="stack">
      <h2>Answers explained</h2>
      {attempt.questions.map((q, i) => {
        const e = ev.get(q.id);
        const ans = attempt.answers[q.id] ?? "";
        const ok = e?.correct;
        const picked = new Set(ans.split(",").filter(Boolean));
        const key = new Set((q.answerIndices ?? (q.answerIndex != null ? [q.answerIndex] : [])).map(String));
        const conf = attempt.confidence?.[q.id];
        return (
          <div className="card" key={q.id} style={{ borderLeft: `4px solid ${ok ? "var(--strong)" : e && e.score > 0 ? "var(--medium)" : "var(--weak)"}` }}>
            <div className="row between">
              <div className="row" style={{ gap: 6 }}>
                <span className="qnum">{i + 1}</span>
                <span className="badge brand">{q.topicName}</span>
                <span className="chip">{q.subtopic}</span>
                <span className="chip">{QUESTION_TYPE_LABEL[q.type]} · {q.difficulty ?? "medium"} · {q.marks ?? 1} mk</span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {conf && <span className="chip" title="Your confidence">you felt: {conf}</span>}
                <span className={`badge ${ok ? "strong" : e && e.score > 0 ? "medium" : "weak"}`}>
                  {ok ? "✓ Correct" : e && e.score > 0 ? `Partly right (${pct(e.score)})` : "✗ Wrong"}
                </span>
              </div>
            </div>
            <p style={{ fontWeight: 600, marginTop: 8 }}>{q.question}</p>
            {q.options ? (
              q.options.map((o, k) => {
                const isKey = key.has(String(k));
                const isPicked = picked.has(String(k));
                return (
                  <div key={k} className={`option ${isKey ? "correct" : isPicked ? "wrong" : ""}`} style={{ cursor: "default" }}>
                    <span>
                      <b>{String.fromCharCode(65 + k)}.</b> {o}
                      {isKey && " — correct"}
                      {isPicked && " — your choice"}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="stack" style={{ gap: 4, fontSize: 14 }}>
                <div><span className="muted">Your answer:</span> {displayAnswer(q, ans)}</div>
                <div><span className="muted">Model answer:</span> {q.modelAnswer}</div>
                {q.rubric?.length ? <div><span className="muted">Rubric:</span> {q.rubric.join(" · ")}</div> : null}
              </div>
            )}
            {e && (
              <p style={{ marginTop: 8, marginBottom: 4 }}>
                <b>Why: </b>{e.feedback}
                {e.misconception && <span style={{ color: "var(--weak)" }}> Misconception: {e.misconception}.</span>}
              </p>
            )}
            {e?.evidence && (
              <p className="muted" style={{ fontSize: 12.5, margin: "0 0 6px" }}>
                Scored {e.method === "deterministic" ? "by the answer key" : e.method === "rubric_ai" ? "against the rubric (AI)" : "by keyword fallback"} — {e.evidence}
              </p>
            )}
            <div className="cite">📖 {citeLabel(q.citation)} — <q>{q.citation.quote}</q></div>
            {!ok && (
              <div style={{ marginTop: 8 }}>
                <Link
                  className="btn sm secondary"
                  href={`/explain?q=${encodeURIComponent(`I answered "${displayAnswer(q, ans)}" to: "${q.question}". The correct answer is "${q.modelAnswer}". Explain my mistake and the right idea.`)}`}
                >
                  Explain my mistake
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
