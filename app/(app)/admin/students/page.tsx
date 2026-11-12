"use client";
// Admin dashboard: add, view, modify and remove users. All changes go through /api/admin/*,
// which re-checks on the server that the caller is an admin (this page's check is only for UX).
import { useCallback, useEffect, useMemo, useState } from "react";
import { getAuthUser } from "@/lib/auth";
import { useApp } from "@/components/AppProvider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Alert, Button, LevelBadge, PageHead, pct } from "@/components/ui";
import { levelOf } from "@/lib/admin-summary";

type Role = "student" | "teacher" | "admin";
interface Row {
  id: string; email: string; fullName: string; role: Role; createdAt: string; lastSignIn: string | null;
  subject: string; materials: number; topics: number; quizzes: number; mastery: number | null; lastActive: string | null;
}
interface Detail {
  profile: { id: string; email: string; fullName: string; role: Role; createdAt: string; updatedAt: string };
  auth: { lastSignIn: string | null; confirmed: boolean };
  study: null | {
    subject: string; materials: { name: string; kind: string }[]; topicCount: number;
    attempts: { at: number; questions: number; score: number }[]; mastery: number | null; coverage: { assessed: number; total: number } | null;
    weakTopics: string[]; summary: string; hasPlan: boolean; planDays: number; savedAt: string;
  };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const sb = getSupabaseBrowserClient();
  const session = (await sb?.auth.getSession().catch(() => null))?.data?.session;
  const token = session?.access_token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init?.headers as Record<string, string>) || {}),
  };
  const res = await fetch(url, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const fmt = (s?: string | number | null) => (s ? new Date(s).toLocaleString() : "—");

export default function AdminStudentsPage() {
  const { user } = useApp();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: "error" | "ok" | "info"; text: string } | null>(null);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"all" | Role>("student");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", password: "", role: "student" as Role });
  const [edit, setEdit] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState({ fullName: "", email: "", password: "", role: "student" as Role });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ students: Row[]; warning?: string }>("/api/admin/students");
      setRows(r.students);
      if (r.warning) setMsg({ kind: "info", text: r.warning });
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === "admin") {
      setAllowed(true);
      load();
    } else {
      getAuthUser().then((u) => {
        const ok = u?.role === "admin";
        setAllowed(ok);
        if (ok) load();
      });
    }
  }, [user, load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (role === "all" || r.role === role) && (!s || r.fullName.toLowerCase().includes(s) || r.email.toLowerCase().includes(s)));
  }, [rows, q, role]);

  const students = rows.filter((r) => r.role === "student");
  const active = students.filter((r) => r.quizzes > 0);
  const assessed = students.filter((r) => r.mastery != null);
  const avg = assessed.length ? assessed.reduce((s, r) => s + (r.mastery ?? 0), 0) / assessed.length : null;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "ok", text: ok });
      await load();
      return true;
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    if (await run(() => api("/api/admin/students", { method: "POST", body: JSON.stringify(form) }), `Created ${form.email}`)) {
      setForm({ fullName: "", email: "", password: "", role: "student" });
      setAdding(false);
    }
  }

  function openEdit(r: Row) {
    setEdit(r);
    setEditForm({ fullName: r.fullName, email: r.email, password: "", role: r.role });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const body: Record<string, string> = {};
    if (editForm.fullName !== edit.fullName) body.fullName = editForm.fullName;
    if (editForm.email !== edit.email) body.email = editForm.email;
    if (editForm.role !== edit.role) body.role = editForm.role;
    if (editForm.password) body.password = editForm.password;
    if (!Object.keys(body).length) return setEdit(null);
    if (await run(() => api(`/api/admin/students/${edit.id}`, { method: "PATCH", body: JSON.stringify(body) }), "Saved changes")) setEdit(null);
  }

  async function remove(r: Row) {
    if (!confirm(`Delete ${r.fullName} (${r.email})?\n\nThis permanently removes their account, uploaded materials, quizzes and reports.`)) return;
    await run(() => api(`/api/admin/students/${r.id}`, { method: "DELETE" }), `Deleted ${r.email}`);
  }

  async function view(r: Row) {
    setBusy(true);
    try {
      setDetail(await api<Detail>(`/api/admin/students/${r.id}`));
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (allowed === null) return <div className="muted">Checking access…</div>;
  if (!allowed)
    return (
      <>
        <PageHead title="Manage students" />
        <Alert kind="error">Admin access required. Log in with an admin account (role “admin” in the profiles table).</Alert>
      </>
    );

  const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(10,12,30,.55)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 };

  return (
    <>
      <PageHead title="Manage students" desc="Add, view, edit and remove accounts. Study progress is read from each student’s saved data.">
        <Button variant="secondary" onClick={load} loading={loading}>Refresh</Button>
        <Button onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "+ Add student"}</Button>
      </PageHead>

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card"><div className="muted">Students</div><h2>{students.length}</h2></div>
        <div className="card"><div className="muted">Took a quiz</div><h2>{active.length}</h2></div>
        <div className="card"><div className="muted">Average mastery</div><h2>{avg == null ? "—" : pct(avg)}</h2></div>
      </div>

      {adding && (
        <form className="card stack" onSubmit={addUser} style={{ marginBottom: 16 }}>
          <h3>New account</h3>
          <div className="grid grid-2">
            <div><label>Full name</label><input type="text" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
            <div><label>Email</label><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><label>Temporary password (min 6)</label><input type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <div><label>Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                <option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div><Button type="submit" loading={busy}>Create account</Button></div>
        </form>
      )}

      <div className="card">
        <div className="row" style={{ marginBottom: 12, gap: 8 }}>
          <input type="text" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
          <select value={role} onChange={(e) => setRole(e.target.value as "all" | Role)} style={{ maxWidth: 160 }}>
            <option value="student">Students</option><option value="teacher">Teachers</option><option value="admin">Admins</option><option value="all">Everyone</option>
          </select>
          <span className="muted">{shown.length} shown</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Subject</th><th>Files</th><th>Quizzes</th><th>Mastery</th><th>Last active</th><th>Joined</th><th></th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.fullName}</b></td>
                  <td>{r.email}</td>
                  <td><span className="badge">{r.role}</span></td>
                  <td>{r.subject || "—"}</td>
                  <td>{r.materials}</td>
                  <td>{r.quizzes}</td>
                  <td>{r.mastery == null ? <span className="muted">—</span> : <><LevelBadge level={levelOf(r.mastery)} /> {pct(r.mastery)}</>}</td>
                  <td>{fmt(r.lastActive ?? r.lastSignIn)}</td>
                  <td>{fmt(r.createdAt)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Button size="sm" variant="secondary" onClick={() => view(r)}>View</Button>{" "}
                    <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>Edit</Button>{" "}
                    <Button size="sm" variant="danger" onClick={() => remove(r)}>Delete</Button>
                  </td>
                </tr>
              ))}
              {!shown.length && !loading && (
                <tr><td colSpan={10} className="muted" style={{ textAlign: "center", padding: 24 }}>No accounts match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {edit && (
        <div style={overlay} onClick={() => setEdit(null)}>
          <form className="card stack" style={{ width: "min(480px, 100%)" }} onClick={(e) => e.stopPropagation()} onSubmit={saveEdit}>
            <h3>Edit {edit.email}</h3>
            <div><label>Full name</label><input type="text" required value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} /></div>
            <div><label>Email</label><input type="email" required value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></div>
            <div><label>Role</label>
              <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value as Role })}>
                <option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option>
              </select>
            </div>
            <div><label>New password (leave blank to keep)</label><input type="password" minLength={6} value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} /></div>
            <div className="row"><Button type="submit" loading={busy}>Save</Button><Button type="button" variant="secondary" onClick={() => setEdit(null)}>Cancel</Button></div>
          </form>
        </div>
      )}

      {detail && (
        <div style={overlay} onClick={() => setDetail(null)}>
          <div className="card stack" style={{ width: "min(640px, 100%)", maxHeight: "88vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <h3>{detail.profile.fullName}</h3>
              <Button size="sm" variant="secondary" onClick={() => setDetail(null)}>Close</Button>
            </div>
            <table>
              <tbody>
                <tr><th>Email</th><td>{detail.profile.email}</td></tr>
                <tr><th>Role</th><td>{detail.profile.role}</td></tr>
                <tr><th>Joined</th><td>{fmt(detail.profile.createdAt)}</td></tr>
                <tr><th>Last sign-in</th><td>{fmt(detail.auth.lastSignIn)}</td></tr>
                <tr><th>Email confirmed</th><td>{detail.auth.confirmed ? "Yes" : "No"}</td></tr>
                <tr><th>User id</th><td style={{ fontFamily: "monospace", fontSize: 12 }}>{detail.profile.id}</td></tr>
              </tbody>
            </table>
            {!detail.study ? (
              <div className="muted">No study data saved yet.</div>
            ) : (
              <>
                <h4>Study progress</h4>
                <table>
                  <tbody>
                    <tr><th>Subject</th><td>{detail.study.subject || "—"}</td></tr>
                    <tr><th>Overall mastery</th><td>{detail.study.mastery == null ? "Not assessed" : <><LevelBadge level={levelOf(detail.study.mastery)} /> {pct(detail.study.mastery)}</>}</td></tr>
                    <tr><th>Topics assessed</th><td>{detail.study.coverage ? `${detail.study.coverage.assessed} of ${detail.study.coverage.total}` : `${detail.study.topicCount} topics`}</td></tr>
                    <tr><th>Weak topics</th><td>{detail.study.weakTopics.length ? detail.study.weakTopics.join(", ") : "None"}</td></tr>
                    <tr><th>Revision plan</th><td>{detail.study.hasPlan ? `${detail.study.planDays} days` : "Not created"}</td></tr>
                    <tr><th>Data saved</th><td>{fmt(detail.study.savedAt)}</td></tr>
                  </tbody>
                </table>
                {detail.study.summary && <p className="muted">{detail.study.summary}</p>}
                <h4>Uploaded materials ({(detail.study.materials || []).length})</h4>
                {(detail.study.materials || []).length ? (
                  <ul>{(detail.study.materials || []).map((m, i) => <li key={i}>{m.name} <span className="badge">{m.kind}</span></li>)}</ul>
                ) : <div className="muted">None</div>}
                <h4>Quiz attempts ({(detail.study.attempts || []).length})</h4>
                {(detail.study.attempts || []).length ? (
                  <table>
                    <thead><tr><th>Date</th><th>Questions</th><th>Score</th></tr></thead>
                    <tbody>{(detail.study.attempts || []).map((a, i) => <tr key={i}><td>{fmt(a.at)}</td><td>{a.questions}</td><td>{pct(a.score)}</td></tr>)}</tbody>
                  </table>
                ) : <div className="muted">None</div>}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
