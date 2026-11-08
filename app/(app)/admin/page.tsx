"use client";

import { useEffect, useState } from "react";
import { getObservabilitySnapshot, ObservabilitySnapshot } from "@/lib/observability";

export default function ObservabilityDashboardPage() {
  const [data, setData] = useState<ObservabilitySnapshot | null>(null);

  useEffect(() => {
    setData(getObservabilitySnapshot());
  }, []);

  if (!data) return <div className="p-8 text-muted-foreground">Loading observability telemetry…</div>;

  const { systemStatus, metrics, recentEvents } = data;

  return (
    <div className="max-w-6xl mx-auto space-y-8 p-4">
      {/* Header */}
      <div className="border-b border-border pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary mb-2">
          System Administration & Telemetry
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Observability Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Production telemetry for Next.js 16, Gemini AI tokens, Qdrant hybrid retrieval, and Inngest jobs.
        </p>
      </div>

      {/* Component Status Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-card border border-border p-4 rounded-xl">
          <div className="text-xs text-muted-foreground font-semibold uppercase">Framework</div>
          <div className="text-lg font-bold mt-1">Next.js {systemStatus.nextJs}</div>
          <div className="text-xs text-emerald-500 font-medium mt-0.5">● React 19 Active</div>
        </div>

        <div className="bg-card border border-border p-4 rounded-xl">
          <div className="text-xs text-muted-foreground font-semibold uppercase">AI Provider</div>
          <div className="text-lg font-bold mt-1">Gemini Flash</div>
          <div className="text-xs text-emerald-500 font-medium mt-0.5">
            ● {systemStatus.gemini === "connected" ? "Cloud Active" : "Fallback Available"}
          </div>
        </div>

        <div className="bg-card border border-border p-4 rounded-xl">
          <div className="text-xs text-muted-foreground font-semibold uppercase">Vector DB</div>
          <div className="text-lg font-bold mt-1">Qdrant Cloud</div>
          <div className="text-xs text-emerald-500 font-medium mt-0.5">
            ● {systemStatus.qdrant === "healthy" ? "Dense + BM25" : "Hybrid Mode"}
          </div>
        </div>

        <div className="bg-card border border-border p-4 rounded-xl">
          <div className="text-xs text-muted-foreground font-semibold uppercase">Auth & Storage</div>
          <div className="text-lg font-bold mt-1">Supabase SSR</div>
          <div className="text-xs text-emerald-500 font-medium mt-0.5">
            ● {systemStatus.supabase === "connected" ? "PostgreSQL & RLS" : "Local / Demo Bridge"}
          </div>
        </div>

        <div className="bg-card border border-border p-4 rounded-xl">
          <div className="text-xs text-muted-foreground font-semibold uppercase">Workflows</div>
          <div className="text-lg font-bold mt-1">Inngest Engine</div>
          <div className="text-xs text-emerald-500 font-medium mt-0.5">● 8 Durable Functions</div>
        </div>
      </div>

      {/* Real-time Telemetry Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border p-5 rounded-xl">
          <div className="text-xs text-muted-foreground uppercase font-semibold">Total AI Requests</div>
          <div className="text-2xl font-bold mt-1">{metrics.totalAiRequests}</div>
          <p className="text-xs text-muted-foreground mt-1">Structured generation & rubric grading</p>
        </div>

        <div className="bg-card border border-border p-5 rounded-xl">
          <div className="text-xs text-muted-foreground uppercase font-semibold">Prompt Tokens</div>
          <div className="text-2xl font-bold font-mono text-primary mt-1">
            {metrics.totalPromptTokens.toLocaleString()}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Context chunks & schema instructions</p>
        </div>

        <div className="bg-card border border-border p-5 rounded-xl">
          <div className="text-xs text-muted-foreground uppercase font-semibold">Completion Tokens</div>
          <div className="text-2xl font-bold font-mono text-emerald-500 mt-1">
            {metrics.totalCompletionTokens.toLocaleString()}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Diagnostic items & plans written</p>
        </div>

        <div className="bg-card border border-border p-5 rounded-xl">
          <div className="text-xs text-muted-foreground uppercase font-semibold">Retrieval Latency</div>
          <div className="text-2xl font-bold mt-1">{metrics.averageRetrievalLatencyMs} ms</div>
          <p className="text-xs text-muted-foreground mt-1">Reciprocal Rank Fusion (Dense + BM25)</p>
        </div>
      </div>

      {/* Recent Telemetry Stream */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Execution Telemetry Stream</h2>
            <p className="text-xs text-muted-foreground">Recent AI queries, retrieval searches, and background events.</p>
          </div>
          <span className="text-xs text-muted-foreground font-mono">Live telemetry buffer</span>
        </div>

        <div className="divide-y divide-border text-sm">
          {recentEvents.map((ev) => (
            <div key={ev.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-full ${
                    ev.status === "success" ? "bg-emerald-500" : "bg-rose-500"
                  }`}
                />
                <div>
                  <div className="font-semibold">{ev.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    Category: {ev.category} • {JSON.stringify(ev.details)}
                  </div>
                </div>
              </div>
              <div className="text-right text-xs font-mono text-muted-foreground shrink-0">
                <span>{ev.durationMs} ms</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
