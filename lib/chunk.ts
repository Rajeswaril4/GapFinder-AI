// Splits uploaded material into section-aware chunks so every citation can say
// "which file, which section, which page".
import type { Chunk, Material } from "./types";
import { normalizeWhitespace } from "./text";
import { CONFIG } from "./config";

// Heading-aware, page-preserving chunking with overlap inside a section.
const TARGET = CONFIG.retrieval.chunkChars; // characters per chunk (small so prompts fit Groq free-tier limits)
const OVERLAP = CONFIG.retrieval.overlapChars;

function isHeading(line: string): boolean {
  const l = line.trim();
  if (l.length < 3 || l.length > 90) return false;
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

  const section = () => [h1, h2].filter(Boolean).join(" > ") || "General";
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
        } else {
          h2 = h;
        }
        bufPage = pi + 1;
        continue;
      }
      if (buf.length === 0) bufPage = pi + 1;
      buf.push(line);
      onlyCarry = false;
      if (buf.join(" ").length > TARGET * 1.4) flush(true);
    }
  });
  flush();
  return chunks;
}
