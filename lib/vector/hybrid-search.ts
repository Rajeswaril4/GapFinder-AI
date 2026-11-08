// Hybrid Search with Reciprocal Rank Fusion (RRF).
// Combines dense semantic vector retrieval (Qdrant + Gemini text-embedding-004)
// with sparse keyword retrieval (BM25).
// Enforces tenant isolation (never returns chunks from another student).
// Falls back deterministically to BM25 when Qdrant is unconfigured or unreachable.

import { BM25 } from "../bm25";
import type { Chunk, MaterialKind } from "../types";
import { getEmbedding, cosineSimilarity, EMBEDDING_MODEL, EMBEDDING_VERSION } from "./embeddings";
import { searchQdrant, getQdrantClient } from "./qdrant";
import type { ChunkPayload } from "./collections";

export interface HybridSearchResult {
  chunkId: string;
  materialId: string;
  materialName: string;
  kind: MaterialKind;
  section: string;
  page: number;
  text: string;
  denseScore?: number;
  sparseScore?: number;
  rrfScore: number;
  metadata: {
    userId: string;
    subjectId: string;
    documentId: string;
    topicId?: string | null;
    embeddingModel: string;
    embeddingVersion: string;
  };
}

export interface HybridSearchOptions {
  userId: string;
  subjectId?: string;
  documentId?: string;
  topicId?: string;
  kinds?: MaterialKind[];
  topK?: number;
  similarityThreshold?: number;
  rrfK?: number; // RRF smoothing constant (default: 60)
}

/**
 * Perform Reciprocal Rank Fusion on two ranked lists of chunk IDs.
 * formula: RRF_score(d) = sum_{m in models} 1 / (k + rank_m(d))
 */
export function reciprocalRankFusion(
  denseRanks: Map<string, number>,
  sparseRanks: Map<string, number>,
  k = 60
): Map<string, number> {
  const combined = new Map<string, number>();
  const allIds = new Set([...denseRanks.keys(), ...sparseRanks.keys()]);

  for (const id of allIds) {
    let score = 0;
    if (denseRanks.has(id)) {
      score += 1 / (k + denseRanks.get(id)!);
    }
    if (sparseRanks.has(id)) {
      score += 1 / (k + sparseRanks.get(id)!);
    }
    combined.set(id, score);
  }

  return combined;
}

/**
 * Execute Hybrid Search over chunks with user isolation and RRF reranking.
 */
export async function hybridSearch(
  query: string,
  localChunks: Chunk[],
  opts: HybridSearchOptions
): Promise<HybridSearchResult[]> {
  const { userId, kinds, topK = 10, similarityThreshold = 0.0, rrfK = 60 } = opts;

  if (!userId) {
    throw new Error("Security Violation: userId is required for hybrid search isolation");
  }

  // Filter local pool by kinds if specified
  const pool = kinds?.length
    ? localChunks.filter((c) => kinds.includes(c.kind))
    : localChunks;

  const chunkMap = new Map<string, Chunk>(pool.map((c) => [c.id, c]));

  // 1. Sparse keyword retrieval (BM25)
  const bm25Docs = pool.map((c) => ({ id: c.id, text: `${c.section}\n${c.text}` }));
  const bm25Index = new BM25(bm25Docs);
  const sparseHits = bm25Index.search(query, Math.max(topK * 3, 20));

  const sparseRanks = new Map<string, number>();
  const sparseScores = new Map<string, number>();
  sparseHits.forEach((hit, idx) => {
    sparseRanks.set(hit.id, idx + 1);
    sparseScores.set(hit.id, hit.score);
  });

  // 2. Dense vector retrieval (Qdrant or local vector similarity fallback)
  const denseRanks = new Map<string, number>();
  const denseScores = new Map<string, number>();

  const qdrantAvailable = getQdrantClient() !== null;
  let queryVec: number[] | null = null;

  try {
    queryVec = await getEmbedding(query);
  } catch (err) {
    console.warn("[hybrid-search] Failed to obtain query vector:", err);
  }

  if (qdrantAvailable && queryVec) {
    try {
      const qdrantResults = await searchQdrant({
        userId,
        queryVector: queryVec,
        subjectId: opts.subjectId,
        documentId: opts.documentId,
        topicId: opts.topicId,
        topK: Math.max(topK * 3, 20),
        scoreThreshold: similarityThreshold,
      });

      qdrantResults.forEach((res, idx) => {
        denseRanks.set(res.chunkId, idx + 1);
        denseScores.set(res.chunkId, res.score);

        // If local chunk map lacks this chunk, reconstruct from Qdrant payload
        if (!chunkMap.has(res.chunkId) && res.payload.chunk_text) {
          chunkMap.set(res.chunkId, {
            id: res.chunkId,
            materialId: res.payload.document_id,
            materialName: res.payload.document_id,
            kind: (res.payload.kind as MaterialKind) || "notes",
            section: res.payload.section_heading || "General",
            page: res.payload.page_number || 1,
            text: res.payload.chunk_text,
          });
        }
      });
    } catch (err) {
      console.warn("[hybrid-search] Qdrant search error, using sparse fallback:", err);
    }
  } else if (queryVec && pool.length > 0) {
    // Local in-memory vector ranking fallback when Qdrant server is not deployed
    const scoredLocal: Array<{ id: string; score: number }> = [];
    for (const chunk of pool.slice(0, 50)) {
      try {
        const chunkVec = await getEmbedding(`${chunk.section}\n${chunk.text}`);
        const sim = cosineSimilarity(queryVec, chunkVec);
        if (sim >= similarityThreshold) {
          scoredLocal.push({ id: chunk.id, score: sim });
        }
      } catch {
        break;
      }
    }
    scoredLocal.sort((a, b) => b.score - a.score);
    scoredLocal.slice(0, topK * 2).forEach((item, idx) => {
      denseRanks.set(item.id, idx + 1);
      denseScores.set(item.id, item.score);
    });
  }

  // 3. Reciprocal Rank Fusion
  const rrfScores = reciprocalRankFusion(denseRanks, sparseRanks, rrfK);

  // 4. Sort and construct results
  const sortedIds = Array.from(rrfScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK);

  const results: HybridSearchResult[] = [];

  for (const [id, rrfScore] of sortedIds) {
    const chunk = chunkMap.get(id);
    if (!chunk) continue;

    results.push({
      chunkId: chunk.id,
      materialId: chunk.materialId,
      materialName: chunk.materialName,
      kind: chunk.kind,
      section: chunk.section,
      page: chunk.page,
      text: chunk.text,
      denseScore: denseScores.get(id),
      sparseScore: sparseScores.get(id),
      rrfScore: Number(rrfScore.toFixed(5)),
      metadata: {
        userId,
        subjectId: opts.subjectId || "default",
        documentId: chunk.materialId,
        topicId: opts.topicId || null,
        embeddingModel: EMBEDDING_MODEL,
        embeddingVersion: EMBEDDING_VERSION,
      },
    });
  }

  return results;
}
