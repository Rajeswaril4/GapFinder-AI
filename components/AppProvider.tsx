"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { StudentData, User } from "@/lib/types";
import { emptyData } from "@/lib/types";
import * as store from "@/lib/store";
import { signInWithEmail, signUpWithEmail, signOutUser, getAuthUser } from "@/lib/auth";
import { Retriever } from "@/lib/retrieval";

export interface EmailPreview {
  to: string;
  subject: string;
  html: string;
  text: string;
  time: string;
  device: string;
  provider?: string;
}

interface Ctx {
  ready: boolean;
  user: User | null;
  jwtToken: string | null;
  lastLoginEmail: EmailPreview | null;
  data: StudentData;
  retriever: Retriever;
  update: (fn: (d: StudentData) => StudentData) => Promise<StudentData>;
  replace: (d: StudentData) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => void;
  resetDemo: () => Promise<void>;
  sendTestLoginEmail: () => Promise<EmailPreview | null>;
}

const AppContext = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const [lastLoginEmail, setLastLoginEmail] = useState<EmailPreview | null>(null);
  const [data, setData] = useState<StudentData>(emptyData());
  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(async (u: User | null) => {
    setUser(u);
    setData(u ? (await store.loadData(u.email)) ?? emptyData() : emptyData());
  }, []);

  const notifyLogin = useCallback(async (u: { email: string; name?: string; id?: string; role?: string }) => {
    try {
      const res = await fetch("/api/auth/notify-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(u),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.token) {
          setJwtToken(json.token);
          if (typeof window !== "undefined") {
            localStorage.setItem("gapfinder_jwt", json.token);
            document.cookie = `gapfinder_jwt=${encodeURIComponent(json.token)}; path=/; max-age=604800; SameSite=Lax`;
          }
        }
        if (json.emailPreview) {
          const preview: EmailPreview = {
            ...json.emailPreview,
            provider: json.emailProvider,
          };
          setLastLoginEmail(preview);
          if (typeof window !== "undefined") {
            try {
              localStorage.setItem("gf_last_email", JSON.stringify(preview));
            } catch {}
          }
          return preview;
        }
      }
    } catch (err) {
      console.warn("[AppProvider] Login notification warning:", err);
    }
    return null;
  }, []);

  useEffect(() => {
    (async () => {
      await store.ensureDemo();
      if (typeof window !== "undefined") {
        const savedToken = localStorage.getItem("gapfinder_jwt");
        if (savedToken) setJwtToken(savedToken);
        try {
          const savedEmail = localStorage.getItem("gf_last_email");
          if (savedEmail) setLastLoginEmail(JSON.parse(savedEmail));
        } catch {}
      }
      try {
        const authUser = await getAuthUser();
        if (authUser && authUser.email !== store.DEMO_EMAIL) {
          const localUser = store.syncLocalUser({
            email: authUser.email,
            name: authUser.fullName,
            id: authUser.id,
            role: authUser.role,
          });
          const fullUser = {
            ...localUser,
            id: authUser.id,
            role: authUser.role,
          };
          await load(fullUser);
        } else {
          await load(store.currentUser());
        }
      } catch {
        await load(store.currentUser());
      }
      setReady(true);
    })();
  }, [load]);

  const update = useCallback(
    async (fn: (d: StudentData) => StudentData) => {
      const next = fn(dataRef.current);
      dataRef.current = next;
      setData(next);
      if (user) await store.saveData(user.email, next);
      return next;
    },
    [user]
  );

  const sendTestLoginEmail = useCallback(async () => {
    if (!user) return null;
    return await notifyLogin({
      email: user.email,
      name: user.name,
      id: user.id,
      role: user.role,
    });
  }, [user, notifyLogin]);

  const value = useMemo<Ctx>(
    () => ({
      ready,
      user,
      jwtToken,
      lastLoginEmail,
      data,
      retriever: new Retriever(data.chunks),
      update,
      replace: async (d) => {
        await update(() => d);
      },
      signIn: async (email, password) => {
        if (email.toLowerCase() === store.DEMO_EMAIL.toLowerCase()) {
          const u = await store.login(email, password);
          await load(u);
          void notifyLogin({ email: u.email, name: u.name, role: "student" });
          return;
        }
        const authUser = await signInWithEmail(email, password);
        const localUser = store.syncLocalUser({
          email: authUser.email,
          name: authUser.fullName,
          id: authUser.id,
          role: authUser.role,
        });
        const fullUser = {
          ...localUser,
          id: authUser.id,
          role: authUser.role,
        };
        await load(fullUser);
        void notifyLogin({
          email: authUser.email,
          name: authUser.fullName,
          id: authUser.id,
          role: authUser.role,
        });
      },
      signUp: async (name, email, password) => {
        const authUser = await signUpWithEmail(email, password, name, "student");
        const localUser = store.syncLocalUser({
          email: authUser.email,
          name: authUser.fullName,
          id: authUser.id,
          role: authUser.role,
        });
        const fullUser = {
          ...localUser,
          id: authUser.id,
          role: authUser.role,
        };
        await load(fullUser);
        void notifyLogin({
          email: authUser.email,
          name: authUser.fullName,
          id: authUser.id,
          role: authUser.role,
        });
      },
      signOut: async () => {
        await signOutUser();
        store.logout();
        if (typeof window !== "undefined") {
          localStorage.removeItem("gapfinder_jwt");
          document.cookie = "gapfinder_jwt=; path=/; max-age=0";
        }
        setJwtToken(null);
        setUser(null);
        setData(emptyData());
      },
      resetDemo: async () => {
        const d = await store.resetDemo();
        setData(d);
      },
      sendTestLoginEmail,
    }),
    [ready, user, jwtToken, lastLoginEmail, data, update, load, notifyLogin, sendTestLoginEmail]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const c = useContext(AppContext);
  if (!c) throw new Error("useApp must be used inside AppProvider");
  return c;
}
