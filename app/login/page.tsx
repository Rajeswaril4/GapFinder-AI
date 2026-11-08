"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/AppProvider";
import { Alert, Button } from "@/components/ui";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/seed";

export default function LoginPage() {
  const { ready, user, signIn, signUp } = useApp();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace("/dashboard");
  }, [ready, user, router]);

  async function submit(e?: React.FormEvent, demo = false) {
    e?.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (demo) await signIn(DEMO_EMAIL, DEMO_PASSWORD);
      else if (mode === "login") await signIn(email, password);
      else await signUp(name, email, password);
      router.replace("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <section className="auth-hero">
        <div className="logo" style={{ padding: 0 }}>
          <span className="logo-mark">◎</span> GapFinder AI
        </div>
        <h1>Find what you don't know — before the exam does.</h1>
        <p style={{ fontSize: 17, maxWidth: 520 }}>
          You can't ask about a gap you don't know you have. GapFinder tests you on <b>your own</b> syllabus, notes and past
          papers, diagnoses weak topics, and builds a revision plan that updates as you improve.
        </p>
        <ol style={{ paddingLeft: 20, margin: 0 }}>
          <li>Upload syllabus, notes and past papers</li>
          <li>Take a diagnostic quiz with source citations</li>
          <li>Get a 🔴 weak / 🟡 medium / 🟢 strong gap report</li>
          <li>Follow a prioritised plan → re-test → plan updates</li>
        </ol>
      </section>

      <section className="auth-form">
        <div className="card">
          <div className="tabs">
            <button className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>Log in</button>
            <button className={mode === "register" ? "on" : ""} onClick={() => setMode("register")}>Create account</button>
          </div>
          <form className="stack" onSubmit={submit}>
            {mode === "register" && (
              <div>
                <label>Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              </div>
            )}
            <div>
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
            </div>
            <div>
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
            {error && <Alert kind="error">{error}</Alert>}
            <Button type="submit" loading={busy && !!email}>
              {mode === "login" ? "Log in" : "Create account"}
            </Button>
          </form>

          <div className="spacer" />
          <div className="alert info">
            <b>Demo login for judges</b>
            <div style={{ fontSize: 13.5, marginTop: 4 }}>
              Email: <code>{DEMO_EMAIL}</code>
              <br />
              Password: <code>{DEMO_PASSWORD}</code>
              <br />
              Pre-loaded with Class 10 Biology material, 2 quiz attempts, a gap report and a plan.
            </div>
            <div className="spacer" />
            <Button type="button" variant="secondary" onClick={() => submit(undefined, true)} loading={busy && !email}>
              Continue with demo account
            </Button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            Accounts and study data are saved in this browser (IndexedDB). No external database required.
          </p>
        </div>
      </section>
    </div>
  );
}
