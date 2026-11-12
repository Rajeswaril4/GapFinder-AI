import { signJwt, verifyJwt, extractTokenFromRequest } from "@/lib/jwt";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const token = extractTokenFromRequest(req);
  if (!token) {
    return Response.json({ valid: false, error: "No JWT token provided in Authorization header or cookie" }, { status: 401 });
  }

  const result = verifyJwt(token);
  if (!result.valid) {
    return Response.json(result, { status: 401 });
  }

  return Response.json({
    valid: true,
    user: result.payload,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, email, name, role } = body;

    if (!email) {
      return Response.json({ error: "Email is required to issue a JWT token" }, { status: 400 });
    }

    const token = signJwt({
      id: id || email,
      email: email.toLowerCase(),
      name: name || email.split("@")[0],
      role: role || "student",
    });

    return Response.json({
      success: true,
      token,
      expiresIn: 7 * 24 * 60 * 60,
      tokenType: "Bearer",
      user: {
        id: id || email,
        email: email.toLowerCase(),
        name: name || email.split("@")[0],
        role: role || "student",
      },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message || "Token generation failed" }, { status: 500 });
  }
}
