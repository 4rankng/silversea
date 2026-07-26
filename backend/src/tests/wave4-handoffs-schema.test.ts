/**
 * Wave 4 — dispatch_handoffs schema test.
 *
 * Verifies the table exists with expected columns, the handoff_status enum,
  the unique-active-handoff partial index, and the FK to shipments.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';

import { db, client } from '../db';

after(async () => { await client.end(); });

describe('Wave 4 — dispatch_handoffs schema', () => {
  test('table exists with expected columns', async () => {
    const cols = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'dispatch_handoffs' ORDER BY ordinal_position`);
    const names = cols.map((r: Record<string, unknown>) => r['column_name']);
    assert.ok(names.includes('shipment_id'));
    assert.ok(names.includes('handler_id'));
    assert.ok(names.includes('priority'));
    assert.ok(names.includes('vehicle_needed_by'));
    assert.ok(names.includes('operational_note'));
    assert.ok(names.includes('status'));
    assert.ok(names.includes('handoff_version'));
    assert.ok(names.includes('created_by'));
    assert.ok(names.includes('dispatched_at'));
    assert.ok(names.includes('seen_at'));
    assert.ok(names.includes('resolved_at'));
    assert.ok(names.includes('reject_reason'));
  });

  test('handoff_status enum has the 4 lifecycle values', async () => {
    const rows = await db.execute(sql`SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'handoff_status') ORDER BY enumsortorder`);
    const labels = rows.map((r: Record<string, unknown>) => r['enumlabel']);
    assert.deepEqual(labels, ['UNSEEN', 'SEEN', 'ACCEPTED', 'REJECTED']);
  });

  test('unique-active-handoff partial index exists', async () => {
    const idx = await db.execute(sql`SELECT indexname FROM pg_indexes WHERE tablename = 'dispatch_handoffs' AND indexname = 'dispatch_handoffs_shipment_active_uniq'`);
    assert.ok(idx.length > 0, 'partial unique index on (shipment_id) WHERE status IN (UNSEEN, SEEN)');
  });

  test('handler index exists', async () => {
    const idx = await db.execute(sql`SELECT indexname FROM pg_indexes WHERE tablename = 'dispatch_handoffs' AND indexname = 'dispatch_handoffs_handler_idx'`);
    assert.ok(idx.length > 0);
  });

  test('status index exists', async () => {
    const idx = await db.execute(sql`SELECT indexname FROM pg_indexes WHERE tablename = 'dispatch_handoffs' AND indexname = 'dispatch_handoffs_status_idx'`);
    assert.ok(idx.length > 0);
  });

  test('FK to shipments with ON DELETE CASCADE', async () => {
    const [fk] = await db.execute(sql`
      SELECT delete_rule FROM information_schema.referential_constraints
      WHERE constraint_name = 'dispatch_handoffs_shipment_id_shipments_id_fk'
    `);
    assert.ok(fk, 'FK exists');
    assert.equal((fk as Record<string, unknown>)['delete_rule'], 'CASCADE');
  });

  test('status defaults to UNSEEN', async () => {
    const [col] = await db.execute(sql`
      SELECT column_default FROM information_schema.columns
      WHERE table_name = 'dispatch_handoffs' AND column_name = 'status'
    `);
    assert.ok(col);
    const def = String((col as Record<string, unknown>)['column_default']);
    assert.ok(def.includes('UNSEEN'), `default includes UNSEEN, got: ${def}`);
  });
});
