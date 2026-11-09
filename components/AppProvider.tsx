"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { StudentData, User } from "@/lib/types";
import { emptyData } from "@/lib/types";
import * as store from "@/lib/store";
import { signInWithEmail, signUpWithEmail, signOutUser, getAuthUser } from "@/lib/auth";
import { Retriever } from "@/lib/retrieval";

interface Ctx {
  ready: boolean;
  user: User | null;
  data: StudentData;
  retriever: Retriever;
  update: (fn: (d: StudentData) => StudentData) => Promise<StudentData>;
  replace: (d: StudentData) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => void;
  resetDemo: () => Promise<void>;
}

const AppContext = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<StudentData>(emptyData());
  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(async (u: User | null) => {
    setUser(u);
    setData(u ? (await store.loadData(u.email)) ?? emptyData() : emptyData());
  }, []);

  useEffect(() => {
    (async () => {
      await store.ensureDemo();
      try {
        const authUser = await getAuthUser();
        if (authUser && authUser.email !== store.DEMO_EMAIL) {
          const localUser = store.syncLocalUser({
            email: authUser.email,
            name: authUser.fullName,
            id: authUser.id,
            role: authUser.role,
          });
          await load({
            ...localUser,
            id: authUser.id,
            role: authUser.role,
          });
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

  const value = useMemo<Ctx>(
    () => ({
      ready,
      user,
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
          return;
        }
        const authUser = await signInWithEmail(email, password);
        const localUser = store.syncLocalUser({
          email: authUser.email,
          name: authUser.fullName,
          id: authUser.id,
          role: authUser.role,
        });
        await load({
          ...localUser,
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
        await load({
          ...localUser,
          id: authUser.id,
          role: authUser.role,
        });
      },
      signOut: async () => {
        await signOutUser();
        store.logout();
        setUser(null);
        setData(emptyData());
      },
      resetDemo: async () => {
        const d = await store.resetDemo();
        setData(d);
      },
    }),
    [ready, user, data, update, load]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const c = useContext(AppContext);
  if (!c) throw new Error("useApp must be used inside AppProvider");
  return c;
}
