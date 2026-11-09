"use client";
// Persistence: accounts + session in localStorage, each student's data in IndexedDB
// (large PDFs don't fit in localStorage's ~5 MB). No external database needed.
import type { StudentData, User } from "./types";
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

async function pullRemote(email: string): Promise<any | null> {
  const r = await remote(email);
  if (!r) return null;
  try {
    const { data } = await r.sb.from("student_state").select("data").eq("user_id", r.uid).maybeSingle();
    return data?.data ?? null;
  } catch {
    return null;
  }
}

async function pushRemote(email: string, d: StudentData): Promise<void> {
  const r = await remote(email);
  if (!r) return;
  try {
    await r.sb.from("student_state").upsert({ user_id: r.uid, data: d, updated_at: new Date().toISOString() });
  } catch {
    /* offline or table missing: local copy still works */
  }
}

/** Fills fields added in later versions so older saved data keeps working. */
function normalize(d: any): StudentData {
  return {
    ...d,
    version: 2,
    agentRuns: d.agentRuns ?? [],
    planPrefs: d.planPrefs ?? { days: 5, hoursPerDay: 2 },
    materials: (d.materials ?? []).map((m: any) => ({ status: "ready", hash: "", wordCount: 0, headings: [], warnings: [], ...m })),
    topics: (d.topics ?? []).map((t: any) => ({ description: "", learningObjectives: [], prerequisites: [], ...t })),
    pastQuestions: (d.pastQuestions ?? []).map((q: any) => ({ confidence: 1, needsReview: false, marks: null, qtype: "other", difficulty: "medium", ...q })),
    reports: (d.reports ?? []).filter((r: any) => r.coverage), // old-format reports are regenerated on the next quiz
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