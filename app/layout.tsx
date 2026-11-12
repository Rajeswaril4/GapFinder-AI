import "./globals.css";
import type { Metadata } from "next";
import { AppProvider } from "@/components/AppProvider";

export const metadata: Metadata = {
  title: "GapFinder AI — find what you don't know",
  description:
    "Upload your syllabus, notes and past papers. GapFinder AI tests you on your own material, finds your weak topics and builds a revision plan that updates as you improve.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const themeScript = `
    try {
      var saved = localStorage.getItem('gf_theme');
      if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
      }
    } catch (e) {}
  `;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
