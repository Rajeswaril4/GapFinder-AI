"use client";
import { useApp } from "@/components/AppProvider";
import { PageHead, when } from "@/components/ui";
import type { AgentName } from "@/lib/types";
import { AGENTS } from "@/lib/agents";



export default function AgentsPage() {
  const { data } = useApp();
  const runs = data.agentRuns ?? [];
  const count = (n: AgentName) => runs.filter((r) => r.agent === n).length;
  return (
    <>
      <PageHead
        title="Agent activity"
        desc="GapFinder uses ten specialised agents in a fixed, deterministic workflow — no agent calls another on its own. Each run is logged with its input, output, duration and status (ok / fallback / error)."
      />
      <div className="card">
        <h2>The agents</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Agent</th><th>Runs as</th><th>Responsibility</th><th>Code</th><th>Runs</th></tr></thead>
            <tbody>
              {AGENTS.map((a, i) => (
                <tr key={a.name}>
                  <td>{i + 1}</td>
                  <td><b>{a.name}</b></td>
                  <td>
                    <span className={`badge ${a.kind === "code" ? "retrieval" : a.kind === "ai" ? "generation" : "brand"}`}>
                      {a.kind === "code" ? "code" : a.kind === "ai" ? "LLM" : "code + LLM"}
                    </span>
                  </td>
                  <td style={{ fontSize: 13.5 }}>{a.role}</td>
                  <td><code>{a.where}</code></td>
                  <td>{count(a.name)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="spacer" />
      <div className="card">
        <h2>Execution log ({runs.length})</h2>
        {!runs.length ? (
          <p className="muted">No runs yet.</p>
        ) : (
          <div className="table-wrap">
            <table style={{ fontSize: 13.5 }}>
              <thead><tr><th>When</th><th>Agent</th><th>Status</th><th>Input</th><th>Output</th><th>Time</th></tr></thead>
              <tbody>
                {runs.slice(0, 60).map((r) => (
                  <tr key={r.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{when(r.at)}</td>
                    <td><b>{r.agent}</b></td>
                    <td><span className={`badge ${r.status === "ok" ? "strong" : r.status === "fallback" ? "medium" : "weak"}`}>{r.status}</span></td>
                    <td>{r.input}</td>
                    <td>{r.output}</td>
                    <td className="muted">{r.ms < 1000 ? `${r.ms} ms` : `${(r.ms / 1000).toFixed(1)} s`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
