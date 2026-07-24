// One-off backfill: embed all faq_entries with NULL `embedding` using OpenRouter
// text-embedding-3-small (1536 dims) and write the vectors via raw SQL.
//
// Run after the 0104 migration seeds the rows:
//   cd backend && npx tsx src/db/backfill-faq-embeddings.ts
//
// Idempotent — only touches rows where embedding IS NULL. Re-run after adding
// new FAQ rows. Requires the OpenRouter API key to be configured (DB setting
// page or OPENROUTER_API_KEY env). Requires the pgvector image.
import { db } from './index';
import * as s from './schema';
import { sql } from 'drizzle-orm';
import { embedTexts, vecLiteral, EMBEDDING_DIM } from '../services/llm/embeddings';

async function main() {
  // Sanity check: confirm the vector extension is available before doing work.
  try {
    await db.execute(sql`SELECT ${EMBEDDING_DIM}::int AS dim`);
  } catch (e) {
    console.error('DB not reachable:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  // Select rows needing embedding. Build the embed input from the canonical
  // question + variants so the vector captures the question's intent space.
  const rows = (await db
    .select({ id: s.faqEntries.id, question: s.faqEntries.question, variants: s.faqEntries.questionVariants })
    .from(s.faqEntries)
    .where(sql`${s.faqEntries.embedding} IS NULL`)) as Array<{
    id: number;
    question: string;
    variants: string[] | null;
  }>;

  if (rows.length === 0) {
    console.log('✓ No faq_entries need embedding (all rows already have vectors).');
    return;
  }

  console.log(`Embedding ${rows.length} FAQ entries via OpenRouter ${EMBEDDING_DIM}-dim…`);
  const inputs = rows.map((r) => [r.question, ...(r.variants ?? [])].join(' \n '));
  const vectors = await embedTexts(inputs);

  let written = 0;
  for (let i = 0; i < rows.length; i++) {
    const lit = vecLiteral(vectors[i]);
    if (!lit) {
      console.warn(`  ⚠ row ${rows[i].id}: empty vector, skipping`);
      continue;
    }
    await db.execute(
      sql`UPDATE faq_entries SET embedding = ${lit}::vector, updated_at = NOW() WHERE id = ${rows[i].id}`,
    );
    written++;
  }

  console.log(`✓ Embedded + wrote ${written}/${rows.length} FAQ entries.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
