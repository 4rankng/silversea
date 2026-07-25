/**
 * Wave 3 — Financial Close schema validation test.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { client } from '../db';
import { db } from '../db';

after(async () => { await client.end(); });

describe('Wave 3 — Financial Close schema', () => {
  test('payment_allocations table exists with expected columns', async () => {
    const cols = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'payment_allocations' ORDER BY ordinal_position`);
    const names = cols.map((r: Record<string, unknown>) => r['column_name']);
    assert.ok(names.includes('customer_id'));
    assert.ok(names.includes('target_type'));
    assert.ok(names.includes('target_id'));
    assert.ok(names.includes('amount'));
    assert.ok(names.includes('allocation_method'));
  });

  test('salary_period_closes table exists with unique period', async () => {
    const idx = await db.execute(sql`SELECT indexname FROM pg_indexes WHERE tablename = 'salary_period_closes' AND indexname = 'salary_period_closes_period_uniq'`);
    assert.ok(idx.length > 0, 'unique index on period exists');
  });

  test('customers.credit_warning_threshold column exists (nullable)', async () => {
    const [col] = await db.execute(sql`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'credit_warning_threshold'`);
    assert.ok(col, 'column exists');
    assert.equal((col as Record<string, unknown>)['is_nullable'], 'YES');
  });

  test('customers.payment_term_days column exists (nullable)', async () => {
    const [col] = await db.execute(sql`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'payment_term_days'`);
    assert.ok(col, 'column exists');
    assert.equal((col as Record<string, unknown>)['is_nullable'], 'YES');
  });

  test('expense_categories.substitute_evidence_allowed exists with default true', async () => {
    const [col] = await db.execute(sql`SELECT column_default FROM information_schema.columns WHERE table_name = 'expense_categories' AND column_name = 'substitute_evidence_allowed'`);
    assert.ok(col, 'column exists');
    assert.match(String((col as Record<string, unknown>)['column_default']), /true/i);
  });
});
