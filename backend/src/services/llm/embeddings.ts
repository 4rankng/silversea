// Embedding service for the FAQ fast lane — calls OpenRouter's
// OpenAI-compatible /embeddings endpoint using the LIVE agent OpenRouter key
// (DB-stored + encrypted, resolved via services/llm/settings.ts), falling back
// to the env OPENROUTER_API_KEY when no DB key is saved.
//
// Model: openai/text-embedding-3-small (1536 dims). Chosen over text-embedding-
// 3-large (3072) because 1536 is within pgvector's native HNSW 2000-dim cap (no
// halfvec cast needed), is cheaper/faster, and is sufficient for a small FAQ
// corpus. Matches the migration's vector(1536) column.
import { OPENROUTER_BASE_URL } from './models';
import { config } from '../../config';
import { getLlmSettings } from './settings';

export const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export const EMBEDDING_DIM = 1536;
const EMBED_TIMEOUT_MS = 30_000;
const EMBED_BATCH_SIZE = 64; // OpenRouter/OpenAI accepts batches; keep modest.

/** Resolve the API key: live DB-stored key first (admin-configured), env fallback. */
async function resolveApiKey(): Promise<string> {
  try {
    const settings = await getLlmSettings();
    if (settings.openrouterKey) return settings.openrouterKey;
  } catch {
    // fall through to env
  }
  return config.openrouterApiKey;
}

/** Embed one or more texts. Returns vectors aligned to the input order. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const key = await resolveApiKey();
  if (!key) {
    throw new Error('Embedding yêu cầu OpenRouter API key (chưa cấu hình).');
  }

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
    try {
      const res = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '<no body>');
        throw new Error(`OpenRouter embeddings HTTP ${res.status}: ${errBody.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      for (const d of data.data) out.push(d.embedding);
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

/** Embed a single text (convenience for the fast-lane query path). */
export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  if (!vec) throw new Error('OpenRouter trả về embedding rỗng.');
  return vec;
}

/** Format a vector as a pgvector literal: [0.12345678,0.98765432,...].
 *  Ported from the reference repo's core/vector.py — 8-decimal precision keeps
 *  the literal compact without measurably affecting cosine similarity. */
export function vecLiteral(v: number[]): string {
  if (!v.length) return '';
  return '[' + v.map((x) => x.toFixed(8)).join(',') + ']';
}
