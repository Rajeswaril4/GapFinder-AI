"use client";
import Link from "next/link";
import { useApp } from "@/components/AppProvider";
import { LevelBadge, PageHead, PriorityBadge, pct, when } from "@/components/ui";
import { ProgressChart, ProgressTable } from "@/components/ProgressChart";
import { attemptScore } from "@/lib/analysis";

export default function Dashboard() {
  const { data, user } = useApp();
  const report = data.reports[data.reports.length - 1];
  const prev = data.reports[data.reports.length - 2];
  const attempts = [...data.attempts].sort((a, b) => a.createdAt - b.createdAt);
  const last = attempts[attempts.length - 1];
  const weak = report?.topics.filter((t) => t.level === "weak") ?? [];
  const count = (l: string) => report?.topics.filter((t) => t.level === l).length ?? data.topics.length * Number(l === "untested");
  const upcoming = (data.plan?.schedule ?? []).flatMap((d) => d.blocks.filter((b) => !b.done).map((b) => ({ day: d.day, b }))).slice(0, 4);
  const reassess = report?.topics.filter((t) => t.needsReassessment && t.level !== "untested") ?? [];

  const next = !data.materials.length
    ? { title: "Upload your study material", body: "Add your syllabus, textbook chapters or notes, and past papers.", href: "/materials", cta: "Upload material" }
    : !data.topics.length
    ? { title: "Build your topic map", body: "GapFinder reads your syllabus and links every past-paper question to a topic.", href: "/materials", cta: "Build topic map" }
    : !data.attempts.length
    ? { title: "Take your first diagnostic quiz", body: "Questions are generated from your own notes, each with a citation.", href: "/quiz", cta: "Start diagnostic" }
    : {
        title: weak.length ? `Fix your weakest topic: ${weak[0].name}` : "Keep going — re-test to confirm progress",
        body: weak.length ? weak[0].reason : "Your plan is up to date. Take another quiz to update it.",
        href: weak.length ? "/plan" : "/quiz",
        cta: weak.length ? "Open revision plan" : "Re-test now",
      };

  return (
    <>
      <PageHead title={`Hi ${user?.name.split(" ")[0]} 👋`} desc={<>Subject: <b>{data.subject}</b></>} />

      <div className="card" style={{ background: "linear-gradient(135deg,#eef0ff,#f5f3ff)", borderColor: "#dcdcff" }}>
        <div className="row between">
          <div style={{ maxWidth: 720 }}>
            <span className="badge brand">Next best step</span>
            <h2 style={{ marginTop: 8 }}>{next.title}</h2>
            <p className="muted" style={{ margin: 0 }}>{next.body}</p>
          </div>
          <Link className="btn" href={next.href}>{next.cta} →</Link>
        </div>
      </div>

      <div className="spacer" />
      <div className="grid grid-4">
        <div className="card">
          <div className="stat">{report ? pct(report.overallMastery) : "—"}</div>
          <div className="stat-label">
            overall mastery{last && ` · latest quiz ${pct(attemptScore(last))}`}{attempts.length > 1 && ` (first ${pct(attemptScore(attempts[0]))})`}
          </div>
        </div>
        <div className="card">
          <div className="stat">{report ? `${report.coverage.assessed}/${report.coverage.total}` : `0/${data.topics.length}`}</div>
          <div className="stat-label">topics assessed · {count("untested")} not assessed</div>
        </div>
        <div className="card">
          <div className="stat" style={{ color: "var(--strong)" }}>{count("strong")}</div>
          <div className="stat-label">strong topics · {count("medium")} medium</div>
        </div>
        <div className="card">
          <div className="stat" style={{ color: weak.length ? "var(--weak)" : "var(--strong)" }}>{weak.length}</div>
          <div className="stat-label">weak topics right now</div>
        </div>
      </div>

      <div className="spacer" />
      <div className="grid grid-2">
        <div className="card">
          <div className="row between">
            <h2>Upcoming revision tasks</h2>
            <Link href="/plan" style={{ fontSize: 14 }}>Full plan →</Link>
          </div>
          {!upcoming.length ? (
            <p className="muted">{data.plan ? "All tasks done — take a follow-up quiz." : "No plan yet."}</p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {upcoming.map(({ day, b }) => (
                <div key={b.id} className="row between" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6, flexWrap: "nowrap" }}>
                  <div>
                    <b>{b.topicName}</b> <span className="muted" style={{ fontSize: 13 }}>· Day {day} · {b.minutes} min</span>
                    <div className="muted" style={{ fontSize: 13 }}>{b.activity.length > 110 ? b.activity.slice(0, 109) + "…" : b.activity}</div>
                  </div>
                  {b.priority && <PriorityBadge p={b.priority} />}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="row between">
            <h2>Recent quiz results</h2>
            <Link href="/quiz" style={{ fontSize: 14 }}>New quiz →</Link>
          </div>
          {!attempts.length ? (
            <p className="muted">No quizzes yet.</p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {[...attempts].reverse().slice(0, 4).map((a) => (
                <div key={a.id} className="row between" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
                  <span>Attempt {attempts.indexOf(a) + 1} · {when(a.createdAt)} · {a.questions.length} questions</span>
                  <b>{pct(attemptScore(a))}</b>
                </div>
              ))}
              {reassess.length > 0 && (
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>Needs re-assessment: {reassess.map((t) => t.name).join(", ")}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="spacer" />
      <div className="grid grid-2">
        <div className="card">
          <div className="row between">
            <h2>Progress across attempts</h2>
            <span className="muted" style={{ fontSize: 13 }}>{attempts.length} attempt(s)</span>
          </div>
          <ProgressChart data={data} />
        </div>
        <div className="card">
          <div className="row between">
            <h2>Gap snapshot</h2>
            <Link href="/report" style={{ fontSize: 14 }}>Full report →</Link>
          </div>
          {!report ? (
            <p className="muted">No gap report yet.</p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              <p className="muted" style={{ fontSize: 13 }}>Updated {when(report.createdAt)}</p>
              {report.topics.map((t) => {
                const before = prev?.topics.find((x) => x.topicId === t.topicId);
                return (
                  <div key={t.topicId} className="row between" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <LevelBadge level={t.level} />
                      <span>{t.name}</span>
                    </div>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {before && before.level !== t.level && before.level !== "untested" ? `was ${before.level} · ` : ""}
                      {t.level === "untested" ? "not assessed" : pct(t.mastery)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="spacer" />
      <div className="card">
        <h2>Topic scores per attempt</h2>
        <ProgressTable data={data} />
      </div>
    </>
  );
}
