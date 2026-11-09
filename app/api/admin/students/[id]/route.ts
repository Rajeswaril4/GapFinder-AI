// Admin: read one user's full information (GET), modify (PATCH), remove (DELETE).
import { z } from "zod";
import { AdminError, adminFail, requireAdmin } from "@/lib/admin-server";
import { summarizeStudent } from "@/lib/admin-summary";
import { deleteUserVectors } from "@/lib/vector/qdrant";

export const runtime = "nodejs";
export const maxDuration = 30;

const Patch = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    password: z.string().min(6, "Password must be at least 6 characters").max(72).optional(),
    role: z.enum(["student", "teacher", "admin"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

type Ctx = { params: Promise<{ id: string }> };
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export async function GET(req: Request, { params }: Ctx) {
  try {
    const { admin } = await requireAdmin(req);
    const { id } = await params;
    if (!isUuid(id)) throw new AdminError("Invalid user id", 400);
    const { data: p } = await admin.from("profiles").select("id, email, full_name, role, created_at, updated_at").eq("id", id).maybeSingle();
    if (!p) throw new AdminError("User not found", 404);
    const { data: u } = await admin.auth.admin.getUserById(id);
    const { data: st } = await admin.from("student_state").select("data, updated_at").eq("user_id", id).maybeSingle();
    return Response.json({
      profile: { id: p.id, email: p.email, fullName: p.full_name, role: p.role, createdAt: p.created_at, updatedAt: p.updated_at },
      auth: { lastSignIn: u?.user?.last_sign_in_at ?? null, confirmed: !!u?.user?.email_confirmed_at },
      study: st ? { ...summarizeStudent(st.data), savedAt: st.updated_at } : null,
    });
  } catch (e) {
    return adminFail(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { admin, adminId } = await requireAdmin(req);
    const { id } = await params;
    if (!isUuid(id)) throw new AdminError("Invalid user id", 400);
    const parsed = Patch.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AdminError(parsed.error.issues[0]?.message ?? "Invalid input", 400);
    const { fullName, email, password, role } = parsed.data;
    if (id === adminId && role && role !== "admin") throw new AdminError("You can't remove your own admin role.", 400);

    if (email || password || fullName) {
      const { error } = await admin.auth.admin.updateUserById(id, {
        ...(email ? { email, email_confirm: true } : {}),
        ...(password ? { password } : {}),
        ...(fullName ? { user_metadata: { full_name: fullName } } : {}),
      });
      if (error) throw new AdminError(error.message, /already|registered|exists/i.test(error.message) ? 409 : 400);
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (fullName) patch.full_name = fullName;
    if (email) patch.email = email;
    if (role) patch.role = role;
    const { error: pe } = await admin.from("profiles").update(patch).eq("id", id);
    if (pe) throw new AdminError(pe.message, 500);
    return Response.json({ ok: true });
  } catch (e) {
    return adminFail(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { admin, adminId } = await requireAdmin(req);
    const { id } = await params;
    if (!isUuid(id)) throw new AdminError("Invalid user id", 400);
    if (id === adminId) throw new AdminError("You can't delete your own account.", 400);
    // cascades to profiles, documents, chunks, quizzes and student_state (ON DELETE CASCADE)
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new AdminError(error.message, 400);
    await deleteUserVectors(id).catch(() => {}); // optional Qdrant cleanup
    return Response.json({ ok: true });
  } catch (e) {
    return adminFail(e);
  }
}
