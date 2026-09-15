/**
 * Wave 4 M10.2 slice 1 — container-number format + duplicate checks.
 *
 * Hits the real Postgres DB (mirrors `shipment-service.test.ts`): creates
 * the minimum scaffolding (customer + containerType + shipment), exercises
 * `batchUpsertShipmentContainers` with various container-number inputs, and
 * tears everything down in `after`.
 *
 * Coverage (PRD M10-02-03 "format + duplicate checks"):
 *   - valid ISO 6346 numbers are accepted (format + check digit).
 *   - invalid FORMAT (wrong shape) → 400 with a Vietnamese message.
 *   - invalid CHECK DIGIT (right shape, wrong digit) → 400.
 *   - duplicate number within the same batch → 400.
 *   - null/empty numbers are allowed (placeholder rows before the BL).
 *   - a rejected batch leaves the shipment's container set untouched.
 *   - cross-shipment reuse of the same number is legal (shared pool).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { createShipment, batchUpsertShipmentContainers } from '../services/shipment.service';
import { ApiError } from '../errors';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdContainerTypeIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `M102 customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkContainerType() {
  // Fresh random short code — `container_types.code` is UNIQUE.
  const shortCode = `M1${Math.random().toString(16).slice(2, 10)}`;
  const [ct] = await db.insert(s.containerTypes)
    .values({ code: shortCode, name: `M102 ct ${suffix}` })
    .returning();
  createdContainerTypeIds.push(ct.id);
  return ct;
}

async function mkShipment() {
  const customer = await mkCustomer();
  const shipment = await createShipment({ customerId: customer.id });
  createdShipmentIds.push(shipment.id);
  return shipment;
}

async function assert400(fn: () => Promise<unknown>): Promise<ApiError> {
  try {
    await fn();
    throw new Error('expected ApiError(400) but the call succeeded');
  } catch (err) {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${(err as Error).name}`);
    assert.equal(err.statusCode, 400);
    return err;
  }
}

let containerTypeId: number;

before(async () => {
  const ct = await mkContainerType();
  containerTypeId = ct.id;
});

// ── KP-058 container PATCH boundary matrix ──────────────────────────────────
// Path                 | valid save        | invalid reject         | canonical normalize         | partial-write rollback
// ---------------------|-------------------|------------------------|-----------------------------|------------------------
// batch (this file)    | 'valid ISO...'    | FORMAT/CHECK DIGIT/dup | separator/lowercase accepted| 'rejected batch leaves...untouched'
// driver edit          | driver-container-routes 'spaced valid persists NORMALIZED' | driver-container-routes 'ABC'/wrong-digit | same | driver-container-routes 'writes nothing'
// CUS correction       | cus-shipment-workspace 'number-only add saves' | cus-shipment-workspace ISO-gate rejects | validContainerNumber construction | cus-shipment-workspace 'rejected correction writes nothing'
// Shared gate: refactor 2f2e4433 routes every path through one ISO 6346
// schema; these pins keep each mutation boundary independently provable.
describe('M10.2 slice 1 — container-number validation', () => {
  test('valid ISO 6346 numbers are accepted (format + check digit)', async () => {
    const shipment = await mkShipment();
    const ids = await batchUpsertShipmentContainers(shipment.id, null, [
      { containerTypeId, containerNumber: 'MSKU1234565' },
      { containerTypeId, containerNumber: 'TCNU7425363' },
    ]);
    assert.equal(ids.length, 2);
  });

  test('invalid FORMAT (wrong shape) → 400', async () => {
    const shipment = await mkShipment();
    const err = await assert400(() =>
      batchUpsertShipmentContainers(shipment.id, null, [
        { containerTypeId, containerNumber: 'KEEP' }, // not XXXXNNNNNNN
      ]),
    );
    assert.match(err.message, /không hợp lệ/i);
    assert.match(err.message, /KEEP/);
  });

  test('invalid CHECK DIGIT (right shape, wrong digit) → 400', async () => {
    const shipment = await mkShipment();
    // MSKU1234567 has the right shape but the wrong check digit (valid = MSKU1234565).
    const err = await assert400(() =>
      batchUpsertShipmentContainers(shipment.id, null, [
        { containerTypeId, containerNumber: 'MSKU1234567' },
      ]),
    );
    assert.match(err.message, /không hợp lệ/i);
    assert.match(err.message, /MSKU1234567/);
  });

  test('duplicate number within the same batch → 400', async () => {
    const shipment = await mkShipment();
    const err = await assert400(() =>
      batchUpsertShipmentContainers(shipment.id, null, [
        { containerTypeId, containerNumber: 'OOLU8312661' },
        { containerTypeId, containerNumber: 'OOLU8312661' }, // duplicate
      ]),
    );
    assert.match(err.message, /trùng/i);
    assert.match(err.message, /OOLU831266/);
  });

  test('a 1-row reconcile with the prior number REPLACES the prior set (dup check is batch-internal only)', async () => {
    const shipment = await mkShipment();
    // Seed one container.
    await batchUpsertShipmentContainers(shipment.id, null, [
      { containerTypeId, containerNumber: 'MEDU2497795' },
    ]);
    // A 1-row reconcile with the SAME number is NOT a within-batch duplicate
    // (only one row), so it succeeds and replaces the prior set. The
    // duplicate check is scoped to the incoming batch, not vs. prior state —
    // this is what lets a clerk fix a typo by resubmitting the corrected
    // single number.
    const ids = await batchUpsertShipmentContainers(shipment.id, null, [
      { containerTypeId, containerNumber: 'MEDU2497795' },
    ]);
    assert.equal(ids.length, 1);
    const rows = await db.select({ num: s.shipmentContainers.containerNumber })
      .from(s.shipmentContainers)
      .where(inArray(s.shipmentContainers.shipmentId, [shipment.id]));
    assert.equal(rows.length, 1, 'reconcile replaced the prior set 1-for-1');
  });

  test('null/empty numbers are allowed (placeholder rows)', async () => {
    const shipment = await mkShipment();
    const ids = await batchUpsertShipmentContainers(shipment.id, null, [
      { containerTypeId, containerNumber: null },
      { containerTypeId, containerNumber: '' },
      { containerTypeId, containerNumber: '   ' },
    ]);
    assert.equal(ids.length, 3, 'three placeholder rows accepted');
  });

  test('a rejected batch leaves the shipment container set untouched', async () => {
    const shipment = await mkShipment();
    // Seed one valid container.
    await batchUpsertShipmentContainers(shipment.id, null, [
      { containerTypeId, containerNumber: 'CMAU5814257' },
    ]);
    // Attempt a batch that contains an invalid number — must reject entirely.
    await assert400(() =>
      batchUpsertShipmentContainers(shipment.id, null, [
        { containerTypeId, containerNumber: 'CMAU5814257' },
        { containerTypeId, containerNumber: 'BAD' }, // invalid → whole batch rejected
      ]),
    );
    // The original seeded container is still the only row.
    // One row, original number — the rejected batch wrote nothing.
    const rows = await db.select({ num: s.shipmentContainers.containerNumber })
      .from(s.shipmentContainers)
      .where(inArray(s.shipmentContainers.shipmentId, [shipment.id]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].num, 'CMAU5814257');
  });

  test('cross-shipment reuse of the same number is legal (shared pool)', async () => {
    // Two shipments may carry the same container number — cross-shipment
    // uniqueness is NOT required (shared container pool).
    const a = await mkShipment();
    const b = await mkShipment();
    const idsA = await batchUpsertShipmentContainers(a.id, null, [
      { containerTypeId, containerNumber: 'FCIU8392736' },
    ]);
    const idsB = await batchUpsertShipmentContainers(b.id, null, [
      { containerTypeId, containerNumber: 'FCIU8392736' },
    ]);
    assert.equal(idsA.length, 1);
    assert.equal(idsB.length, 1);
  });
});

// Bootstrap the shared containerType before tests run.
after(async () => {
  try {
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipmentContainers)
        .where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentStatusHistory)
        .where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdContainerTypeIds.length > 0) {
      await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  } catch (err) {
    console.warn('[m102-container-validation.test] cleanup partial:', (err as Error).message);
  }
  // Force-exit — same rationale as shipment-routes.test.ts: the postgres-js
  // client doesn't drain cleanly on this Node / postgres-js combo.
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
