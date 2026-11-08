import "./globals.css";
import type { Metadata } from "next";
import { AppProvider } from "@/components/AppProvider";

export const metadata: Metadata = {
  title: "GapFinder AI — find what you don't know",
  description:
    "Upload your syllabus, notes and past papers. GapFinder AI tests you on your own material, finds your weak topics and builds a revision plan that updates as you improve.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
