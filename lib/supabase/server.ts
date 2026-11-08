// Supabase server clients for Server Components, Server Actions, and Route Handlers.
// Never exposes SUPABASE_SERVICE_ROLE_KEY to the browser.

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function isValidHttpUrl(str?: string | null): boolean {
  if (!str || !str.trim()) return false;
  try {
    const parsed = new URL(str.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Creates an SSR-compatible Supabase client using incoming request cookies.
 */
export async function getSupabaseServerClient(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!isValidHttpUrl(url) || !anonKey || !anonKey.trim()) return null;

  try {
    const cookieStore = await cookies();

    return createServerClient(url!.trim(), anonKey.trim(), {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as CookieOptions)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    });
  } catch (err) {
    console.warn("[supabase] Server client initialization skipped:", err);
    return null;
  }
}

/**
 * Creates an admin client using SUPABASE_SERVICE_ROLE_KEY for background tasks (Inngest).
 * SERVER-ONLY: Never call this from client components or expose to the frontend.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!isValidHttpUrl(url) || !serviceRoleKey || !serviceRoleKey.trim()) return null;

  try {
    return createClient(url!.trim(), serviceRoleKey.trim(), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  } catch (err) {
    console.warn("[supabase] Admin client initialization skipped:", err);
    return null;
  }
}
