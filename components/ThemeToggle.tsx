"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("gf_theme") as Theme | null;
    if (saved === "dark" || saved === "light") {
      setThemeState(saved);
      document.documentElement.setAttribute("data-theme", saved);
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const initial = prefersDark ? "dark" : "light";
      setThemeState(initial);
      document.documentElement.setAttribute("data-theme", initial);
    }
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    localStorage.setItem("gf_theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
  };

  return { theme, setTheme, toggleTheme, mounted };
}

export function ThemeToggle({ className, size = "md" }: { className?: string; size?: "sm" | "md" }) {
  const { theme, toggleTheme, mounted } = useTheme();

  if (!mounted) {
    return (
      <button
        type="button"
        className={["theme-toggle", className].filter(Boolean).join(" ")}
        aria-label="Toggle dark/light mode"
        style={{
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: "8px",
          padding: size === "sm" ? "4px 8px" : "6px 12px",
          color: "inherit",
          cursor: "pointer",
          fontSize: size === "sm" ? "12px" : "13.5px",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span>🌓</span>
      </button>
    );
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={["theme-toggle", className].filter(Boolean).join(" ")}
      title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      style={{
        background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
        border: `1px solid ${isDark ? "rgba(255,255,255,0.16)" : "var(--line)"}`,
        borderRadius: "8px",
        padding: size === "sm" ? "4px 8px" : "6px 12px",
        color: "inherit",
        cursor: "pointer",
        fontSize: size === "sm" ? "12px" : "13.5px",
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontWeight: 500,
        transition: "all 0.15s ease",
      }}
    >
      <span>{isDark ? "☀️" : "🌙"}</span>
    </button>
  );
}
