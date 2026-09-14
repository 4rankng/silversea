/**
 * QA-060 rework: tripContainerBatchSchema ISO 6346 gate.
 *
 * The batch PUT /api/trips/:id/containers must reject malformed container
 * numbers at the schema boundary, matching the driver/forwarder add paths.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { tripContainerBatchSchema } from '@tingting/shared';

const valid = (containerNumber: string | null) => ({
  containers: [{ containerNumber }],
});

describe('QA-060 — tripContainerBatchSchema ISO 6346 gate', () => {
  test('rejects malformed ABC (format)', () => {
    const r = tripContainerBatchSchema.safeParse(valid('ABC'));
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(r.error.issues.some(i =>
        i.message.includes('định dạng')));
    }
  });

  test('rejects CONT-001 (format)', () => {
    const r = tripContainerBatchSchema.safeParse(valid('CONT-001'));
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(r.error.issues.some(i =>
        i.message.includes('định dạng')));
    }
  });

  test('rejects valid format but bad check digit MSKU1234567', () => {
    const r = tripContainerBatchSchema.safeParse(valid('MSKU1234567'));
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(r.error.issues.some(i =>
        i.message.includes('chữ số kiểm tra')));
    }
  });

  test('accepts valid container MSKU1234565', () => {
    const r = tripContainerBatchSchema.safeParse(valid('MSKU1234565'));
    assert.equal(r.success, true);
  });

  test('accepts valid container TCLU1234568', () => {
    const r = tripContainerBatchSchema.safeParse(valid('TCLU1234568'));
    assert.equal(r.success, true);
  });

  test('allows null containerNumber (placeholder row)', () => {
    const r = tripContainerBatchSchema.safeParse(valid(null));
    assert.equal(r.success, true);
  });

  test('allows undefined containerNumber', () => {
    const r = tripContainerBatchSchema.safeParse({ containers: [{}] });
    assert.equal(r.success, true);
  });

  test('error path targets the correct container index', () => {
    const r = tripContainerBatchSchema.safeParse({
      containers: [
        { containerNumber: 'MSKU1234565' }, // valid
        { containerNumber: 'ABC' },          // invalid
      ],
    });
    assert.equal(r.success, false);
    if (!r.success) {
      assert.deepEqual(r.error.issues[0].path, ['containers', 1, 'containerNumber']);
    }
  });

  test('accepts separator/lowercase input (validation normalizes before checking)', () => {
    const r = tripContainerBatchSchema.safeParse({
      containers: [{ containerNumber: 'tcku 123456 0' }],
    });
    assert.equal(r.success, true);
  });
});

describe('QA-060 — batch write canonicalizes stored numbers', () => {
  // Storage-level pin: the service persists the NORMALIZED form (uppercase,
  // separators stripped) — mirroring the driver add path — so a raw
  // 'tcku 1234 565' can never read as a distinct cost-allocation group from
  // its canonical twin.
  test('batchUpsertTripContainers stores normalizeContainerNumber output', async () => {
    const { client, db } = await import('../db');
    const s = await import('../db/schema');
    const [customer] = await db.insert(s.customers).values({
      name: `QA060 canon ${Date.now()}`,
    }).returning();
    const [route] = await db.insert(s.routes).values({
      name: `QA060 canon route ${Date.now()}`,
    }).returning();
    const [trip] = await db.insert(s.trips).values({
      tripCode: `QA060-CANON-${Date.now()}`,
      customerId: customer.id,
      routeId: route.id,
      departureDate: '2026-09-14',
      status: 'CREATED',
    }).returning();
    try {
      const { batchUpsertTripContainers } = await import('../services/forwarder-container.service');
      const items = await batchUpsertTripContainers(trip.id, null, [
        { containerNumber: 'tcku 123456 0' },
      ]);
      assert.equal(items.length, 1);
      assert.equal(items[0].containerNumber, 'TCKU1234560');

      const [row] = await db.select({ number: s.tripContainers.containerNumber })
        .from(s.tripContainers)
        .where(eq(s.tripContainers.id, items[0].id));
      assert.equal(row?.number, 'TCKU1234560');
    } finally {
      await db.delete(s.tripContainers).where(eq(s.tripContainers.tripId, trip.id));
      await db.delete(s.trips).where(eq(s.trips.id, trip.id));
      await db.delete(s.routes).where(eq(s.routes.id, route.id));
      await db.delete(s.customers).where(eq(s.customers.id, customer.id));
      await client.end();
    }
  });
});
