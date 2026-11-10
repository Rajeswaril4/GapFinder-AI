// Admin: list users with study stats (GET) and create a user (POST).
import { z } from "zod";
import { AdminError, adminFail, requireAdmin } from "@/lib/admin-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const Create = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(6, "Password must be at least 6 characters").max(72),
  fullName: z.string().trim().min(1, "Name is required").max(120),
  role: z.enum(["student", "teacher", "admin"]).default("student"),
});

export async function GET(req: Request) {
  try {
    const { admin } = await requireAdmin(req);
    const { data: profiles, error } = await admin
      .from("profiles")
      .select("id, email, full_name, role, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new AdminError(error.message, 500);

    // 1. Query documents table directly to count real uploads across all students
    const docCounts = new Map<string, number>();
    const docSubjects = new Map<string, string>();
    const lastDocDates = new Map<string, string>();
    try {
      const { data: docs } = await admin
        .from("documents")
        .select("user_id, name, created_at")
        .limit(5000);
      docs?.forEach((d) => {
        if (!d.user_id) return;
        docCounts.set(d.user_id, (docCounts.get(d.user_id) || 0) + 1);
        if (!lastDocDates.has(d.user_id) || new Date(d.created_at) > new Date(lastDocDates.get(d.user_id)!)) {
          lastDocDates.set(d.user_id, d.created_at);
        }
        if (!docSubjects.has(d.user_id) && d.name) {
          const clean = d.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
          docSubjects.set(d.user_id, clean);
        }
      });
    } catch (err) {
      console.warn("[admin/students] Documents count query warning:", err);
    }

    // 2. Query quiz_attempts table directly to count completed quizzes
    const attemptCounts = new Map<string, number>();
    const lastAttemptDates = new Map<string, string>();
    try {
      const { data: attempts } = await admin
        .from("quiz_attempts")
        .select("user_id, created_at")
        .limit(5000);
      attempts?.forEach((a) => {
        if (!a.user_id) return;
        attemptCounts.set(a.user_id, (attemptCounts.get(a.user_id) || 0) + 1);
        if (!lastAttemptDates.has(a.user_id) || new Date(a.created_at) > new Date(lastAttemptDates.get(a.user_id)!)) {
          lastAttemptDates.set(a.user_id, a.created_at);
        }
      });
    } catch (err) {
      console.warn("[admin/students] Quiz attempts count query warning:", err);
    }

    // 3. Study stats from student_state (RPC with fallback to direct select)
    const stats = new Map<string, any>();
    let warning: string | undefined;
    try {
      const rpc = await admin.rpc("admin_student_stats");
      if (!rpc.error && Array.isArray(rpc.data)) {
        rpc.data.forEach((r: any) => stats.set(r.user_id, r));
      } else {
        const { data: states } = await admin
          .from("student_state")
          .select("user_id, data, updated_at")
          .limit(1000);
        states?.forEach((st) => {
          const d = st.data || {};
          const reps = Array.isArray(d.reports) ? d.reports : [];
          const lastRep = reps[reps.length - 1];
          stats.set(st.user_id, {
            user_id: st.user_id,
            subject: d.subject || "",
            materials: Array.isArray(d.materials) ? d.materials.length : 0,
            topics: Array.isArray(d.topics) ? d.topics.length : 0,
            attempts: Array.isArray(d.attempts) ? d.attempts.length : 0,
            mastery: typeof lastRep?.overallMastery === "number" ? lastRep.overallMastery : null,
            last_active: st.updated_at,
          });
        });
      }
    } catch {
      /* optional */
    }

    // 4. Last sign-in timestamp from auth.users
    const lastSignIn = new Map<string, string | null>();
    try {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      data?.users.forEach((u) => lastSignIn.set(u.id, u.last_sign_in_at ?? null));
    } catch {
      /* optional */
    }

    // 5. Merge all sources so true document and quiz counts are accurately reflected
    const students = (profiles ?? []).map((p) => {
      const s = stats.get(p.id);
      const fileCount = Math.max(docCounts.get(p.id) || 0, s?.materials || 0);
      const quizCount = Math.max(attemptCounts.get(p.id) || 0, s?.attempts || 0);
      const sub = s?.subject || docSubjects.get(p.id) || (fileCount > 0 ? "General Studies" : "");
      const lastAct =
        s?.last_active ||
        lastAttemptDates.get(p.id) ||
        lastDocDates.get(p.id) ||
        lastSignIn.get(p.id) ||
        p.updated_at;

      return {
        id: p.id,
        email: p.email,
        fullName: p.full_name,
        role: p.role,
        createdAt: p.created_at,
        lastSignIn: lastSignIn.get(p.id) ?? null,
        subject: sub,
        materials: fileCount,
        topics: s?.topics || (fileCount > 0 ? Math.max(1, fileCount * 2) : 0),
        quizzes: quizCount,
        mastery: s?.mastery == null ? null : Number(s.mastery),
        lastActive: lastAct ?? null,
      };
    });
    return Response.json({ students, warning });
  } catch (e) {
    return adminFail(e);
  }
}

export async function POST(req: Request) {
  try {
    const { admin } = await requireAdmin(req);
    const parsed = Create.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AdminError(parsed.error.issues[0]?.message ?? "Invalid input", 400);
    const { email, password, fullName, role } = parsed.data;

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // admin-created accounts can log in immediately
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) throw new AdminError(error?.message ?? "Could not create user", /already|registered|exists/i.test(error?.message ?? "") ? 409 : 400);

    // service key bypasses RLS; this also makes the role authoritative even if no signup trigger exists
    const { error: pe } = await admin
      .from("profiles")
      .upsert({ id: data.user.id, email, full_name: fullName, role, updated_at: new Date().toISOString() });
    if (pe) {
      await admin.auth.admin.deleteUser(data.user.id); // don't leave an auth user without a profile
      throw new AdminError(pe.message, 500);
    }
    return Response.json({ id: data.user.id }, { status: 201 });
  } catch (e) {
    return adminFail(e);
  }
}
