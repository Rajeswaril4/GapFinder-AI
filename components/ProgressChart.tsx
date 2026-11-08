"use client";
import { useState } from "react";
import type { StudentData } from "@/lib/types";
import { attemptScore, attemptTopicScores } from "@/lib/analysis";

const COLORS = ["#0e7490", "#d97706", "#db2777", "#16a34a", "#7c3aed", "#dc2626", "#2563eb", "#65a30d", "#9333ea", "#ea580c", "#0891b2", "#be123c"];

/** Line chart of overall score + per-topic score across quiz attempts (hand-rolled SVG, no chart lib). */
export function ProgressChart({ data }: { data: StudentData }) {
  const attempts = [...data.attempts].sort((a, b) => a.createdAt - b.createdAt);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  if (attempts.length === 0) return <p className="muted">Take a diagnostic quiz to start tracking progress.</p>;

  const W = 640, H = 240, P = { l: 44, r: 40, t: 14, b: 30 };
  const xs = (i: number) => P.l + (attempts.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (attempts.length - 1));
  const ys = (v: number) => P.t + (1 - v) * (H - P.t - P.b);
  const perAttempt = attempts.map(attemptTopicScores);

  const series = [
    { id: "overall", name: "Overall", color: "#4f46e5", width: 3.5, pts: attempts.map((a, i) => [i, attemptScore(a)] as [number, number]) },
    ...data.topics.map((t, k) => ({
      id: t.id,
      name: t.name,
      color: COLORS[k % COLORS.length],
      width: 2,
      pts: perAttempt.map((s, i) => [i, s[t.id]] as [number, number]).filter(([, v]) => v !== undefined),
    })),
  ];

  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Score per attempt">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={ys(v)} y2={ys(v)} stroke="#e4e7ef" strokeDasharray={v === 0 ? "" : "3 4"} />
            <text x={P.l - 8} y={ys(v) + 4} fontSize="11" textAnchor="end" fill="#5d6478">{Math.round(v * 100)}%</text>
          </g>
        ))}
        <rect x={P.l} width={W - P.l - P.r} y={ys(0.5)} height={ys(0) - ys(0.5)} fill="#fef2f2" opacity="0.5" />
        {attempts.map((a, i) => (
          <text key={a.id} x={xs(i)} y={H - 8} fontSize="11" textAnchor="middle" fill="#5d6478">Attempt {i + 1}</text>
        ))}
        {series
          .filter((s) => !hidden.has(s.id) && s.pts.length)
          .map((s) => (
            <g key={s.id}>
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth={s.width}
                strokeLinejoin="round"
                points={s.pts.map(([i, v]) => `${xs(i)},${ys(v)}`).join(" ")}
              />
              {s.pts.map(([i, v]) => (
                <circle key={i} cx={xs(i)} cy={ys(v)} r={s.id === "overall" ? 5 : 3.5} fill="#fff" stroke={s.color} strokeWidth="2">
                  <title>{`${s.name} — attempt ${i + 1}: ${Math.round(v * 100)}%`}</title>
                </circle>
              ))}
            </g>
          ))}
      </svg>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        {series.map((s) => (
          <button
            key={s.id}
            onClick={() => toggle(s.id)}
            className="chip"
            style={{ border: 0, cursor: "pointer", opacity: hidden.has(s.id) ? 0.4 : 1 }}
          >
            <span className="dot" style={{ background: s.color, marginRight: 6 }} />
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "Attempt 1: 40% on Algebra → Attempt 3: 75%" style table. */
export function ProgressTable({ data }: { data: StudentData }) {
  const attempts = [...data.attempts].sort((a, b) => a.createdAt - b.createdAt);
  if (!attempts.length) return null;
  const per = attempts.map(attemptTopicScores);
  const cell = (v?: number) =>
    v === undefined ? (
      <span className="muted">—</span>
    ) : (
      <span style={{ fontWeight: 600, color: v < 0.5 ? "var(--weak)" : v < 0.75 ? "var(--medium)" : "var(--strong)" }}>
        {Math.round(v * 100)}%
      </span>
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Topic</th>
            {attempts.map((a, i) => (
              <th key={a.id}>Attempt {i + 1}</th>
            ))}
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          {data.topics.map((t) => {
            const vals = per.map((p) => p[t.id]).filter((v) => v !== undefined) as number[];
            const delta = vals.length > 1 ? vals[vals.length - 1] - vals[0] : undefined;
            return (
              <tr key={t.id}>
                <td>{t.name}</td>
                {per.map((p, i) => (
                  <td key={i}>{cell(p[t.id])}</td>
                ))}
                <td>
                  {delta === undefined ? (
                    <span className="muted">—</span>
                  ) : (
                    <span style={{ color: delta > 0 ? "var(--strong)" : delta < 0 ? "var(--weak)" : "var(--muted)", fontWeight: 600 }}>
                      {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(Math.round(delta * 100))} pts
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
          <tr>
            <td><b>Overall</b></td>
            {attempts.map((a) => (
              <td key={a.id}>{cell(attemptScore(a))}</td>
            ))}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
