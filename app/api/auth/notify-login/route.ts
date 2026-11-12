import { sendLoginNotificationEmail } from "@/lib/email";
import { signJwt } from "@/lib/jwt";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 15;

const NotifySchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  id: z.string().optional(),
  role: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = NotifySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message || "Invalid email" }, { status: 400 });
    }

    const { email, name, id, role } = parsed.data;
    const userAgent = req.headers.get("user-agent") || "Web Browser";
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "Unknown IP";
    const time = new Date().toUTCString();

    // 1. Generate JWT token for this session
    const token = signJwt({
      id: id || email,
      email: email.toLowerCase(),
      name: name || email.split("@")[0],
      role: role || "student",
    });

    // 2. Dispatch automated email asynchronously
    let emailResult: any = {
      success: true,
      provider: "simulated",
    };
    try {
      emailResult = await sendLoginNotificationEmail(email, name, {
        ip,
        userAgent,
        time,
      });
    } catch (err) {
      console.warn("[notify-login] Email delivery warning:", err);
    }

    return Response.json({
      success: true,
      token,
      emailSent: emailResult.success,
      emailProvider: emailResult.provider,
      emailPreview: emailResult.emailPreview,
      user: {
        id: id || email,
        email: email.toLowerCase(),
        name: name || email.split("@")[0],
        role: role || "student",
      },
    });
  } catch (err) {
    console.error("[notify-login] Error:", err);
    return Response.json({ error: (err as Error).message || "Notification failed" }, { status: 500 });
  }
}
