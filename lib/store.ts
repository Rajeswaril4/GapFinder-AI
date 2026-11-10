"use client";
// Persistence: accounts + session in localStorage, each student's data in IndexedDB
// (large PDFs don't fit in localStorage's ~5 MB). No external database needed.
import type { StudentData, User } from "./types";
import { emptyData } from "./types";
import { buildDemoData, DEMO_EMAIL, DEMO_PASSWORD } from "./seed";
export { DEMO_EMAIL, DEMO_PASSWORD } from "./seed";
import SHA256 from "crypto-js/sha256";
import { getSupabaseBrowserClient } from "./supabase/client";


const USERS_KEY = "gf_users";
const SESSION_KEY = "gf_session";
const DB_NAME = "gapfinder";
const STORE = "students";

const inMemoryStorage = new Map<string, string>();

function safeGet(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      const val = localStorage.getItem(key);
      if (val !== null) return val;
    }
  } catch {
    /* storage unavailable */
  }
  return inMemoryStorage.get(key) ?? null;
}

function safeSet(key: string, val: string | null) {
  if (val === null) inMemoryStorage.delete(key);
  else inMemoryStorage.set(key, val);
  try {
    if (typeof localStorage !== "undefined") {
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, val);
    }
  } catch {
    /* storage unavailable (private mode or Node environment) — app still works */
  }
}

// ---------- IndexedDB (tiny promise wrapper) ----------
let dbPromise: Promise<IDBDatabase> | null = null;
const memoryFallback = new Map<string, StudentData>();

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(STORE)) {
            req.result.createObjectStore(STORE);
          }
        } catch {
          /* store already created or upgrading */
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error || new Error("Failed to open IndexedDB"));
      };
      req.onblocked = () => {
        dbPromise = null;
        reject(new Error("IndexedDB connection blocked by another window or tab."));
      };
    } catch (err) {
      dbPromise = null;
      reject(err);
    }
  });
  return dbPromise;
}


// ---------- Supabase sync (best-effort; IndexedDB stays the fast local cache) ----------
// Table: public.student_state(user_id uuid pk, data jsonb, updated_at timestamptz) with RLS.
async function remote(email: string) {
  try {
    if (email.toLowerCase() === DEMO_EMAIL) return null; // demo stays local
    const sb = getSupabaseBrowserClient();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    return user ? { sb, uid: user.id } : null;
  } catch {
    return null;
  }
}

function compactForRemote(d: StudentData): any {
  return {
    ...d,
    materials: (d.materials ?? []).map((m: any) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      detectedKind: m.detectedKind,
      status: m.status ?? "ready",
      hash: m.hash ?? "",
      wordCount: m.wordCount ?? 0,
      headings: m.headings ?? [],
      warnings: m.warnings ?? [],
      createdAt: m.createdAt,
      pages: Array.isArray(m.pages) ? m.pages.slice(0, 3) : [],
    })),
    chunks: (d.chunks ?? []).map((c: any) => ({
      id: c.id,
      materialId: c.materialId,
      materialName: c.materialName,
      kind: c.kind,
      section: c.section,
      page: c.page,
      text: typeof c.text === "string" ? c.text.slice(0, 160) : "",
    })),
    agentRuns: (d.agentRuns ?? []).slice(-20),
  };
}

async function pullRemote(email: string): Promise<any | null> {
  const r = await remote(email);
  if (!r) return null;
  let cloudData: any = null;
  try {
    const { data } = await r.sb.from("student_state").select("data").eq("user_id", r.uid).maybeSingle();
    cloudData = data?.data ?? null;
  } catch {
    cloudData = null;
  }

  // Hydrate from documents table if materials are missing or new
  try {
    const { data: docs } = await r.sb.from("documents").select("*").eq("user_id", r.uid);
    if (docs?.length) {
      cloudData = cloudData || {
        ...emptyData(),
        subject: docs[0]?.name ? docs[0].name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ") : "General Studies",
      };
      const existingIds = new Set((cloudData.materials || []).map((m: any) => m.id || m.name));
      const dbMaterials = docs.filter((d: any) => !existingIds.has(d.id) && !existingIds.has(d.name)).map((d: any) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        detectedKind: d.detected_kind,
        pages: [],
        createdAt: new Date(d.created_at).getTime(),
        status: d.status || "ready",
        hash: d.hash || "",
        wordCount: d.word_count || 0,
        headings: d.headings || [],
        warnings: d.warnings || [],
      }));
      cloudData.materials = [...(cloudData.materials || []), ...dbMaterials];
    }
  } catch (err) {
    console.warn("[store] Document hydration fallback:", err);
  }

  // Hydrate from quiz_attempts table if attempts are missing
  try {
    const { data: attempts } = await r.sb.from("quiz_attempts").select("*").eq("user_id", r.uid);
    if (attempts?.length) {
      cloudData = cloudData || {
        ...emptyData(),
        subject: "General Studies",
      };
      const existingAttemptIds = new Set((cloudData.attempts || []).map((a: any) => a.id));
      const dbAttempts = attempts.filter((a: any) => !existingAttemptIds.has(a.id)).map((a: any) => ({
        id: a.id,
        createdAt: new Date(a.created_at).getTime(),
        questions: [],
        answers: a.answers || {},
        confidence: a.confidence || {},
        timeSpentSec: 0,
        evaluations: [],
      }));
      if (dbAttempts.length) {
        cloudData.attempts = [...(cloudData.attempts || []), ...dbAttempts];
      }
    }
  } catch (err) {
    console.warn("[store] Quiz attempts hydration fallback:", err);
  }

  return cloudData ? normalize(cloudData) : null;
}

async function pushRemote(email: string, d: StudentData): Promise<void> {
  if (email.toLowerCase() === DEMO_EMAIL) return;
  const compacted = compactForRemote(d);

  // 1. Try server endpoint /api/student/state (bypasses RLS issues and handles cloud sync securely)
  if (typeof window !== "undefined") {
    try {
      const sb = getSupabaseBrowserClient();
      const session = (await sb?.auth.getSession().catch(() => null))?.data?.session;
      const token = session?.access_token;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      const res = await fetch("/api/student/state", {
        method: "POST",
        headers,
        body: JSON.stringify({ data: compacted, userId: session?.user?.id }),
      });
      if (res.ok) return;
    } catch (err) {
      console.warn("[store] Server state sync fallback:", err);
    }
  }

  // 2. Direct client upsert fallback
  const r = await remote(email);
  if (!r) return;
  try {
    await r.sb.from("student_state").upsert({ user_id: r.uid, data: compacted, updated_at: new Date().toISOString() });
  } catch (err) {
    console.warn("[store] Direct state upsert fallback:", err);
  }
}

/** Fills fields added in later versions so older saved data keeps working. */
function normalize(d: any): StudentData {
  const base = emptyData();
  if (!d || typeof d !== "object") return base;
  return {
    ...base,
    ...d,
    version: 2,
    subject: d.subject || base.subject,
    agentRuns: Array.isArray(d.agentRuns) ? d.agentRuns : [],
    planPrefs: d.planPrefs ?? { days: 5, hoursPerDay: 2 },
    materials: (Array.isArray(d.materials) ? d.materials : []).map((m: any) => ({
      status: "ready",
      hash: "",
      wordCount: 0,
      headings: [],
      warnings: [],
      ...m,
    })),
    chunks: Array.isArray(d.chunks) ? d.chunks : [],
    topics: (Array.isArray(d.topics) ? d.topics : []).map((t: any) => ({
      description: "",
      learningObjectives: [],
      prerequisites: [],
      ...t,
    })),
    pastQuestions: (Array.isArray(d.pastQuestions) ? d.pastQuestions : []).map((q: any) => ({
      confidence: 1,
      needsReview: false,
      marks: null,
      qtype: "other",
      difficulty: "medium",
      ...q,
    })),
    attempts: Array.isArray(d.attempts) ? d.attempts : [],
    reports: (Array.isArray(d.reports) ? d.reports : []).filter((r: any) => r && r.coverage), // old-format reports are regenerated on the next quiz
    plan: d.plan ?? null,
  };
}

export async function loadData(email: string): Promise<StudentData | null> {
  const raw = await loadRaw(email);
  if (!raw) return null;
  // the demo account is simply rebuilt when its saved format is outdated
  if (raw.version !== 2 && email.toLowerCase() === DEMO_EMAIL) return null;
  return normalize(raw);
}

async function loadRaw(email: string): Promise<any | null> {
  let local: any | null = null;
  try {
    const db = await openDb();
    local = await new Promise((resolve, reject) => {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).get(email.toLowerCase());
      r.onsuccess = () => resolve((r.result as StudentData) ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    local = memoryFallback.get(email.toLowerCase()) ?? null;
  }
  if (local) return local;
  // new device / cleared browser: restore from Supabase and re-cache locally
  const cloud = await pullRemote(email);
  if (cloud) await saveLocal(email, cloud);
  return cloud;
}

async function saveLocal(email: string, data: StudentData): Promise<void> {
  memoryFallback.set(email.toLowerCase(), data);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(data, email.toLowerCase());
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* keep in memory */
  }
}

export async function saveData(email: string, data: StudentData): Promise<void> {
  await saveLocal(email, data);
  void pushRemote(email, data); // fire-and-forget so the UI never waits on the network
}

// ---------- accounts ----------
async function sha256(s: string): Promise<string> {
  return SHA256(s).toString();
}

export function readUsers(): User[] {
  try {
    return JSON.parse(safeGet(USERS_KEY) || "[]");
  } catch {
    return [];
  }
}
export function writeUsers(u: User[]) {
  safeSet(USERS_KEY, JSON.stringify(u));
}

export function syncLocalUser(u: { email: string; name: string; id?: string; role?: "student" | "teacher" | "admin" }): User {
  const users = readUsers();
  const normalized = u.email.trim().toLowerCase();
  let existing = users.find((x) => x.email.toLowerCase() === normalized);
  if (!existing) {
    existing = { email: normalized, name: u.name || normalized.split("@")[0], passHash: "", role: u.role || "student" };
    users.push(existing);
  } else {
    existing.name = u.name || existing.name;
    if (u.role) existing.role = u.role;
  }
  writeUsers(users);
  safeSet(SESSION_KEY, normalized);
  return existing;
}

/** Makes sure the demo account and its pre-loaded data exist. */
export async function ensureDemo(): Promise<void> {
  const users = readUsers();
  if (!users.find((u) => u.email === DEMO_EMAIL)) {
    users.push({ email: DEMO_EMAIL, name: "Demo Student", passHash: await sha256(DEMO_PASSWORD), demo: true });
    writeUsers(users);
  }
  if (!(await loadData(DEMO_EMAIL))) await saveData(DEMO_EMAIL, buildDemoData());
}

export async function resetDemo(): Promise<StudentData> {
  const d = buildDemoData();
  await saveData(DEMO_EMAIL, d);
  return d;
}

export async function login(email: string, password: string): Promise<User> {
  await ensureDemo();
  const u = readUsers().find((x) => x.email === email.trim().toLowerCase());
  if (!u || u.passHash !== (await sha256(password))) throw new Error("Wrong email or password.");
  safeSet(SESSION_KEY, u.email);
  return u;
}

export async function register(name: string, email: string, password: string): Promise<User> {
  const e = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error("Enter a valid email.");
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");
  const users = readUsers();
  if (users.find((x) => x.email === e)) throw new Error("An account with this email already exists.");
  const u: User = { email: e, name: name.trim() || e.split("@")[0], passHash: await sha256(password) };
  writeUsers([...users, u]);
  safeSet(SESSION_KEY, e);
  return u;
}

export function currentUser(): User | null {
  const e = safeGet(SESSION_KEY);
  if (!e) return null;
  return readUsers().find((u) => u.email === e) ?? null;
}

export function logout() {
  safeSet(SESSION_KEY, null);
}