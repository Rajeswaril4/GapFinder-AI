import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 30;

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(1),
  role: z.enum(["student", "teacher", "admin"]).default("student"),
});

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const { email, password, fullName, role } = parsed.data;
    const admin = getSupabaseAdminClient();

    if (!admin) {
      return Response.json(
        { error: "Server authentication is not configured (missing SUPABASE_SERVICE_ROLE_KEY)." },
        { status: 503 }
      );
    }

    // Create user with email_confirm: true so no confirmation email is sent.
    // This avoids hitting Supabase's hourly email rate limit.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role,
      },
    });

    if (error) {
      const isDuplicate = /already|registered|exists/i.test(error.message);
      return Response.json(
        { error: isDuplicate ? "An account with this email already exists." : error.message },
        { status: isDuplicate ? 409 : 400 }
      );
    }

    if (!data.user) {
      return Response.json({ error: "Could not create user account." }, { status: 500 });
    }

    // Upsert user profile record
    await admin.from("profiles").upsert({
      id: data.user.id,
      email,
      full_name: fullName,
      role,
      updated_at: new Date().toISOString(),
    });

    return Response.json(
      {
        id: data.user.id,
        email: data.user.email || email,
        fullName,
        role,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[register-api]", err);
    return Response.json(
      { error: (err as Error).message || "Registration failed." },
      { status: 500 }
    );
  }
}
