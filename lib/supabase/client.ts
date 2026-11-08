// Supabase browser client for client-side authentication and realtime queries.
// Compatible with Next.js App Router and @supabase/ssr.

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let clientInstance: SupabaseClient | null = null;

function isValidHttpUrl(str?: string | null): boolean {
  if (!str || !str.trim()) return false;
  try {
    const parsed = new URL(str.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!isValidHttpUrl(url) || !anonKey || !anonKey.trim()) {
    return null;
  }

  if (!clientInstance) {
    try {
      clientInstance = createBrowserClient(url!.trim(), anonKey.trim());
    } catch (err) {
      console.warn("[supabase] Browser client initialization skipped:", err);
      return null;
    }
  }
  return clientInstance;
}
