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
