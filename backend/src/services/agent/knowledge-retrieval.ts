// Knowledge Retrieval — P2 doc-RAG search over knowledge_chunks.
//
// Embeds the query (cached in Redis like the FAQ fast lane), then runs a
// pgvector cosine similarity search over knowledge_chunks. Returns the top-K
// chunks with their source metadata for citation.
//
// Reuses the exact same embedding pipeline as faq-fast-lane.ts — same model,
// same Redis caching pattern, same cosine SQL. Fail-open: any error returns [].

import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { embedText, vecLiteral } from '../llm/embeddings';
import { cacheGet } from '../../lib/redis';

const EMBED_CACHE_TTL = 60 * 30; // 30 min — same as FAQ fast lane
const DEFAULT_TOP_K = 5;
const MIN_SIMILARITY = 0.30; // lower than FAQ (0.40) — docs are broader

export interface RetrievedChunk {
  id: number;
  sourceType: string;
  sourcePath: string;
  heading: string;
  content: string;
  similarity: number;
}

/** Build a citation from a retrieved chunk. */
export function chunkToCitation(chunk: RetrievedChunk): {
  sourceId: string;
  label: string;
  kind: 'faq' | 'doc' | 'tool';
  url?: string;
} {
  const labelMap: Record<string, string> = {
    context: 'CONTEXT.md',
    adr: chunk.sourcePath.split('/').pop() ?? 'ADR',
    doc: chunk.sourcePath.split('/').pop() ?? chunk.sourcePath,
  };
  return {
    sourceId: `doc:${chunk.sourcePath}:${chunk.heading}`.slice(0, 100),
    label: chunk.heading || labelMap[chunk.sourceType] || chunk.sourcePath,
    kind: 'doc',
    ...(chunk.sourcePath.startsWith('docs/') ? { url: chunk.sourcePath } : {}),
  };
}

/** Embed the query, caching the vector in Redis (same pattern as FAQ). */
async function embedQuery(normalized: string): Promise<number[]> {
  return cacheGet<number[]>(
    `knowledge:embed:${hashKey(normalized)}`,
    EMBED_CACHE_TTL,
    async () => embedText(normalized),
  );
}

function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/**
 * Retrieve knowledge chunks matching a query. Returns top-K chunks ranked by
 * cosine similarity, filtered to MIN_SIMILARITY. Fail-open: errors return [].
 *
 * @param query The raw user query (will be embedded).
 * @param topK Maximum chunks to return (default 5).
 */
export async function retrieveKnowledge(
  query: string,
  topK = DEFAULT_TOP_K,
): Promise<RetrievedChunk[]> {
  let vec: number[];
  try {
    vec = await embedQuery(query.trim());
  } catch (e) {
    console.warn('[knowledge-retrieval] embed failed, abstaining:', e instanceof Error ? e.message : e);
    return [];
  }
  const lit = vecLiteral(vec);
  if (!lit) return [];

  try {
    const rows = (await db.execute(sql`
      SELECT id, source_type, source_path, heading, content,
             1 - (embedding <=> ${lit}::vector) AS similarity
      FROM knowledge_chunks
      WHERE embedding IS NOT NULL
        AND 1 - (embedding <=> ${lit}::vector) >= ${MIN_SIMILARITY}
      ORDER BY embedding <=> ${lit}::vector
      LIMIT ${topK}
    `)) as unknown as RetrievedChunk[];

    return rows;
  } catch (e) {
    console.warn('[knowledge-retrieval] query failed, abstaining:', e instanceof Error ? e.message : e);
    return [];
  }
}
