// Supabase session refresh and route protection middleware helper.

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

function isValidHttpUrl(str?: string | null): boolean {
  if (!str || !str.trim()) return false;
  try {
    const parsed = new URL(str.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!isValidHttpUrl(url) || !anonKey || !anonKey.trim()) {
    // If Supabase is not configured with a valid URL, pass through (e.g., local demo mode)
    return response;
  }

  try {
    const supabase = createServerClient(url!.trim(), anonKey.trim(), {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as CookieOptions)
          );
        },
      },
    });

    // Refresh auth token if expired
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const isPublicRoute =
      request.nextUrl.pathname === "/" ||
      request.nextUrl.pathname.startsWith("/login") ||
      request.nextUrl.pathname.startsWith("/how-it-works") ||
      request.nextUrl.pathname.startsWith("/api/health") ||
      request.nextUrl.pathname.startsWith("/api/inngest");

    // In production with Supabase configured, protect private routes
    if (!user && !isPublicRoute && process.env.REQUIRE_SUPABASE_AUTH === "true") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.searchParams.set("redirect", request.nextUrl.pathname);
      return NextResponse.redirect(redirectUrl);
    }
  } catch (err) {
    console.warn("[middleware] Supabase session update skipped:", err);
  }

  return response;
}
