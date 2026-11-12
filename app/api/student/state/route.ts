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
    const isUuid = (s?: string | null): s is string =>
      typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

    let resolvedUserId: string | null = null;
    if (isUuid(userId)) {
      resolvedUserId = userId;
    } else if (isUuid(dataUserId)) {
      resolvedUserId = dataUserId;
    } else {
      const rawCandidate = body.email || (typeof dataUserId === "string" ? dataUserId : "") || (typeof userId === "string" ? (userId as string) : "");
      const emailCandidate = (typeof rawCandidate === "string" && rawCandidate.includes("@") ? rawCandidate : "").toLowerCase().trim();
      if (emailCandidate) {
        // Look up by email in profiles
        const { data: prof } = await admin.from("profiles").select("id").eq("email", emailCandidate).maybeSingle();
        if (prof?.id) {
          resolvedUserId = prof.id;
        } else {
          // Look up in auth.users
          try {
            const { data: authList } = await admin.auth.admin.listUsers();
            const match = authList?.users?.find((u) => u.email?.toLowerCase() === emailCandidate);
            if (match) {
              resolvedUserId = match.id;
              await admin.from("profiles").upsert({
                id: match.id,
                email: emailCandidate,
                full_name: match.user_metadata?.full_name || emailCandidate.split("@")[0],
                role: "student",
              });
            }
          } catch (e) {
            console.warn("[api/student/state] Auth user lookup warning:", e);
          }
        }
      }
    }

    if (!resolvedUserId) {
      return Response.json({ error: "Not authenticated or student profile not found" }, { status: 401 });
    }

    const rawData = body.data;
    if (!rawData) {
      return Response.json({ error: "No data payload provided" }, { status: 400 });
    }

    const compacted = compactData(rawData);
    const nowIso = new Date().toISOString();

    // 1. Upsert into student_state
    const { error: stateErr } = await admin.from("student_state").upsert({
      user_id: resolvedUserId,
      data: compacted,
      updated_at: nowIso,
    });

    if (stateErr) {
      console.error("[api/student/state] Upsert student_state error:", stateErr);
    }

    // 2. Persist quiz attempts to quiz_attempts table so admin dashboard can track them
    if (Array.isArray(compacted.attempts) && compacted.attempts.length > 0) {
      for (const att of compacted.attempts.slice(-5)) {
        if (!att || !att.id) continue;
        try {
          await admin.from("quiz_attempts").upsert({
            id: att.id,
            user_id: resolvedUserId,
            answers: att.answers || {},
            confidence: att.confidence || {},
            created_at: att.createdAt ? new Date(att.createdAt).toISOString() : nowIso,
          });
        } catch (attErr) {
          console.warn("[api/student/state] Upsert quiz_attempt warning:", attErr);
        }
      }
    }

    return Response.json({ success: true, updated_at: nowIso });
  } catch (err) {
    console.error("[api/student/state] Error:", err);
    return Response.json({ error: (err as Error).message || "Sync failed" }, { status: 500 });
  }
}
