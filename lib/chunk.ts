// Splits uploaded material into section-aware chunks so every citation can say
// "which file, which section, which page".
import type { Chunk, Material } from "./types";
import { normalizeWhitespace, isIndexPage } from "./text";
import { CONFIG } from "./config";

// Heading-aware, page-preserving chunking with overlap inside a section.
const TARGET = CONFIG.retrieval.chunkChars; // characters per chunk (small so prompts fit Groq free-tier limits)
const OVERLAP = CONFIG.retrieval.overlapChars;

/** Detects non-academic front matter headings like committees, publishers, prefaces, pledges */
export function isFrontMatterHeading(line: string): boolean {
  const l = line.trim();
  if (/^(?:biology|science|mathematics|maths|physics|chemistry|social\s+studies)?\s*(?:class|grade|standard)\s*[-–:]?\s*\d+/i.test(l)) return true;
  if (/^(?:editors?|co-?ordinators?|text\s*book development committee|writers?|authors?|reviewers?|advisory board|qr code(?: team)?|cover page.*|designing)/i.test(l)) return true;
  if (/^(?:government of|scert|ncert|cbse|published by|printed in|all rights reserved|copyright|free distribution|first published|new impression|mint compound)/i.test(l)) return true;
  if (/^(?:intro(?:\s*\.{2,})?|foreword|preface|acknowledgements?|dear\s+(?:teachers?|students?))/i.test(l)) return true;
  if (/^(?:academic standards|learning outcomes|continuous comprehensive evaluation|cce|instructions?\s+to\s+teachers?|how to use\s+(?:this book|qr codes?))/i.test(l)) return true;
  if (/^(?:our\s+national\s+anthem|national\s+anthem|pledge|constitution\s+of\s+india|jana\s+gana\s+mana|india is my country)/i.test(l)) return true;
  return false;
}

/** Detects if a page belongs to front matter (before academic content or index) */
export function isFrontMatterPage(pageText: string): boolean {
  const t = pageText.toLowerCase();
  // If it's an index or chapter start, it is NOT front matter
  if (/\b(index|table of contents|contents)\b/i.test(t) && /\b\d+\s+[-–A-Za-z]+|\bchapter\s+\d+/i.test(t)) return false;
  if (/\bchapter\s+1\b|\bunit\s+1\b|\blesson\s+1\b/i.test(t)) return false;

  let markers = 0;
  if (/text\s*book development committee|writers|editors|co-ordinator/i.test(t)) markers++;
  if (/government of|scert|ncert|published by|all rights reserved|printed in|mint compound/i.test(t)) markers++;
  if (/national anthem|jana gana mana|pledge|india is my country/i.test(t)) markers++;
  if (/academic standards|learning outcomes|continuous comprehensive evaluation/i.test(t)) markers++;
  if (/dear students|dear teachers|qr code team|intro \.\.\./i.test(t)) markers++;
  if (/diksha|qr code scanner|how to use qr codes|energized text books/i.test(t)) markers++;
  return markers >= 1;
}

export function isHeading(line: string): boolean {
  const l = line.trim();
  if (l.length < 3 || l.length > 90) return false;
  if (isFrontMatterHeading(l)) return false;
  if (/^#{1,4}\s+\S/.test(l)) return true; // markdown
  if (/^(chapter|unit|section|module|part|topic|lesson)\s+[\dIVXivx]+/i.test(l)) return true;
  if (/^\d+(\.\d+){0,3}\s+[A-Z][^.!?]*$/.test(l)) return true; // "3.2 Light reaction"
  if (/^[A-Z][A-Z0-9 ,&:()'-]{3,}$/.test(l) && !/[.!?]$/.test(l)) return true; // ALL CAPS line
  return false;
}

function cleanHeading(l: string): string {
  return l.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim();
}

export function chunkMaterial(m: Material): Chunk[] {
  const chunks: Chunk[] = [];
  let h1 = ""; // chapter-level heading
  let h2 = ""; // section-level heading
  let buf: string[] = [];
  let bufPage = 1;
  let n = 0;
  let onlyCarry = false; // buffer holds nothing but the overlap from the previous chunk
  let pastFrontMatter = false;

  const section = () => {
    if (!pastFrontMatter && !h1 && !h2) return "Front Matter";
    return [h1, h2].filter(Boolean).join(" > ") || "General";
  };

  /** `carry` = keep the end of this chunk as the start of the next one (same section only). */
  const flush = (carry = false) => {
    const text = normalizeWhitespace(buf.join("\n"));
    if (text.length > 40 && !onlyCarry) {
      chunks.push({
        id: `${m.id}-c${n++}`,
        materialId: m.id,
        materialName: m.name,
        kind: m.kind,
        section: section(),
        page: bufPage,
        text,
      });
    }
    buf = [];
    onlyCarry = false;
    if (carry && text.length > OVERLAP * 2) {
      onlyCarry = true;
      const tail = text.slice(-OVERLAP);
      const start = tail.search(/[.!?]\s+[A-Z]/); // begin the overlap at a sentence boundary
      buf = [start >= 0 ? tail.slice(start + 2) : tail];
    }
  };

  m.pages.forEach((pageText, pi) => {
    const pageNum = pi + 1;
    const isFront = isFrontMatterPage(pageText);
    const isIdx = isIndexPage(pageText);

    // If we encounter Chapter 1 or Index, we have moved past front matter
    if (/\b(chapter\s+1\b|unit\s+1\b|lesson\s+1\b|index\b|table of contents\b)/i.test(pageText)) {
      pastFrontMatter = true;
    }

    // Skip front-matter pages (committees, publishers, prefaces, pledges, QR instructions)
    // UNLESS it is the authoritative index page (which has the syllabus chapters)
    if (isFront && !isIdx) {
      return;
    }

    if (isIdx) {
      flush();
      h1 = "Index";
      h2 = "Table of Contents";
      bufPage = pageNum;
      buf.push(...pageText.split("\n").map((l) => l.trim()).filter(Boolean));
      flush();
      pastFrontMatter = true;
      return;
    }

    const lines = pageText.replace(/\r/g, "").split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        if (buf.join(" ").length > TARGET) flush(true);
        continue;
      }
      if (isHeading(line)) {
        flush();
        const h = cleanHeading(line);
        if (/^#\s/.test(line) || /^(chapter|unit|module|part)\b/i.test(h)) {
          h1 = h;
          h2 = "";
          pastFrontMatter = true;
        } else {
          h2 = h;
        }
        bufPage = pageNum;
        continue;
      }
      if (buf.length === 0) bufPage = pageNum;
      buf.push(line);
      onlyCarry = false;
      if (buf.join(" ").length > TARGET * 1.4) flush(true);
    }
  });
  flush();
  return chunks;
}
