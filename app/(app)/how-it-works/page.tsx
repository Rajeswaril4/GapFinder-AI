"use client";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { PageHead } from "@/components/ui";

const ROWS: [string, string, string, string][] = [
  ["Upload", "PDF text extracted per page; type detection, duplicate fingerprinting, heading-aware chunking with overlap (heading + page kept for citations); BM25 index built.", "—", "Only uploaded text is ever indexed; empty/scanned pages are flagged, never silently dropped."],
  ["Topic map", "Each notes section is linked to the topic it matches best; every past-paper question is mapped to a topic with BM25 → exam weight.", "LLM reads the syllabus text and lists topics, subtopics, keywords.", "Prompt forbids topics not in the syllabus. Mapping is deterministic and shows its match score."],
  ["Diagnostic quiz", "For each topic, top sections are retrieved (plus sections on previously-wrong subtopics). Question count per topic is weighted to weak/untested topics.", "LLM writes MCQ / short questions from those chunks only, with a verbatim quote and chunk id.", "Grounding check: a question is rejected if it cites a chunk that wasn't retrieved or its quote isn't found in that chunk."],
  ["Answer evaluation", "The cited chunk's text is sent with each question.", "LLM scores short answers against a rubric and explains every wrong answer, naming the misconception.", "MCQ, true/false, multi-select, exact fill-ins and numericals (with tolerance) are scored by the answer key in code. Keyword-rubric fallback if the AI is down."],
  ["Gap report", "—", "LLM writes the reason and next step for each topic from the computed evidence, misconceptions and the student's confidence.", "Mastery = weighted by recency × difficulty × question type; level (≥80% strong, <50% weak, no answers = not assessed), confidence and priority are computed in code. The model cannot change them."],
  ["Revision plan", "Each topic's best sections are attached as study sources.", "LLM turns each scheduled block into a concrete task that targets the diagnosed mistakes.", "Order and minutes come from a deterministic scheduler (priority^1.5, time budget, spaced review, re-test). Rebuilt automatically after every quiz."],
  ["Explain a topic", "Top-4 sections retrieved for the question in the browser; if none score above a threshold, the app answers “not in your material” without calling the AI.", "LLM streams an explanation using only the numbered sources and cites [n].", "System prompt forbids outside knowledge; sources shown under every answer."],
];

export default function HowItWorks() {
  const { data } = useApp();
  const [health, setHealth] = useState<{ model: string; groqKeyConfigured: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
  }, []);

  return (
    <>
      <PageHead
        title="How it works"
        desc="The core loop is Upload → Test → Find weak spots → Plan → Re-test → Plan updates. Retrieval and generation are separate layers: retrieval decides what text the AI may see; generation only rewrites that text into questions, feedback and plans."
      />

      <div className="card">
        <h2>Pipeline</h2>
        <div className="pipeline">
          <div className="pipe-step r"><b>1. Upload</b>Chunk + BM25 index</div>
          <div className="pipe-step g"><b>2. Topic map</b>Syllabus → topics; past Qs mapped</div>
          <div className="pipe-step g"><b>3. Quiz</b>Grounded questions + citations</div>
          <div className="pipe-step g"><b>4. Evaluate</b>Right/wrong + why</div>
          <div className="pipe-step d"><b>5. Gap report</b>Computed levels + AI reasons</div>
          <div className="pipe-step d"><b>6. Plan</b>Scheduler + AI tasks → re-test</div>
        </div>
        <div className="row" style={{ marginTop: 10, gap: 8, fontSize: 13 }}>
          <span className="badge retrieval">Retrieval = deterministic BM25, runs in the browser</span>
          <span className="badge generation">Generation = Groq LLM via Vercel AI SDK, server routes</span>
          <span className="badge">Grey = computed in code</span>
          <a href="/agents" style={{ fontSize: 13 }}>See the 10 agents and their execution log →</a>
        </div>
      </div>

      <div className="spacer" />
      <div className="card">
        <h2>Where retrieval vs. generation is used</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Feature</th>
                <th><span className="badge retrieval">Retrieval</span></th>
                <th><span className="badge generation">Generation</span></th>
                <th>How they're kept separate</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r[0]}>
                  <td><b>{r[0]}</b></td>
                  <td>{r[1]}</td>
                  <td>{r[2]}</td>
                  <td>{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="spacer" />
      <div className="grid grid-3">
        <div className="card">
          <div className="stat">{data.chunks.length}</div>
          <div className="stat-label">chunks in your retrieval index</div>
        </div>
        <div className="card">
          <div className="stat" style={{ fontSize: 18, wordBreak: "break-all" }}>{health?.model ?? "…"}</div>
          <div className="stat-label">generation model (Groq)</div>
        </div>
        <div className="card">
          <div className="stat" style={{ fontSize: 18, color: health?.groqKeyConfigured ? "var(--strong)" : "var(--weak)" }}>
            {health ? (health.groqKeyConfigured ? "Connected" : "GROQ_API_KEY missing") : "…"}
          </div>
          <div className="stat-label">AI status</div>
        </div>
      </div>
    </>
  );
}
