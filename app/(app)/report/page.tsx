"use client";
import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Alert, Bar, Button, ConfidenceBadge, Empty, LevelBadge, PageHead, pct, when } from "@/components/ui";
import type { GapReport, Level } from "@/lib/types";
import { THRESHOLDS } from "@/lib/analysis";
import { analyze, withRuns, type RunLog } from "@/lib/workflows";

const ORDER: Level[] = ["weak", "medium", "untested", "strong"];
const TITLE: Record<Level, string> = {
  weak: "🔴 Weak — needs serious work",
  medium: "🟡 Medium — partly understood",
  untested: "⚪ Not assessed — insufficient evidence",
  strong: "🟢 Strong — already good",
};
const COLOR: Record<Level, string> = { weak: "var(--weak)", medium: "var(--medium)", strong: "var(--strong)", untested: "var(--untested)" };

/** Horizontal mastery bars with the weak/strong thresholds marked. */
function MasteryChart({ report }: { report: GapReport }) {
  const rows = report.topics.filter((t) => t.level !== "untested").sort((a, b) => a.mastery - b.mastery);
  if (!rows.length) return null;
  const W = 640, L = 190, R = 50, H = 26 * rows.length + 30;
  const x = (v: number) => L + v * (W - L - R);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Mastery by topic">
      {[0, THRESHOLDS.weak, THRESHOLDS.strong, 1].map((v) => (
        <g key={v}>
          <line x1={x(v)} x2={x(v)} y1={4} y2={H - 22} stroke={v === 0 || v === 1 ? "#e4e7ef" : "#c7cbd6"} strokeDasharray={v === 0 || v === 1 ? "" : "4 4"} />
          <text x={x(v)} y={H - 6} fontSize="11" textAnchor="middle" fill="#5d6478">{Math.round(v * 100)}%</text>
        </g>
      ))}
      {rows.map((t, i) => (
        <g key={t.topicId}>
          <text x={L - 8} y={22 + i * 26} fontSize="12" textAnchor="end" fill="#161a2b">{t.name.length > 26 ? t.name.slice(0, 25) + "…" : t.name}</text>
          <rect x={x(0)} y={10 + i * 26} width={Math.max(2, x(t.mastery) - x(0))} height={16} rx={4} fill={COLOR[t.level]} opacity={t.confidence === "low" ? 0.5 : 0.9}>
            <title>{`${t.name}: ${pct(t.mastery)} (${t.confidence} confidence)`}</title>
          </rect>
          <text x={x(t.mastery) + 6} y={22 + i * 26} fontSize="11.5" fill="#5d6478">{pct(t.mastery)}</text>
        </g>
      ))}
    </svg>
  );
}

export default function ReportPage() {
  const { data, update } = useApp();
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState("");
  const report = data.reports[data.reports.length - 1];
  const prev = data.reports[data.reports.length - 2];

  if (!report)
    return (
      <>
        <PageHead title="4 · Gap analysis report" />
        <Empty title="No gap report yet">
          Take a <Link href="/quiz">diagnostic quiz</Link> — the report is produced from your answers.
        </Empty>
      </>
    );

  async function regenerate() {
    setBusy(true);
    setWarn("");
    const log: RunLog = [];
    const { report: r, warning } = await analyze(data, log);
    if (warning) setWarn(warning);
    await update((d) => withRuns({ ...d, reports: [...d.reports.slice(0, -1), { ...r, id: report.id }] }, log));
    setBusy(false);
  }

  const weakest = report.topics.filter((t) => t.level === "weak" || t.level === "medium").sort((a, b) => a.mastery - b.mastery).slice(0, 3);

  return (
    <>
      <PageHead
        title="4 · Gap analysis report"
        desc={
          <>
            Levels are <b>computed</b> from your answers with a transparent weighted model (recency, difficulty, question type): weak &lt;{" "}
            {pct(THRESHOLDS.weak)} ≤ medium &lt; {pct(THRESHOLDS.strong)} ≤ strong; topics without answers are “not assessed”. Confidence
            shows how much evidence a level rests on. The AI only explains each level from your actual mistakes.
          </>
        }
      >
        <Button variant="secondary" onClick={regenerate} loading={busy}>Regenerate AI diagnosis</Button>
        <Link className="btn" href="/plan">Revision plan →</Link>
      </PageHead>

      <div className="grid grid-4">
        <div className="card">
          <div className="stat">{pct(report.overallMastery)}</div>
          <div className="stat-label">overall mastery (assessed topics){prev?.overallMastery != null && ` · was ${pct(prev.overallMastery)}`}</div>
        </div>
        <div className="card">
          <div className="stat">{report.coverage.assessed}/{report.coverage.total}</div>
          <div className="stat-label">topics assessed (knowledge coverage)</div>
        </div>
        <div className="card">
          <div className="stat" style={{ color: "var(--weak)" }}>{report.topics.filter((t) => t.level === "weak").length}</div>
          <div className="stat-label">weak topics</div>
        </div>
        <div className="card">
          <div className="stat" style={{ color: "var(--medium)" }}>{report.misconceptions.length}</div>
          <div className="stat-label">misconceptions detected</div>
        </div>
      </div>

      <div className="spacer" />
      <div className="grid grid-2">
        <div className="card">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Diagnosis</h2>
            <span className="muted" style={{ fontSize: 13 }}>Updated {when(report.createdAt)}</span>
          </div>
          <p style={{ marginTop: 8 }}>{report.summary}</p>
          {weakest.length > 0 && (
            <>
              <label>Weakest topics</label>
              {weakest.map((t, i) => (
                <div key={t.topicId} style={{ fontSize: 14 }}>{i + 1}. <b>{t.name}</b> — {pct(t.mastery)} · {t.recommendedAction}</div>
              ))}
            </>
          )}
        </div>
        <div className="card">
          <h2>Mastery by topic</h2>
          <MasteryChart report={report} />
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>Dashed lines = weak / strong thresholds. Faded bars = low-confidence (few questions).</p>
        </div>
      </div>

      {report.misconceptions.length > 0 && (
        <>
          <div className="spacer" />
          <div className="card">
            <h2>Misconception analysis</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Misconception</th><th>Topic</th><th>Times seen</th></tr></thead>
                <tbody>
                  {report.misconceptions.slice(0, 10).map((m) => (
                    <tr key={m.text + m.topicName}>
                      <td>{m.text}</td>
                      <td>{m.topicName}</td>
                      <td>{m.count > 1 ? <span className="badge weak">recurring ×{m.count}</span> : <span className="badge">once</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {warn && <div style={{ marginTop: 10 }}><Alert>{warn}</Alert></div>}

      {ORDER.map((level) => {
        const topics = report.topics.filter((t) => t.level === level);
        if (!topics.length) return null;
        return (
          <section key={level} style={{ marginTop: 22 }}>
            <h2>{TITLE[level]} ({topics.length})</h2>
            <div className="stack">
              {topics.map((t) => {
                const before = prev?.topics.find((x) => x.topicId === t.topicId);
                return (
                  <div className="card" key={t.topicId} style={{ borderLeft: `4px solid ${COLOR[t.level]}` }}>
                    <div className="row between">
                      <div className="row" style={{ gap: 8 }}>
                        <h3 style={{ margin: 0 }}>{t.name}</h3>
                        <LevelBadge level={t.level} />
                        {t.level !== "untested" && <ConfidenceBadge c={t.confidence} />}
                        {before && before.level !== t.level && <span className="chip">was {before.level === "untested" ? "not assessed" : before.level}</span>}
                        {t.needsReassessment && t.level !== "untested" && <span className="chip">re-assess soon</span>}
                      </div>
                      <div className="row" style={{ gap: 12, fontSize: 13 }}>
                        <span className="muted">Priority <b style={{ color: "var(--ink)" }}>{Math.round(t.priority * 100)}</b></span>
                        <span className="muted">Exam weight <b style={{ color: "var(--ink)" }}>{t.examWeight}</b></span>
                      </div>
                    </div>
                    {t.level !== "untested" && (
                      <div className="row" style={{ marginTop: 10, flexWrap: "nowrap" }}>
                        <div style={{ flex: 1 }}><Bar value={t.mastery} level={t.level} /></div>
                        <b style={{ minWidth: 48, textAlign: "right" }}>{pct(t.mastery)}</b>
                        {t.trend != null && Math.abs(t.trend) >= 0.01 && (
                          <span style={{ fontSize: 13, fontWeight: 600, color: t.trend > 0 ? "var(--strong)" : "var(--weak)" }} title="Change since the previous attempt on this topic">
                            {t.trend > 0 ? "▲" : "▼"} {Math.abs(Math.round(t.trend * 100))}
                          </span>
                        )}
                      </div>
                    )}
                    <p style={{ marginTop: 10, marginBottom: 6 }}>{t.reason}</p>
                    {t.reason !== t.evidence && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Evidence: {t.evidence}</p>}
                    {t.misconceptions.length > 0 && (
                      <p style={{ fontSize: 13.5, margin: "6px 0 0", color: "var(--weak)" }}>Misconceptions: {t.misconceptions.join(" · ")}</p>
                    )}
                    {t.weakSubtopics.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <span className="muted" style={{ fontSize: 13 }}>Mistakes in: </span>
                        {t.weakSubtopics.map((s) => <span key={s} className="chip">{s}</span>)}
                      </div>
                    )}
                    {t.evidenceItems.length > 0 && (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ cursor: "pointer", fontSize: 14 }}>Evidence from {t.questionsAttempted} attempted question(s)</summary>
                        <div className="table-wrap">
                          <table style={{ fontSize: 13 }}>
                            <thead><tr><th>Attempt</th><th>Question</th><th>Result</th><th>Source</th></tr></thead>
                            <tbody>
                              {t.evidenceItems.map((ev, k) => (
                                <tr key={k}>
                                  <td>#{ev.attempt}</td>
                                  <td>{ev.question}</td>
                                  <td>
                                    <span className={`badge ${ev.score >= 0.99 ? "strong" : ev.score > 0 ? "medium" : "weak"}`}>
                                      {ev.score >= 0.99 ? "correct" : ev.score > 0 ? pct(ev.score) : "wrong"}
                                    </span>
                                  </td>
                                  <td className="muted">{ev.citation}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                    <div className="row" style={{ marginTop: 10 }}>
                      <span style={{ fontSize: 14, flex: 1 }}><b>Next step: </b>{t.recommendedAction}</span>
                      <Link
                        className="btn sm secondary"
                        href={`/explain?topic=${encodeURIComponent(t.name)}${t.weakSubtopics[0] ? `&focus=${encodeURIComponent(t.weakSubtopics[0])}` : ""}`}
                      >
                        Explain this topic
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
