"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "@/components/AppProvider";
import { Button } from "@/components/ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", step: "⌂" },
  { href: "/materials", label: "Materials", step: "1" },
  { href: "/topics", label: "Syllabus map", step: "2" },
  { href: "/quiz", label: "Diagnostic quiz", step: "3" },
  { href: "/report", label: "Gap report", step: "4" },
  { href: "/plan", label: "Revision plan", step: "5" },
  { href: "/explain", label: "Learning assistant", step: "?" },
  { href: "/teacher", label: "Teacher hub", step: "★" },
  { href: "/agents", label: "Agent activity", step: "⚙" },
  { href: "/admin", label: "Observability", step: "📊" },
  { href: "/how-it-works", label: "How it works", step: "i" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { ready, user, data, signOut, resetDemo } = useApp();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  if (!ready || !user) return <div style={{ padding: 40 }} className="muted">Loading…</div>;

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="logo" style={{ textDecoration: "none" }}>
          <span className="logo-mark">◎</span> GapFinder AI
        </Link>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={path?.startsWith(n.href) ? "active" : ""}>
              <span className="step">{n.step}</span>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div style={{ color: "#fff", fontWeight: 600 }}>{user.name}</div>
          <div style={{ fontSize: 12 }}>{user.email}</div>
          <div style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>{data.subject}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                signOut();
                router.replace("/login");
              }}
            >
              Log out
            </Button>
            {user.demo && (
              <Button
                variant="ghost"
                size="sm"
                title="Restore the original demo data"
                onClick={async () => {
                  if (confirm("Reset the demo account to its original data?")) await resetDemo();
                }}
              >
                Reset demo
              </Button>
            )}
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
