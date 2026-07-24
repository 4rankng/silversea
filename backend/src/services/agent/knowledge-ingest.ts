// Knowledge Ingest — P2 doc-RAG pipeline.
//
// Reads product docs (CONTEXT.md, ADRs) from disk, chunks them by heading,
// embeds each chunk via the existing embeddings.ts service, and upserts into
// the knowledge_chunks table. Re-runnable: upserts by (source_type, source_path,
// heading) so content edits are picked up without duplicates.
//
// The chunker is intentionally simple: split by markdown headings (## or ###),
// keep each chunk ≤500 chars, and attach metadata. No complex NLP — the
// embedding model handles semantic matching.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
import { db } from '../../db';
import * as schema from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { embedTexts, vecLiteral } from '../llm/embeddings';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface KnowledgeChunk {
  sourceType: string;
  sourcePath: string;
  heading: string;
  content: string;
}

export interface IngestResult {
  total: number;
  embedded: number;
  skipped: number;
  errors: string[];
}

// ─── Chunker ────────────────────────────────────────────────────────────────

const MAX_CHUNK_CHARS = 500;

/**
 * Parse a markdown file into semantic chunks by heading. Each heading + its
 * body becomes one chunk. Chunks longer than MAX_CHUNK_CHARS are split further.
 */
export function chunkMarkdown(sourcePath: string, content: string): KnowledgeChunk[] {
  const sourceType = inferSourceType(sourcePath);
  const lines = content.split('\n');
  const chunks: KnowledgeChunk[] = [];
  let currentHeading = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line);
    if (headingMatch) {
      // Flush the previous chunk.
      if (currentBody.length > 0) {
        flushChunk(chunks, sourceType, sourcePath, currentHeading, currentBody.join('\n'));
      }
      currentHeading = headingMatch[2].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  // Flush the last chunk.
  if (currentBody.length > 0) {
    flushChunk(chunks, sourceType, sourcePath, currentHeading, currentBody.join('\n'));
  }
  return chunks;
}

function flushChunk(
  out: KnowledgeChunk[],
  sourceType: string,
  sourcePath: string,
  heading: string,
  rawContent: string,
): void {
  const content = rawContent.trim();
  if (content.length < 10) return; // skip tiny fragments

  // Split overly long chunks at paragraph boundaries.
  if (content.length <= MAX_CHUNK_CHARS) {
    out.push({ sourceType, sourcePath, heading: heading || basename(sourcePath), content });
    return;
  }
  const paragraphs = content.split(/\n\n+/);
  let buf = '';
  for (const p of paragraphs) {
    if ((buf + '\n\n' + p).length > MAX_CHUNK_CHARS && buf) {
      out.push({ sourceType, sourcePath, heading: heading || basename(sourcePath), content: buf.trim() });
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf.trim()) {
    out.push({ sourceType, sourcePath, heading: heading || basename(sourcePath), content: buf.trim() });
  }
}

function inferSourceType(sourcePath: string): string {
  if (sourcePath === 'CONTEXT.md' || sourcePath.endsWith('CONTEXT.md')) return 'context';
  if (sourcePath.includes('/adr/') || sourcePath.includes('\\adr\\')) return 'adr';
  return 'doc';
}

// ─── Upsert ─────────────────────────────────────────────────────────────────

/**
 * Upsert knowledge chunks: embed them and write to the DB. Existing chunks for
 * the same (source_type, source_path, heading) are replaced (delete + insert).
 * Idempotent — safe to re-run after editing docs.
 */
export async function ingestChunks(chunks: KnowledgeChunk[]): Promise<IngestResult> {
  const result: IngestResult = { total: chunks.length, embedded: 0, skipped: 0, errors: [] };

  if (chunks.length === 0) return result;

  // Embed all chunks in one batch.
  let embeddings: number[][];
  try {
    embeddings = await embedTexts(chunks.map((c) => `${c.heading}: ${c.content}`));
  } catch (e) {
    result.errors.push(`Embedding failed: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = embeddings[i];
    if (!embedding) {
      result.skipped++;
      continue;
    }
    try {
      // Delete existing chunk(s) for this source+heading, then insert.
      await db.delete(schema.knowledgeChunks).where(and(
        eq(schema.knowledgeChunks.sourceType, chunk.sourceType),
        eq(schema.knowledgeChunks.sourcePath, chunk.sourcePath),
        eq(schema.knowledgeChunks.heading, chunk.heading),
      ));
      await db.insert(schema.knowledgeChunks).values({
        sourceType: chunk.sourceType,
        sourcePath: chunk.sourcePath,
        heading: chunk.heading,
        content: chunk.content,
        embedding: vecLiteral(embedding),
        docVersion: createHash('md5').update(chunk.content).digest('hex').slice(0, 12),
        lang: 'vi',
      });
      result.embedded++;
    } catch (e) {
      result.errors.push(`Failed to upsert "${chunk.heading}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

// ─── File readers ───────────────────────────────────────────────────────────

/** Read and chunk CONTEXT.md from the repo root. */
export function readContextMd(repoRoot: string): KnowledgeChunk[] {
  const path = join(repoRoot, 'CONTEXT.md');
  if (!existsSync(path)) return [];
  return chunkMarkdown('CONTEXT.md', readFileSync(path, 'utf-8'));
}

/** Read and chunk all ADR files from docs/adr/. */
export function readAdrs(repoRoot: string): KnowledgeChunk[] {
  const adrDir = join(repoRoot, 'docs', 'adr');
  if (!existsSync(adrDir)) return [];
  const chunks: KnowledgeChunk[] = [];
  for (const file of readdirSync(adrDir).filter((f) => f.endsWith('.md'))) {
    const fullPath = join(adrDir, file);
    const content = readFileSync(fullPath, 'utf-8');
    const sourcePath = `docs/adr/${file}`;
    chunks.push(...chunkMarkdown(sourcePath, content));
  }
  return chunks;
}

/**
 * Full ingestion: read CONTEXT.md + all ADRs, chunk, embed, and upsert.
 * Run via: `cd backend && pnpm tsx src/services/agent/knowledge-ingest.ts`
 */
export async function ingestAll(repoRoot: string): Promise<IngestResult> {
  const allChunks = [...readContextMd(repoRoot), ...readAdrs(repoRoot)];
  console.log(`[knowledge-ingest] Read ${allChunks.length} chunks from CONTEXT.md + ADRs`);
  const result = await ingestChunks(allChunks);
  console.log(`[knowledge-ingest] Embedded ${result.embedded}/${result.total}, skipped ${result.skipped}, errors ${result.errors.length}`);
  if (result.errors.length > 0) {
    for (const e of result.errors.slice(0, 5)) console.error(`  ✗ ${e}`);
  }
  return result;
}

// CLI entry point (when run directly via `pnpm tsx .../knowledge-ingest.ts`).
// In ESM there's no `require.main === module`, so use import.meta.url.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const repoRoot = process.argv[2] ?? resolveRepoRoot();
  ingestAll(repoRoot).catch((e) => {
    console.error('[knowledge-ingest] Fatal:', e);
    process.exit(1);
  });
}

function resolveRepoRoot(): string {
  // The backend is at <repoRoot>/backend; the ingest script is at
  // backend/src/services/agent/. Go up 4 levels from __dirname.
  return join(__dirname, '..', '..', '..', '..');
}
