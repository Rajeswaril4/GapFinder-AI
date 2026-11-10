// Server-side endpoint to persist student state and quiz attempts into Supabase.
// Handles state compaction to keep payload size small and ensure 100% reliable cloud sync.

import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

function compactData(d: any): any {
  if (!d || typeof d !== "object") return d;
  return {
    version: d.version ?? 2,
    subject: d.subject ?? "",
    planPrefs: d.planPrefs ?? { days: 5, hoursPerDay: 2 },
    materials: (Array.isArray(d.materials) ? d.materials : []).map((m: any) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      detectedKind: m.detectedKind,
      status: m.status,
      hash: m.hash,
      wordCount: m.wordCount,
      headings: m.headings,
      warnings: m.warnings,
      createdAt: m.createdAt,
      pageCount: Array.isArray(m.pages) ? m.pages.length : 0,
    })),
    // Strip heavy chunk texts from cloud snapshot (chunks are in Qdrant & IndexedDB)
    chunks: (Array.isArray(d.chunks) ? d.chunks : []).map((c: any) => ({
      id: c.id,
      materialId: c.materialId,
      materialName: c.materialName,
      kind: c.kind,
      section: c.section,
      page: c.page,
      text: typeof c.text === "string" ? c.text.slice(0, 160) : "",
    })),
    topics: Array.isArray(d.topics) ? d.topics : [],
    pastQuestions: Array.isArray(d.pastQuestions) ? d.pastQuestions : [],
    attempts: Array.isArray(d.attempts) ? d.attempts : [],
    reports: Array.isArray(d.reports) ? d.reports : [],
    plan: d.plan ?? null,
    agentRuns: (Array.isArray(d.agentRuns) ? d.agentRuns : []).slice(-20),
  };
}

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdminClient();
    if (!admin) {
      return Response.json({ error: "Supabase not configured on server" }, { status: 503 });
    }

    let userId: string | null = null;

    // 1. Check Bearer token from Authorization header
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      const { data } = await admin.auth.getUser(token);
      if (data.user) userId = data.user.id;
    }

    // 2. Fall back to cookie session
    if (!userId) {
      const sb = await getSupabaseServerClient();
      if (sb) {
        const { data } = await sb.auth.getUser();
        if (data.user) userId = data.user.id;
      }
    }

    const body = await req.json().catch(() => ({}));
    const dataUserId = body.userId;
    const finalUserId = userId || dataUserId;

    if (!finalUserId) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const rawData = body.data;
    if (!rawData) {
      return Response.json({ error: "No data payload provided" }, { status: 400 });
    }

    const compacted = compactData(rawData);
    const nowIso = new Date().toISOString();

    // 1. Upsert into student_state
    const { error: stateErr } = await admin.from("student_state").upsert({
      user_id: finalUserId,
      data: compacted,
      updated_at: nowIso,
    });

    if (stateErr) {
      console.error("[api/student/state] Upsert student_state error:", stateErr);
    }

    // 2. If an attempt is passed or present in data, persist to quiz_attempts table
    const attempt = body.attempt || (Array.isArray(compacted.attempts) ? compacted.attempts[compacted.attempts.length - 1] : null);
    if (attempt && attempt.id) {
      try {
        await admin.from("quiz_attempts").upsert({
          id: attempt.id,
          user_id: finalUserId,
          answers: attempt.answers || {},
          confidence: attempt.confidence || {},
          created_at: attempt.createdAt ? new Date(attempt.createdAt).toISOString() : nowIso,
        });
      } catch (attErr) {
        console.warn("[api/student/state] Upsert quiz_attempt warning:", attErr);
      }
    }

    return Response.json({ success: true, updated_at: nowIso });
  } catch (err) {
    console.error("[api/student/state] Error:", err);
    return Response.json({ error: (err as Error).message || "Sync failed" }, { status: 500 });
  }
}
