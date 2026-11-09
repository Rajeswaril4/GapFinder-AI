// Unified Authentication Layer for GapFinder AI.
// Supports Supabase Auth (Email/Password, Google OAuth, Session Management)
// with Role-Based Access Control (Student, Teacher, Admin)
// and seamless demo fallback when Supabase is not configured.

import { getSupabaseBrowserClient } from "./supabase/client";
import * as localStore from "./store";
import type { User } from "./types";

export type UserRole = "student" | "teacher" | "admin";

export interface AuthUserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  avatarUrl?: string;
  isDemo?: boolean;
}

/**
 * Get the currently logged-in user profile, checking Supabase first then local store.
 */
export async function getAuthUser(): Promise<AuthUserProfile | null> {
  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (!error && user) {
      // Fetch role and details from profiles table
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, full_name, avatar_url")
        .eq("id", user.id)
        .single();

      return {
        id: user.id,
        email: user.email || "",
        fullName: profile?.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "",
        role: (profile?.role as UserRole) || (user.user_metadata?.role as UserRole) || "student",
        avatarUrl: profile?.avatar_url || user.user_metadata?.avatar_url,
        isDemo: false,
      };
    }
  }

  // Fallback to local session store (e.g. Demo Student)
  const localUser = localStore.currentUser();
  if (localUser) {
    return {
      id: localUser.email,
      email: localUser.email,
      fullName: localUser.name,
      role: (localUser.role as UserRole) || "student",
      isDemo: !!localUser.demo,
    };
  }

  return null;
}

/**
 * Sign in with email and password.
 */
export async function signInWithEmail(email: string, password: string): Promise<AuthUserProfile> {
  const supabase = getSupabaseBrowserClient();

  if (supabase && email.toLowerCase() !== "demo@gapfinder.ai") {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new Error(error.message);
    }

    if (data.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, full_name, avatar_url")
        .eq("id", data.user.id)
        .single();

      return {
        id: data.user.id,
        email: data.user.email || email,
        fullName: profile?.full_name || data.user.user_metadata?.full_name || email.split("@")[0],
        role: (profile?.role as UserRole) || "student",
        avatarUrl: profile?.avatar_url,
        isDemo: false,
      };
    }
  }

  // Local demo or fallback auth
  const u = await localStore.login(email, password);
  return {
    id: u.email,
    email: u.email,
    fullName: u.name,
    role: "student",
    isDemo: !!u.demo,
  };
}

/**
 * Sign up with email, password, full name, and role.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  fullName: string,
  role: UserRole = "student"
): Promise<AuthUserProfile> {
  const supabase = getSupabaseBrowserClient();

  if (supabase) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role,
        },
      },
    });

    if (error) {
      throw new Error(error.message);
    }

    if (data.user) {
      // Upsert profile record
      await supabase.from("profiles").upsert({
        id: data.user.id,
        email,
        full_name: fullName,
        role,
        updated_at: new Date().toISOString(),
      });

      return {
        id: data.user.id,
        email,
        fullName,
        role,
        isDemo: false,
      };
    }
  }

  // Fallback to local store
  const u = await localStore.register(fullName, email, password);
  return {
    id: u.email,
    email: u.email,
    fullName: u.name,
    role,
    isDemo: false,
  };
}

/**
 * Sign in using Google OAuth.
 */
export async function signInWithGoogle(role: UserRole = "student"): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw new Error("Supabase is not configured for OAuth login.");
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/api/auth/callback`,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
        role,
      },
    },
  });

  if (error) throw new Error(error.message);
}

/**
 * Send password reset email.
 */
export async function resetPasswordForEmail(email: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login?reset=true`,
    });
    if (error) throw new Error(error.message);
    return;
  }
  throw new Error("Password reset requires configured Supabase authentication.");
}

/**
 * Sign out from Supabase and local store.
 */
export async function signOutUser(): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    await supabase.auth.signOut().catch(() => {});
  }
  localStore.logout();
}
