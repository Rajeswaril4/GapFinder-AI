"use client";
import type { Confidence, Level, Priority } from "@/lib/types";

export function Spinner() {
  return <span className="spinner" aria-hidden />;
}

export function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: "secondary" | "danger" | "ghost"; size?: "sm" }
) {
  const { loading, variant, size, className, children, disabled, ...rest } = props;
  return (
    <button {...rest} disabled={disabled || loading} className={["btn", variant, size, className].filter(Boolean).join(" ")}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

const LEVEL_LABEL: Record<Level, string> = { weak: "Weak", medium: "Medium", strong: "Strong", untested: "Not assessed" };
const LEVEL_ICON: Record<Level, string> = { weak: "🔴", medium: "🟡", strong: "🟢", untested: "⚪" };

export function LevelBadge({ level }: { level: Level }) {
  return (
    <span className={`badge ${level}`}>
      {LEVEL_ICON[level]} {LEVEL_LABEL[level]}
    </span>
  );
}

export function ConfidenceBadge({ c }: { c: Confidence }) {
  return (
    <span className="badge" title="How much evidence this level is based on">
      {c === "high" ? "●●●" : c === "medium" ? "●●○" : "●○○"} {c} confidence
    </span>
  );
}

export function PriorityBadge({ p }: { p: Priority }) {
  const cls = p === "high" ? "weak" : p === "medium" ? "medium" : "strong";
  return <span className={`badge ${cls}`}>{p} priority</span>;
}

export function Bar({ value, level }: { value: number; level?: Level }) {
  return (
    <div className={`bar ${level ?? ""}`}>
      <span style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export function Alert({ kind, children }: { kind?: "error" | "ok" | "info"; children: React.ReactNode }) {
  return <div className={`alert ${kind ?? ""}`}>{children}</div>;
}

export function PageHead({ title, desc, children }: { title: string; desc?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: 36 }}>
      <h3>{title}</h3>
      <div className="muted">{children}</div>
    </div>
  );
}

export function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export function when(ts: number) {
  return new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
