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

    // study stats are computed inside Postgres (admin_student_stats), so no big JSON is shipped
    const stats = new Map<string, any>();
    let warning: string | undefined;
    const rpc = await admin.rpc("admin_student_stats");
    if (rpc.error) warning = "Study stats unavailable (run the admin migration SQL).";
    else for (const r of (rpc.data as any[]) ?? []) stats.set(r.user_id, r);

    const lastSignIn = new Map<string, string | null>();
    try {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      data?.users.forEach((u) => lastSignIn.set(u.id, u.last_sign_in_at ?? null));
    } catch {
      /* optional */
    }

    const students = (profiles ?? []).map((p) => {
      const s = stats.get(p.id);
      return {
        id: p.id,
        email: p.email,
        fullName: p.full_name,
        role: p.role,
        createdAt: p.created_at,
        lastSignIn: lastSignIn.get(p.id) ?? null,
        subject: s?.subject ?? "",
        materials: s?.materials ?? 0,
        topics: s?.topics ?? 0,
        quizzes: s?.attempts ?? 0,
        mastery: s?.mastery == null ? null : Number(s.mastery),
        lastActive: s?.last_active ?? null,
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
