// FAQ fast lane — a pre-LLM, zero-LLM path that answers seeded domain questions
// from faq_entries. Mirrors the reference repo's 4-stage cascade (faq_bypass.py),
// tuned for our pgvector + OpenRouter text-embedding-3-small stack.
//
// 4 stages, run in order; the first to produce a confident match wins:
//   1. EXACT  — normalized query equals the canonical question or a variant.
//   2. RULE   — narrow the candidate set: all required_terms present, no
//               forbidden_terms present. (Applied inside the semantic SQL.)
//   3. SEMANTIC — embed the query (cached in Redis) and cosine-match via the
//               pgvector <=> operator over the HNSW index.
//   4. GATE   — accept only if top-1 similarity >= SCORE_FLOOR AND the gap to
//               the runner-up >= MARGIN. Otherwise ABSTAIN (return null) and the
//               caller falls through to the LLM agent.
//
// Fail-open contract: on ANY error/timeout, return null. The fast lane must
// never block the agent — it only ever short-circuits success.
import { db } from '../../db';
import * as s from '../../db/schema';
import { sql } from 'drizzle-orm';
import { cacheGet } from '../../lib/redis';
import { embedText, vecLiteral } from '../llm/embeddings';
import { normalizeText } from './text';

/** Normalize for exact FAQ matching: diacritic-insensitive + lowercase + strip
 *  punctuation/whitespace, so "bao nhiêu?" matches "bao nhieu". `normalizeText`
 *  (the agent-wide helper) only strips tones — it preserves punctuation, which
 *  would break exact FAQ matching on questions ending in '?'. */
function normalizeForFaq(s: string): string {
  return normalizeText(s).replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

export interface FaqMatch {
  entryId: number;
  question: string;
  answer: string;
  score: number;
  stage: 'exact' | 'semantic';
}

// ── Tunable thresholds ──
// SCORE_FLOOR: minimum cosine similarity for the top candidate. Below this, no
//   match is confident enough — abstain.
// MARGIN: required gap between the top two candidates. A thin margin means the
//   query is ambiguous between two FAQs — abstain rather than risk a wrong answer.
//
// Tuned for openai/text-embedding-3-small (1536-dim) on short Vietnamese
// questions. Empirically (verified against staging), legit paraphrases of a
// seeded FAQ score ~0.40-0.50 while unrelated questions score ~0.20-0.30, so
// 0.40 + a 0.12 margin cleanly separates true matches from noise. The reference
// repo used 0.78 — that was tuned for a different model; do NOT copy it blindly.
export const SCORE_FLOOR = 0.40;
export const MARGIN = 0.12;
const EMBED_CACHE_TTL = 60 * 30; // 30 min — paraphrases repeat within a session
const TOP_K = 5;

/** Quick SHA-ish key for the normalized query, for Redis caching of embeddings. */
function embedCacheKey(normalized: string): string {
  // Simple deterministic hash → base36. Adequate for cache keying (collisions
  // just cause a re-embed, never a wrong answer).
  let h = 5381;
  for (let i = 0; i < normalized.length; i++) h = (h * 33) ^ normalized.charCodeAt(i);
  return `faq:embed:${(h >>> 0).toString(36)}`;
}

/** Embed the query, caching the vector in Redis keyed by normalized text.
 *  Caching collapses repeated paraphrases within the TTL to one API call. */
async function embedQuery(normalized: string): Promise<number[]> {
  return cacheGet<number[]>(
    embedCacheKey(normalized),
    EMBED_CACHE_TTL,
    async () => embedText(normalized),
  );
}

/** Stage 1 — exact normalized match against question + variants. */
async function tryExactMatch(normalized: string): Promise<FaqMatch | null> {
  const rows = await db
    .select({
      id: s.faqEntries.id,
      question: s.faqEntries.question,
      answer: s.faqEntries.answer,
      variants: s.faqEntries.questionVariants,
    })
    .from(s.faqEntries)
    .where(sql`${s.faqEntries.isActive} = TRUE`);

  for (const r of rows) {
    if (isExactMatch(normalized, r.question, r.variants)) {
      return { entryId: r.id, question: r.question, answer: r.answer, score: 1.0, stage: 'exact' };
    }
  }
  return null;
}

interface SemanticRow {
  id: number;
  question: string;
  answer: string;
  similarity: number;
}

/** Stage 2+3+4 — rule-gated semantic cosine match with score/margin gate. */
async function trySemanticMatch(normalized: string): Promise<FaqMatch | null> {
  let vec: number[];
  try {
    vec = await embedQuery(normalized);
  } catch (e) {
    // No embedding key configured, OpenRouter down, etc. — abstain, fall to LLM.
    console.warn('[faq-fast-lane] embed failed, abstaining:', e instanceof Error ? e.message : e);
    return null;
  }
  const lit = vecLiteral(vec);
  if (!lit) return null;

  // Rule gate in SQL. Correctness points:
  //  (1) Precedence: `=` binds tighter than `&&` in Postgres, so the
  //      forbidden-terms check MUST be wrapped in `NOT (...)` — writing
  //      `&& ... = ARRAY[]` parses as `&& (... = ARRAY[])` (type error).
  //  (2) Diacritics: `normalized` is already tone-stripped (normalizeForFaq),
  //      so we split it into tokens in TS. This keeps both sides of the
  //      `<@` / `&&` comparison diacritic-consistent (the seed stores
  //      tone-stripped required/forbidden terms too — see
  //      0104_faq_knowledge_base.sql).
  //  (3) Array binding: postgres.js renders a bare JS array param as a ROW/
  //      record constructor `($1,$2,...)`, NOT a PG array — so
  //      `${queryTokens}::text[]` raises "cannot cast type record to text[]"
  //      (42846). Build the array via an explicit ARRAY[..] constructor with
  //      sql.join so each token is a separate typed param.
  const queryTokens = normalized.split(/\s+/).filter(Boolean);
  const tokensArray = sql.join(queryTokens.map((t) => sql`${t}::text`), sql.raw(','));
  // postgres-js returns rows directly (no .rows wrapper) — cast as the codebase does.
  const rows = (await db.execute(sql`
    SELECT id, question, answer,
           1 - (embedding <=> ${lit}::vector) AS similarity
    FROM faq_entries
    WHERE embedding IS NOT NULL
      AND is_active = TRUE
      AND ${s.faqEntries.requiredTerms} <@ ARRAY[${tokensArray}]
      AND NOT (${s.faqEntries.forbiddenTerms} && ARRAY[${tokensArray}])
    ORDER BY embedding <=> ${lit}::vector
    LIMIT ${TOP_K}
  `)) as unknown as SemanticRow[];

  if (rows.length === 0) return null;
  return pickSemanticWinner(rows);
}

/** Stage 4 (pure) — apply the score/margin gate to ranked semantic candidates.
 *  Exported for unit testing without a DB/embedding dependency. Returns the
 *  winning match or null (abstain). */
export function pickSemanticWinner(rows: SemanticRow[]): FaqMatch | null {
  if (rows.length === 0) return null;
  const top = rows[0];
  const second = rows[1];
  // Gate: top must clear SCORE_FLOOR AND beat the runner-up by MARGIN.
  // A single candidate still needs to clear SCORE_FLOOR (no margin check then).
  if (top.similarity < SCORE_FLOOR) return null;
  if (second && top.similarity - second.similarity < MARGIN) return null;
  return {
    entryId: top.id,
    question: top.question,
    answer: top.answer,
    score: top.similarity,
    stage: 'semantic',
  };
}

/** Stage 1 (pure) — does the query exactly match the canonical question or any
 *  variant? Both sides are normalized (diacritic-insensitive, lowercased), so
 *  callers can pass raw text. Exported for unit testing. */
export function isExactMatch(
  query: string,
  question: string,
  variants: string[] | null,
): boolean {
  const norm = normalizeForFaq(query);
  const candidates = [question, ...(variants ?? [])].map(normalizeForFaq);
  return candidates.includes(norm);
}

/** Run the full fast-lane cascade. Returns null to abstain (→ LLM agent).
 *  Fail-open: any error returns null. */
export async function tryFaqFastLane(message: string): Promise<FaqMatch | null> {
  const normalized = normalizeForFaq(message);
  if (!normalized) return null;

  try {
    // Stage 1 — exact (no embedding/API call needed, cheapest win).
    const exact = await tryExactMatch(normalized);
    if (exact) return exact;

    // Stages 2-4 — rule-gated semantic match with gate.
    return await trySemanticMatch(normalized);
  } catch (e) {
    console.warn('[faq-fast-lane] cascade error, abstaining:', e instanceof Error ? e.message : e);
    return null;
  }
}
