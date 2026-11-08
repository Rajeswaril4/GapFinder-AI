// AGENT 1 — Document Ingestion (deterministic). Validates, fingerprints, classifies and
// chunks an uploaded document. Every page is kept; nothing is silently dropped.
import type { Chunk, Material, MaterialKind } from "./types";
import { uid } from "./types";
import { chunkMaterial } from "./chunk";

export function fingerprint(pages: string[]): string {
  // FNV-1a over whitespace-normalised lowercase text — identical content ⇒ identical hash
  const s = pages.join("\n").toLowerCase().replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + ":" + s.length;
}

/** Guess what kind of document this is from its text. */
export function detectKind(text: string): MaterialKind {
  const t = text.slice(0, 20000);
  const qMarks = (t.match(/\n\s*(?:Q(?:uestion)?\s*\.?\s*\d+|\d{1,2}\s*[.)])\s+/gi) ?? []).length;
  const marks = (t.match(/\[\s*\d+\s*marks?\s*\]|\(\s*\d+\s*marks?\s*\)/gi) ?? []).length;
  const questionWords = (t.match(/\?|\b(explain|describe|define|differentiate|state)\b/gi) ?? []).length;
  if (marks >= 2 || (qMarks >= 4 && questionWords >= qMarks)) return "past_paper";
  const lines = t.split("\n").filter((l) => l.trim());
  const avgLine = lines.reduce((s, l) => s + l.length, 0) / Math.max(1, lines.length);
  if (/\bsyllabus\b|\bcurriculum\b|\blearning outcomes?\b/i.test(t) || (avgLine < 140 && /\bunit\s+\d/i.test(t) && t.length < 8000))
    return "syllabus";
  return "notes";
}

export interface IngestResult {
  material: Material;
  chunks: Chunk[];
  duplicateOf?: string; // name of an existing identical document
}

export function ingest(
  input: { name: string; kind: MaterialKind; pages: string[] },
  existing: Material[]
): IngestResult {
  const text = input.pages.join("\n");
  if (text.replace(/\s/g, "").length < 20) throw new Error("This document has no readable text.");

  const hash = fingerprint(input.pages);
  const dup = existing.find((m) => m.hash === hash);
  const warnings: string[] = [];
  input.pages.forEach((p, i) => {
    if (input.pages.length > 1 && p.replace(/\s/g, "").length < 40)
      warnings.push(`Page ${i + 1} has almost no text (scanned image or blank page?) — it is kept but cannot be cited.`);
  });
  const detectedKind = detectKind(text);
  if (detectedKind !== input.kind)
    warnings.push(`This looks like a ${detectedKind.replace("_", " ")} but was uploaded as ${input.kind.replace("_", " ")}.`);

  const material: Material = {
    id: uid("m"),
    name: input.name.trim() || "Untitled",
    kind: input.kind,
    detectedKind,
    pages: input.pages,
    createdAt: Date.now(),
    status: "indexed",
    hash,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    headings: [],
    warnings,
  };
  const chunks = chunkMaterial(material);
  material.headings = Array.from(new Set(chunks.map((c) => c.section.split(" > ").pop()!))).filter((h) => h !== "General");
  if (!chunks.length) warnings.push("No text sections could be extracted.");
  return { material, chunks, duplicateOf: dup?.name };
}
