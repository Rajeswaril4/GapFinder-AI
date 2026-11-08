"use client";
import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Alert, Button, Empty, LevelBadge, PageHead, PriorityBadge, when } from "@/components/ui";
import type { PlanBlock } from "@/lib/types";
import { daysUntil } from "@/lib/planner";
import { makePlan, withRuns, type RunLog } from "@/lib/workflows";

const KIND_LABEL: Record<PlanBlock["kind"], string> = { learn: "Concept revision", practice: "Practice", review: "Spaced review", retest: "Follow-up assessment" };

export default function PlanPage() {
  const { data, update } = useApp();
  const report = data.reports[data.reports.length - 1];
  const [days, setDays] = useState(data.planPrefs.days);
  const [hours, setHours] = useState(data.planPrefs.hoursPerDay);
  const [examDate, setExamDate] = useState(data.planPrefs.examDate ?? "");
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState("");
  const plan = data.plan;

  if (!report)
    return (
      <>
        <PageHead title="5 · Revision planner" />
        <Empty title="No plan yet">
          Take a <Link href="/quiz">diagnostic quiz</Link> first — the plan is built from your gap report.
        </Empty>
      </>
    );

  async function rebuild() {
    const prefs = {
      days: Math.max(1, Math.min(30, Math.round(days))),
      hoursPerDay: Math.max(0.5, Math.min(10, hours)),
      examDate: examDate || undefined,
    };
    setBusy(true);
    setWarn("");
    const log: RunLog = [];
    const { plan: p, warning } = await makePlan(data, report, prefs, log);
    if (warning) setWarn(warning);
    await update((x) => withRuns({ ...x, plan: p, planPrefs: prefs }, log));
    setBusy(false);
  }

  function toggle(blockId: string) {
    update((x) =>
      x.plan
        ? { ...x, plan: { ...x.plan, schedule: x.plan.schedule.map((dd) => ({ ...dd, blocks: dd.blocks.map((b) => (b.id === blockId ? { ...b, done: !b.done } : b)) })) } }
        : x
    );
  }

  const stale = plan && plan.reportId !== report.id;
  const allBlocks = plan?.schedule.flatMap((d) => d.blocks) ?? [];
  const doneMin = allBlocks.filter((b) => b.done).reduce((s, b) => s + b.minutes, 0);
  const totalMin = allBlocks.reduce((s, b) => s + b.minutes, 0);
  const levelOf = (topicId: string) => report.topics.find((t) => t.topicId === topicId)?.level;
  const fmtDate = (iso?: string) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "");

  return (
    <>
      <PageHead
        title="5 · Personalised revision planner"
        desc="Priority order: weak prerequisite topics → weak, exam-important topics → repeated misconceptions → medium topics → spaced review of strong topics. The plan never uses more than your daily study time, and it rebuilds itself after every quiz."
      />

      <div className="card">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ width: 170 }}>
            <label>Exam date (optional)</label>
            <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
          </div>
          <div style={{ width: 130 }}>
            <label>{examDate ? "Days (from date)" : "Days to plan"}</label>
            <input type="number" min={1} max={30} value={examDate ? daysUntil(examDate) : days} disabled={!!examDate} onChange={(e) => setDays(Number(e.target.value))} />
          </div>
          <div style={{ width: 130 }}>
            <label>Hours per day</label>
            <input type="number" min={0.5} max={10} step={0.5} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
          </div>
          <Button onClick={rebuild} loading={busy}>Rebuild plan</Button>
          {plan && (
            <span className="muted" style={{ fontSize: 13 }}>
              Built {when(plan.createdAt)} from the gap report of {when(report.createdAt)}
              {plan.aiEnhanced ? " · tasks written by the Revision Planning Agent" : " · computed plan"}
            </span>
          )}
        </div>
      </div>
      {stale && <div style={{ marginTop: 10 }}><Alert>Your gap report changed since this plan was built. Click “Rebuild plan”.</Alert></div>}
      {warn && <div style={{ marginTop: 10 }}><Alert>{warn}</Alert></div>}

      {plan && (
        <>
          <div className="spacer" />
          <div className="card">
            <div className="row between">
              <b>Completed: {Math.round((doneMin / 60) * 10) / 10}h of {Math.round((totalMin / 60) * 10) / 10}h ({plan.days} days × {plan.hoursPerDay}h available)</b>
              <span className="muted" style={{ fontSize: 13 }}>Tick tasks as you finish them</span>
            </div>
            <div className="bar" style={{ marginTop: 8 }}><span style={{ width: `${totalMin ? (doneMin / totalMin) * 100 : 0}%` }} /></div>
          </div>
          {plan.schedule.map((d) => {
            const mins = d.blocks.reduce((s, b) => s + b.minutes, 0);
            return (
              <section key={d.day} style={{ marginTop: 20 }}>
                <div className="row between">
                  <h2 style={{ margin: 0 }}>Day {d.day} {d.date && <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>· {fmtDate(d.date)}</span>}</h2>
                  <span className="muted" style={{ fontSize: 13 }}>{Math.floor(mins / 60)}h {mins % 60}m of {Math.round(plan.hoursPerDay * 60)} min</span>
                </div>
                <div className="stack" style={{ marginTop: 8 }}>
                  {d.blocks.length === 0 && <p className="muted">Free / buffer day.</p>}
                  {d.blocks.map((b) => {
                    const lvl = levelOf(b.topicId);
                    return (
                      <div className="card" key={b.id} style={{ opacity: b.done ? 0.55 : 1 }}>
                        <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                          <input type="checkbox" checked={!!b.done} onChange={() => toggle(b.id)} style={{ marginTop: 5, width: 18, height: 18 }} aria-label="Mark done" />
                          <div style={{ flex: 1 }}>
                            <div className="row between">
                              <div className="row" style={{ gap: 6 }}>
                                <b style={{ textDecoration: b.done ? "line-through" : "none" }}>{b.topicName}</b>
                                <span className="badge brand">{KIND_LABEL[b.kind]}</span>
                                {b.priority && <PriorityBadge p={b.priority} />}
                                {lvl && b.kind !== "retest" && <LevelBadge level={lvl} />}
                              </div>
                              <span className="badge">{b.minutes} min</span>
                            </div>
                            <p style={{ margin: "6px 0" }}>{b.activity}</p>
                            {b.practice && (
                              <p style={{ fontSize: 14, margin: "4px 0" }}><span className="muted">Practice question: </span>“{b.practice}”</p>
                            )}
                            {b.successCriteria && (
                              <p style={{ fontSize: 13.5, margin: "4px 0", color: "var(--strong)" }}>✓ Success: {b.successCriteria}</p>
                            )}
                            {b.kind === "retest" && <Link className="btn sm" href="/quiz">Take quiz now</Link>}
                            {b.focus.length > 0 && <div>{b.focus.map((f) => <span key={f} className="chip">{f}</span>)}</div>}
                            {b.sources.length > 0 && (
                              <div className="stack" style={{ gap: 4, marginTop: 6 }}>
                                {b.sources.map((s) => <div key={s} className="cite">📖 Read: {s}</div>)}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      )}
    </>
  );
}
