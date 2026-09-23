/**
 * Cards 20260922_75/_76 — quick-add container validation semantics.
 *
 * Contract: the NEW input is validated ALONE and named as the sole culprit;
 * seeded legacy rows with wrong ISO 6346 check digits no longer block
 * quick-add (fixture debt, card _71 ledger). The seed generator now emits
 * valid check digits (calculateCheckDigit).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role, calculateCheckDigit, validateContainerNumber } from '@tingting/shared';
import { addCusShipmentContainer } from '../services/cus-shipment-workspace-writes.service';
import type { AuthUser } from '../middleware/auth';

const suffix = `q76-${Date.now().toString(36)}`;
const created = {
  customerIds: [] as number[],
  routeIds: [] as number[],
  shipmentIds: [] as number[],
};

const LEGACY_BASE = 'MSCU861203'; // card _76's example prefix+serial
// The runtime validator is the shared ISO 6346 port — it is the authority.
// Derive a WRONG-digit legacy number and a RIGHT-digit new number from it.
const wrongDigit = (calculateCheckDigit(LEGACY_BASE) + 1) % 10;
const LEGACY_INVALID = `${LEGACY_BASE}${wrongDigit}`;
const VALID_NEW = `${LEGACY_BASE}${calculateCheckDigit(LEGACY_BASE)}`;

let shipmentId = 0;
const actor = {
  userId: 0,
  username: 'q76-disp',
  role: Role.DISPATCHER,
  customerId: null,
  customerIds: [],
} as unknown as AuthUser;

before(async () => {
  const [customer] = await db.insert(s.customers).values({ name: `Q76 customer ${suffix}` }).returning();
  created.customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Q76 route ${suffix}` }).returning();
  created.routeIds.push(route.id);
  const [row] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    blNumber: `Q76-BL-${suffix.slice(-8)}`,
    status: 'NEW',
  }).returning();
  shipmentId = row.id;
  created.shipmentIds.push(row.id);
  // The seeded legacy row with the WRONG check digit (card _76's blocker).
  await db.insert(s.shipmentContainers).values({
    shipmentId,
    containerNumber: LEGACY_INVALID,
  });
});

after(async () => {
  await db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, shipmentId));
  await db.delete(s.shipments).where(inArray(s.shipments.id, created.shipmentIds));
  if (created.routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, created.routeIds));
  if (created.customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, created.customerIds));
  await client.end();
});


async function currentShipmentVersion(): Promise<number> {
  const [row] = await db.select({ version: s.shipments.version })
    .from(s.shipments).where(eq(s.shipments.id, shipmentId));
  return row.version;
}

describe('quick-add container validation (cards _75/_76)', () => {
  test('legacy row fails, new number passes the shared ISO 6346 validator', () => {
    // The shared port is the runtime authority — the card's hand arithmetic
    // (2468 mod 11 = 4) disagrees with it; the validator that runs at
    // quick-add time is the one that counts.
    const [legacyOk] = validateContainerNumber(LEGACY_INVALID);
    const [newOk] = validateContainerNumber(VALID_NEW);
    assert.equal(legacyOk, false);
    assert.equal(newOk, true);
  });

  test('AC2 quick-add with a VALID new number succeeds despite the legacy row', async () => {
    const result = await addCusShipmentContainer({
      shipmentId,
      input: { containerNumber: VALID_NEW, expectedShipmentVersion: await currentShipmentVersion() } as never,
      actor,
    });
    assert.ok(result.line.id > 0);
    const rows = await db.select({ number: s.shipmentContainers.containerNumber })
      .from(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, shipmentId));
    assert.ok(rows.some((r) => r.number === VALID_NEW));
  });

  test('AC2 the error names the INPUT, not a legacy row (invalid format)', async () => {
    const version = await currentShipmentVersion();
    assert.rejects(
      () => addCusShipmentContainer({
        shipmentId,
        input: { containerNumber: 'TESTU7654321', expectedShipmentVersion: version } as never,
        actor,
      }),
      (error: unknown) => {
        const apiError = error as { message?: string; statusCode?: number };
        assert.equal(apiError.statusCode, 400);
        assert.match(apiError.message ?? '', /TESTU7654321/);
        assert.doesNotMatch(apiError.message ?? '', /MSCU8612035/);
        return true;
      },
    );
  });

  test('duplicate of an existing row still rejected', async () => {
    const version = await currentShipmentVersion();
    await assert.rejects(
      () => addCusShipmentContainer({
        shipmentId,
        // A VALID number already in the lot — reaches the duplicate check
        // (the wrong-digit duplicate dies earlier at input validation).
        input: { containerNumber: VALID_NEW, expectedShipmentVersion: version } as never,
        actor,
      }),
      (error: unknown) => {
        const apiError = error as { message?: string; statusCode?: number };
        assert.equal(apiError.statusCode, 400);
        assert.match(apiError.message ?? '', /đã tồn tại/);
        return true;
      },
    );
  });
});
