// SERVER-ONLY helpers for the admin API. Authorisation happens here, never in the browser.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient, getSupabaseServerClient } from "./supabase/server";

export class AdminError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Verifies the caller's session (via Bearer token or cookies) and that profiles.role = 'admin'.
 * The role is read from the profiles table with the service key. We deliberately do NOT trust
 * user_metadata, because signed-in users can edit their own metadata.
 */
export async function requireAdmin(req?: Request): Promise<{ admin: SupabaseClient; adminId: string }> {
  const admin = getSupabaseAdminClient();
  if (!admin) throw new AdminError("Supabase is not configured on the server (set SUPABASE_SERVICE_ROLE_KEY).", 503);

  let userId: string | null = null;

  // 1. Check Bearer token from incoming request Authorization header if present
  if (req) {
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      const { data, error } = await admin.auth.getUser(token);
      if (!error && data.user) {
        userId = data.user.id;
      }
    }
  }

  // 2. Fall back to cookie-based session via SSR server client
  if (!userId) {
    const sb = await getSupabaseServerClient();
    if (sb) {
      const { data } = await sb.auth.getUser();
      if (data.user) {
        userId = data.user.id;
      }
    }
  }

  if (!userId) throw new AdminError("Not signed in. Please log in first.", 401);

  const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (profile?.role !== "admin") throw new AdminError("Admin access required.", 403);
  return { admin, adminId: userId };
}

export function adminFail(e: unknown): Response {
  if (e instanceof AdminError) return Response.json({ error: e.message }, { status: e.status });
  console.error("[admin-api]", e);
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
