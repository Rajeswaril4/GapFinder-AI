"use client";
import Link from "next/link";
import { useApp } from "@/components/AppProvider";
import { ThemeToggle } from "@/components/ThemeToggle";

const STEPS = [
  ["Upload", "Syllabus, textbook chapters, notes and past papers (PDF or text)."],
  ["Map", "A topic tree is built from your syllabus; every past-paper question is mapped to a topic."],
  ["Test", "A diagnostic quiz generated only from your material — every question cites its source."],
  ["Diagnose", "Each topic is measured: 🔴 weak, 🟡 medium, 🟢 strong or ⚪ not assessed — with evidence."],
  ["Plan", "A day-by-day revision plan that fits your time, weakest and most-examined topics first."],
  ["Re-test", "Every new quiz updates the diagnosis and the plan automatically."],
];

const FEATURES = [
  ["Diagnosis, not chat", "The main output is a topic-level gap report backed by your answers — chat is only a helper."],
  ["Grounded in your books", "Questions, explanations and plans come from your uploaded material with page-level citations."],
  ["Measurable mastery", "Transparent weighted scoring (difficulty, recency, question type) with a confidence level for every topic."],
  ["Exam-aware priorities", "Past papers show which topics are examined most; prerequisites and repeated misconceptions are boosted."],
  ["Adaptive plan", "Fits your daily hours and exam date, with spaced reviews and a follow-up assessment."],
  ["10 specialised agents", "Ingestion, mapping, retrieval, past-paper analysis, question generation, evaluation, diagnosis, planning, monitoring, assistant."],
];

const SAMPLE = [
  { name: "Excretion", level: "weak", m: 0, why: "Chose “urea is reabsorbed” in both quizzes — a recurring misconception." },
  { name: "Nutrition & Photosynthesis", level: "medium", m: 51, why: "Light reaction fixed (+40 pts); dark-reaction inputs still confused." },
  { name: "Respiration", level: "medium", m: 71, why: "Lactic acid vs ethanol now correct; short answers miss the role of oxygen." },
  { name: "Transportation", level: "strong", m: 91, why: "Consistently correct on the heart and double circulation." },
];

export default function Landing() {
  const { ready, user } = useApp();
  const cta = ready && user ? { href: "/dashboard", label: "Open my dashboard →" } : { href: "/login", label: "Get started →" };
  return (
    <div className="landing">
      <header className="land-nav">
        <div className="logo" style={{ padding: 0, color: "var(--ink)" }}>
          <span className="logo-mark">◎</span> GapFinder AI
        </div>
        <div className="row">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <ThemeToggle size="sm" />
          <Link className="btn sm" href={cta.href}>{ready && user ? "Dashboard" : "Log in"}</Link>
        </div>
      </header>

      <section className="hero">
        <span className="badge brand">Hackathon PS 2026 · Find What the Student Doesn&apos;t Know</span>
        <h1>Stop Studying Everything. Start Fixing What You Don&apos;t Know.</h1>
        <p>
          Students revise every chapter equally and still miss their real gaps — because you can&apos;t ask about something you don&apos;t
          know you&apos;re missing. GapFinder AI tests you on <b>your own</b> syllabus, notes and past papers, diagnoses your weak topics
          with evidence, and builds a revision plan that adapts as you improve.
        </p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="btn" href={cta.href}>{cta.label}</Link>
          <a className="btn secondary" href="#sample">See a sample diagnosis</a>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>Find What You Don&apos;t Know. Master What Matters.</p>
      </section>

      <section id="how" className="land-section">
        <h2>How GapFinder works</h2>
        <div className="grid grid-3">
          {STEPS.map(([t, d], i) => (
            <div className="card" key={t}>
              <span className="qnum">{i + 1}</span>
              <h3 style={{ marginTop: 10 }}>{t}</h3>
              <p className="muted" style={{ margin: 0 }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="sample" className="land-section">
        <h2>Sample diagnostic report</h2>
        <div className="card">
          <div className="row between">
            <b>Biology — Life Processes · after 2 diagnostic quizzes</b>
            <span className="muted" style={{ fontSize: 13 }}>Overall mastery 61% · 5/5 topics assessed</span>
          </div>
          <div className="stack" style={{ marginTop: 12 }}>
            {SAMPLE.map((s) => (
              <div key={s.name} className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start", borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
                <span className={`badge ${s.level}`} style={{ minWidth: 86, justifyContent: "center" }}>
                  {s.level === "weak" ? "🔴 Weak" : s.level === "medium" ? "🟡 Medium" : "🟢 Strong"}
                </span>
                <div style={{ flex: 1 }}>
                  <div className="row between"><b>{s.name}</b><span>{s.m}%</span></div>
                  <div className={`bar ${s.level}`} style={{ margin: "4px 0" }}><span style={{ width: `${s.m}%` }} /></div>
                  <span className="muted" style={{ fontSize: 13.5 }}>{s.why}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>
            → Plan: Day 1 starts with Excretion (nephron reabsorption) and the dark reaction; spaced reviews on day 3; re-test on day 5.
          </p>
        </div>
      </section>

      <section id="features" className="land-section">
        <h2>Built for diagnosis</h2>
        <div className="grid grid-3">
          {FEATURES.map(([t, d]) => (
            <div className="card" key={t}>
              <h3>{t}</h3>
              <p className="muted" style={{ margin: 0 }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="land-section" style={{ textAlign: "center" }}>
        <h2>Ready to find your gaps?</h2>
        <p className="muted">Upload your syllabus and notes, diagnose knowledge gaps, and follow a personalised plan.</p>
        <Link className="btn" href={cta.href}>{cta.label}</Link>
      </section>
      <footer className="muted" style={{ textAlign: "center", padding: 24, fontSize: 13 }}>
        GapFinder AI · Next.js · Vercel AI SDK · Groq · built for Hackathon PS 2026
      </footer>
    </div>
  );
}
