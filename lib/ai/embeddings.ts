// Vector embedding generation using Google Gemini gemini-embedding-001.
// Produces 768-dimensional dense vector embeddings with batching and local fallback.

import { getGeminiApiKey } from "./gemini";

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSION = 768;
export const EMBEDDING_VERSION = "v1";

const API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Generate a single embedding vector using Gemini text-embedding-004.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const [vec] = await getBatchEmbeddings([text]);
  return vec;
}

/**
 * Generate embeddings for an array of texts with batching.
 */
export async function getBatchEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    // Deterministic fallback embedding for testing / offline demo mode
    return texts.map((t) => deterministicFallbackEmbedding(t, EMBEDDING_DIMENSION));
  }

  // Gemini batchEmbedContents endpoint accepts up to 100 texts per request
  const BATCH_SIZE = 64;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const url = `${API_BASE_URL}/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${apiKey}`;

    const requests = batch.map((t) => ({
      model: `models/${EMBEDDING_MODEL}`,
      content: {
        parts: [{ text: t.slice(0, 8000) }], // Avoid exceeding per-chunk limits
      },
      outputDimensionality: EMBEDDING_DIMENSION,
    }));

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      });

      if (!res.ok) {
        console.warn(`[embeddings] Gemini API HTTP ${res.status}, falling back to deterministic vectors`);
        results.push(...batch.map((t) => deterministicFallbackEmbedding(t, EMBEDDING_DIMENSION)));
        continue;
      }

      const data = await res.json();
      const embeddings = (data.embeddings || []).map((e: { values: number[] }, idx: number) => {
        if (e && Array.isArray(e.values)) return e.values;
        return deterministicFallbackEmbedding(batch[idx], EMBEDDING_DIMENSION);
      });

      results.push(...embeddings);
    } catch (err) {
      console.warn("[embeddings] Error fetching embeddings, using fallback:", err);
      results.push(...batch.map((t) => deterministicFallbackEmbedding(t, EMBEDDING_DIMENSION)));
    }
  }

  return results;
}

/**
 * Deterministic pseudo-embedding for fallback/testing environments.
 * Uses a character n-gram hashing algorithm to generate normalized 768-dim vector.
 */
export function deterministicFallbackEmbedding(text: string, dimensions = EMBEDDING_DIMENSION): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return vector;

  // 3-gram character frequency distribution into vector space
  for (let i = 0; i <= normalized.length - 3; i++) {
    const trigram = normalized.slice(i, i + 3);
    let hash = 2166136261;
    for (let j = 0; j < 3; j++) {
      hash ^= trigram.charCodeAt(j);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    const idx = hash % dimensions;
    vector[idx] += 1;
  }

  // Normalize to unit length (L2 norm)
  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) vector[i] = Number((vector[i] / norm).toFixed(6));
  }

  return vector;
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dot / denominator : 0;
}
