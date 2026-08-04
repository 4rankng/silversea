/**
 * Wave 2 — schema validation test.
 *
 * Verifies the tables, application-owned values, and columns in the consolidated baseline.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { client } from '../db';
import { db } from '../db';
import * as s from '../db/schema';

after(async () => { await client.end(); });

describe('Wave 2 — CUS Core schema', () => {
  test('shipment_milestones table exists with expected columns', async () => {
    const cols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'shipment_milestones' ORDER BY ordinal_position
    `);
    const names = cols.map((r: Record<string, unknown>) => r['column_name']);
    assert.ok(names.includes('shipment_id'));
    assert.ok(names.includes('type'));
    assert.ok(names.includes('trip_id'));
    assert.ok(names.includes('occurred_at'));
    assert.ok(names.includes('changed_by'));
  });

  test('customer_email_logs table exists with expected columns', async () => {
    const cols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'customer_email_logs' ORDER BY ordinal_position
    `);
    const names = cols.map((r: Record<string, unknown>) => r['column_name']);
    assert.ok(names.includes('customer_id'));
    assert.ok(names.includes('shipment_id'));
    assert.ok(names.includes('billing_document_id'));
    assert.ok(names.includes('status'));
    assert.ok(names.includes('retry_count'));
    assert.ok(names.includes('provider_message_id'));
  });

  test('debit-note statuses are application-owned values', async () => {
    const vals = await db.execute(sql`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'debit_note_status')
      ORDER BY enumsortorder
    `);
    const labels = vals.map((r: Record<string, unknown>) => r['enumlabel']);
    assert.deepEqual(labels, []);
    assert.deepEqual([...s.debitNoteStatusEnum.enumValues], ['DRAFT', 'SENT', 'PENDING_CONFIRM', 'CONFIRMED', 'PARTIAL_PAID', 'PAID', 'REJECTED', 'CANCELED']);
  });

  test('milestone types are application-owned values', async () => {
    const vals = await db.execute(sql`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'milestone_type')
      ORDER BY enumsortorder
    `);
    const labels = vals.map((r: Record<string, unknown>) => r['enumlabel']);
    assert.deepEqual(labels, []);
    assert.ok(s.milestoneTypeEnum.enumValues.includes('DELIVERED'));
    assert.ok(s.milestoneTypeEnum.enumValues.includes('MANUAL'));
  });

  test('email statuses are application-owned values', async () => {
    const vals = await db.execute(sql`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'email_status')
      ORDER BY enumsortorder
    `);
    const labels = vals.map((r: Record<string, unknown>) => r['enumlabel']);
    assert.deepEqual(labels, []);
    assert.deepEqual([...s.emailStatusEnum.enumValues], ['PENDING', 'SENT', 'FAILED', 'OPENED']);
  });

  test('billing_documents.debit_note_status column exists with default DRAFT', async () => {
    const [col] = await db.execute(sql`
      SELECT column_default FROM information_schema.columns
      WHERE table_name = 'billing_documents' AND column_name = 'debit_note_status'
    `);
    assert.ok(col, 'debit_note_status column exists');
    assert.match(String((col as Record<string, unknown>)['column_default']), /DRAFT/i);
  });

  test('billing_documents.customer_confirmed_at column exists', async () => {
    const [col] = await db.execute(sql`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'billing_documents' AND column_name = 'customer_confirmed_at'
    `);
    assert.ok(col, 'customer_confirmed_at column exists');
  });

  test('indexes exist on shipment_milestones', async () => {
    const idx = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'shipment_milestones'
    `);
    assert.ok(idx.length > 0);
  });

  test('indexes exist on customer_email_logs', async () => {
    const idx = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'customer_email_logs'
    `);
    assert.ok(idx.length > 0);
  });
});
