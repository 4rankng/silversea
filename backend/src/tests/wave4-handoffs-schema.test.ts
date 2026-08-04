/**
 * Wave 4 — dispatch_handoffs schema test.
 *
 * Verifies the table, application-owned lifecycle values, uniqueness fence,
 * performance indexes, and absence of a database-owned shipment relationship.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';

import { db, client } from '../db';
import { handoffStatusEnum } from '../db/schema';

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

  test('handoff statuses are application-owned values', async () => {
    const rows = await db.execute(sql`SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'handoff_status') ORDER BY enumsortorder`);
    const labels = rows.map((r: Record<string, unknown>) => r['enumlabel']);
    assert.deepEqual(labels, []);
    assert.deepEqual([...handoffStatusEnum.enumValues], ['UNSEEN', 'SEEN', 'ACCEPTED', 'REJECTED']);
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

  test('shipment relationship is not owned by a database foreign key', async () => {
    const [fk] = await db.execute(sql`
      SELECT delete_rule FROM information_schema.referential_constraints
      WHERE constraint_name = 'dispatch_handoffs_shipment_id_shipments_id_fk'
    `);
    assert.equal(fk, undefined);
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
