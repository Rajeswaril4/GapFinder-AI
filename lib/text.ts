// Text utilities shared by chunking, retrieval and grounding checks.

const STOP = new Set(
  (
    "a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those " +
    "which what who whom whose when where why how do does did done can could should would may might will shall not no " +
    "than then so such into onto about above below between during through over under again further once here there all " +
    "any both each few more most other some own same very s t just also only i we you he she they them their our your " +
    "explain describe define state write give name list discuss briefly short note marks mark question answer following " +
    "q one two three four five"
  ).split(/\s+/)
);

/** Very light stemmer: enough to match "reactions"~"reaction", "absorbing"~"absorb". */
export function stem(w: string): string {
  if (w.length <= 4) return w;
  if (w.endsWith("ies") && w.length > 5) return w.slice(0, -3) + "y";
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ing") && w.length > 6) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 5) return w.slice(0, -2);
  if (w.endsWith("es") && w.length > 5 && /(sh|ch|x|z|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("is") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

export function normalizeWhitespace(s: string): string {
  return s.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Fraction of the quote's content words that appear in the source. Used to verify citations. */
export function overlapRatio(quote: string, source: string): number {
  const q = tokenize(quote);
  if (q.length === 0) return 0;
  const s = new Set(tokenize(source));
  return q.filter((w) => s.has(w)).length / q.length;
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/** Check if a page text looks like a textbook INDEX or Table of Contents */
export function isIndexPage(pageText: string): boolean {
  const t = pageText.toLowerCase();
  // Check for explicit index headings
  if (/\b(index|table of contents|contents)\b/i.test(t)) {
    // Must contain chapter/unit numbers or listings (e.g. "1 Nutrition", "Chapter 1", "Unit 1", "1. Nutrition")
    const hasChapterEntries = /\b(?:chapter|unit|lesson)?\s*\d+\s*[-–:.]?\s*[a-z]/i.test(t);
    return hasChapterEntries;
  }
  // Also match pages that are primarily a list of 4+ numbered chapters with month/page indicators
  const numberedLines = (t.match(/(?:^|\n)\s*\d+\s+[-–A-Za-z].*?(?:\(\w+\)|\d+\s*[-–]\s*\d+)/g) || []).length;
  return numberedLines >= 3;
}

/**
 * Extracts the exact INDEX / Table of Contents block from raw continuous text or joined pages.
 * Detects "INDEX" / "CONTENTS" and captures the numbered chapter listings up to chapter content or anthem/pledge.
 */
export function extractIndexSection(text: string): string | null {
  if (!text) return null;
  // Match "INDEX" or "TABLE OF CONTENTS" or "CONTENTS" as a standalone heading or line
  const match = text.match(
    /(?:^|\n)\s*(?:INDEX|TABLE\s+OF\s+CONTENTS|CONTENTS)\s*(?:\r?\n)+([\s\S]+?)(?=(?:\r?\n\s*(?:Chapter\s+1\b|Unit\s+1\b|Lesson\s+1\b|OUR\s+NATIONAL\s+ANTHEM|PLEDGE|FIRST\s+EDITION))|\n{4,}|$)/i
  );
  if (match && match[1]) {
    const raw = match[1].trim();
    // Verify it contains numbered chapter entries like "1 Nutrition" or "Chapter 1" or "1."
    if (/\b(?:chapter|unit|lesson)?\s*\d+\s*[-–:.]?\s*[a-z]/i.test(raw)) {
      // Clean up any extraneous non-academic trailing text if present
      const clean = raw
        .split("\n")
        .filter((line) => {
          const l = line.trim();
          if (!l) return false;
          // Filter out anthem, pledge, publishers, editors inside the index
          if (/^(?:our national anthem|pledge|published by|printed in|scert|ncert|telangana govt|free distribution)/i.test(l)) {
            return false;
          }
          return true;
        })
        .join("\n");
      return `TEXTBOOK INDEX / TABLE OF CONTENTS:\n${clean.slice(0, 4000)}`;
    }
  }

  // Fallback: Check if there's a sequence of numbered chapter titles (e.g. "1 Nutrition - Food supplying system ... 2 Respiration")
  const numberedMatch = text.match(
    /(?:^|\n)\s*(1\s+[-–A-Za-z].*?(?:\r?\n\s*\d+\s+[-–A-Za-z].*?){2,})(?=(?:\r?\n\s*(?:Chapter\s+1\b|Unit\s+1\b|Lesson\s+1\b|OUR\s+NATIONAL\s+ANTHEM|PLEDGE))|\n{4,}|$)/i
  );
  if (numberedMatch && numberedMatch[1]) {
    return `TEXTBOOK INDEX / TABLE OF CONTENTS:\n${numberedMatch[1].trim().slice(0, 4000)}`;
  }

  return null;
}

/**
 * Strips non-academic front matter (prefaces, committee lists, publishers,
 * academic standards tables, QR code instructions, pledges) from syllabus or textbook text.
 */
export function stripFrontMatter(text: string): string {
  if (!text) return "";
  // If an authoritative index section exists in the text, that's the purest form of the syllabus!
  const idx = extractIndexSection(text);
  if (idx) return idx;

  const lines = text.split("\n");
  const filtered: string[] = [];
  let inPreamble = true;

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;

    // Check if line marks the start of academic content or index
    if (/\b(chapter\s+1\b|unit\s+1\b|lesson\s+1\b|index\b|table of contents\b)/i.test(l)) {
      inPreamble = false;
    }

    if (inPreamble) {
      // Check if line looks like committee, copyright, publisher, letter to students, QR guide
      if (
        /^(?:class|grade)\s*[-–:]?\s*\d+/i.test(l) ||
        /^(?:editors?|co-?ordinators?|text\s*book development committee|writers?|authors?|qr code|cover page|designing)/i.test(l) ||
        /^(?:government of|scert|ncert|published by|printed in|all rights reserved|copyright|free distribution)/i.test(l) ||
        /^(?:intro(?:\s*\.{2,})?|foreword|preface|dear\s+(?:teachers?|students?))/i.test(l) ||
        /^(?:academic standards|learning outcomes|cce|instructions?\s+to\s+teachers?|how to use)/i.test(l) ||
        /^(?:our\s+national\s+anthem|national\s+anthem|pledge|jana\s+gana\s+mana|india is my country)/i.test(l) ||
        /^(?:dr\.|sri|smt|prof\.)\s+[a-z]/i.test(l) ||
        /^(?:vidya bhawan|university college|mint compound|hyderabad|rajastan)/i.test(l) ||
        /^(?:diksha|qr code scanner|energized text books)/i.test(l)
      ) {
        continue; // skip front matter line
      }
    }

    filtered.push(line);
  }

  return filtered.join("\n").trim() || text;
}

/** Scans pages (especially the first 30 pages) to extract authoritative INDEX matter */
export function extractIndexMatter(pages: string[]): string | null {
  // Check if any individual page is an index
  for (let i = 0; i < Math.min(pages.length, 30); i++) {
    if (isIndexPage(pages[i])) {
      // Extract the index section from this page to cleanly strip any surrounding boilerplate
      const section = extractIndexSection(pages[i]);
      let indexContent = section || `--- TEXTBOOK INDEX / TABLE OF CONTENTS (Page ${i + 1}) ---\n${pages[i].trim()}`;
      // If the index continues onto the following page
      if (
        i + 1 < pages.length &&
        /\b(?:chapter|unit|lesson)?\s*\d+\s*[-–:.]?\s*[a-z]/i.test(pages[i + 1]) &&
        !/\b(chapter\s+1\b|unit\s+1\b|lesson\s+1\b)/i.test(pages[i + 1])
      ) {
        indexContent += `\n\n--- INDEX CONTINUED (Page ${i + 2}) ---\n` + pages[i + 1].trim();
      }
      return indexContent;
    }
  }

  // Also check if joining the first 20 pages contains an index section
  const joined = pages.slice(0, 20).join("\n");
  const extracted = extractIndexSection(joined);
  if (extracted) return extracted;

  return null;
}
