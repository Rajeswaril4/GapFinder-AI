// Okapi BM25 — the retrieval engine. Pure, deterministic, no model involved.
import { tokenize } from "./text";

export interface Doc {
  id: string;
  text: string;
}

export interface Hit {
  id: string;
  score: number;
}

export class BM25 {
  private k1 = 1.4;
  private b = 0.75;
  private docs: { id: string; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  constructor(docs: Doc[]) {
    let total = 0;
    for (const d of docs) {
      const toks = tokenize(d.text);
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ id: d.id, tf, len: toks.length });
      total += toks.length;
    }
    this.avgLen = this.docs.length ? total / this.docs.length : 0;
  }

  get size() {
    return this.docs.length;
  }

  private idf(t: string): number {
    const n = this.docs.length;
    const df = this.df.get(t) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  search(query: string, k = 5, filter?: (id: string) => boolean): Hit[] {
    const q = Array.from(new Set(tokenize(query)));
    if (!q.length) return [];
    const hits: Hit[] = [];
    for (const d of this.docs) {
      if (filter && !filter(d.id)) continue;
      let s = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        s += (this.idf(t) * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / (this.avgLen || 1)));
      }
      if (s > 0) hits.push({ id: d.id, score: s });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }
}
