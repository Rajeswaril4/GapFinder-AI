"use client";
// Persistence: accounts + session in localStorage, each student's data in IndexedDB
// (large PDFs don't fit in localStorage's ~5 MB). No external database needed.
import type { StudentData, User } from "./types";
import { buildDemoData, DEMO_EMAIL, DEMO_PASSWORD } from "./seed";
import SHA256 from "crypto-js/sha256";


const USERS_KEY = "gf_users";
const SESSION_KEY = "gf_session";
const DB_NAME = "gapfinder";
const STORE = "students";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, val: string | null) {
  try {
    if (val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch {
    /* storage unavailable (private mode) — app still works for this tab */
  }
}

// ---------- IndexedDB (tiny promise wrapper) ----------
let dbPromise: Promise<IDBDatabase> | null = null;
const memoryFallback = new Map<string, StudentData>();

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
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
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).get(email.toLowerCase());
      r.onsuccess = () => resolve((r.result as StudentData) ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return memoryFallback.get(email.toLowerCase()) ?? null;
  }
}

export async function saveData(email: string, data: StudentData): Promise<void> {
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

// ---------- accounts ----------
async function sha256(s: string): Promise<string> {
  return SHA256(s).toString();
}

function readUsers(): User[] {
  try {
    return JSON.parse(safeGet(USERS_KEY) || "[]");
  } catch {
    return [];
  }
}
function writeUsers(u: User[]) {
  safeSet(USERS_KEY, JSON.stringify(u));
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
