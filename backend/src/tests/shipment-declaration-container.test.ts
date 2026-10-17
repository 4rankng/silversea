/**
 * FB-110 + FB-109 (cards 171026122110 / 171026122100) — per-container tờ khai
 * saves and the auto-copy chain, against the shared decomposition owner
 * `ensureShipmentFulfillmentsInTx`.
 *
 * FB-110 diagnosis (testplan/2026-10-17-card-fb110-fb109-to-khai.md): a lot
 * born READY_FOR_DISPATCH keeps the create contract "FCL does not decompose at
 * create — container writes own their decomposition", and `addCusShipmentContainer`
 * decomposes only the NEW container. The active fulfillment set is then
 * PARTIAL-but-clean (every row points at one current container, some containers
 * have no row), and the strict assert turned that shape into a permanent 409 on
 * every write for the row-less container — exactly where the tờ khai save died.
 * The fix heals the clean partial set inside the same locked transaction;
 * foreign shapes (NULL-container row / dangling container / duplicates) and the
 * whole LCL law stay under the strict assert.
 *
 * Matrix: FB-110 R1..R4, FB-109 R1..R3, plus the LCL strict-law pin.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role, calculateCheckDigit } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import { ApiError } from '../errors';
import {
  addCusShipmentContainer,
  copyCusShipmentContainerDeclaration,
  updateCusShipmentContainerLine,
} from '../services/cus-shipment-workspace-writes.service';
import { ensureShipmentFulfillmentsInTx } from '../services/shipment-fulfillment.service';

const suffix = `fb110-${Date.now().toString(36)}`;

const created = {
  userIds: [] as number[],
  customerIds: [] as number[],
  containerTypeIds: [] as number[],
  shipmentIds: [] as number[],
};

let adminId = 0;
let actor: AuthUser;
let containerTypeId = 0;

// Distinct ISO 6346-valid numbers (owner FBxx + serial + computed check digit).
let containerSeq = 0;
function nextContainerNumber(): string {
  containerSeq += 1;
  const owner = `FB${'ABCDEFGH'[Math.floor(containerSeq / 8) % 8]}${'ABCDEFGH'[containerSeq % 8]}`;
  const serial = String(containerSeq).padStart(6, '0');
  return `${owner}${serial}${calculateCheckDigit(`${owner}${serial}`)}`;
}

function declTag(tag: string): string {
  return `DECL-${suffix}-${tag}`;
}

/** Born-READY FCL lot, version 1 — mirrors the create contract: born-ready FCL
 * lots carry containers but NO fulfillments until a container write owns the
 * decomposition. */
async function seedFclLot(tag: string): Promise<typeof s.shipments.$inferSelect> {
  const [customer] = await db.insert(s.customers).values({ name: `FB110 ${tag} ${suffix}` }).returning();
  created.customerIds.push(customer.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    blNumber: `FB110-${tag}-${suffix}`.slice(0, 50),
    tradeDirection: 'IMPORT',
    cargoMode: 'FCL',
    status: 'READY_FOR_DISPATCH',
    expectedDeliveryDate: '2026-10-20',
    version: 1,
    createdBy: adminId,
  }).returning();
  created.shipmentIds.push(shipment.id);
  return shipment;
}

async function seedContainerRow(
  shipmentId: number,
  overrides: Partial<typeof s.shipmentContainers.$inferInsert> = {},
): Promise<typeof s.shipmentContainers.$inferSelect> {
  const [row] = await db.insert(s.shipmentContainers).values({
    shipmentId,
    containerNumber: nextContainerNumber(),
    containerTypeId,
    ...overrides,
  }).returning();
  return row;
}

async function seedFulfillmentRow(
  shipmentId: number,
  shipmentContainerId: number | null,
  overrides: Partial<typeof s.shipmentFulfillments.$inferInsert> = {},
): Promise<typeof s.shipmentFulfillments.$inferSelect> {
  const [row] = await db.insert(s.shipmentFulfillments).values({
    shipmentId,
    shipmentContainerId,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    sourceShipmentVersion: 1,
    siteSnapshot: {},
    createdBy: adminId,
    ...overrides,
  }).returning();
  return row;
}

async function activeFulfillments(shipmentId: number) {
  return db.select().from(s.shipmentFulfillments).where(and(
    eq(s.shipmentFulfillments.shipmentId, shipmentId),
    isNull(s.shipmentFulfillments.canceledAt),
  ));
}

async function declOf(containerId: number): Promise<string | null> {
  const [row] = await db.select({ declarationNumber: s.shipmentContainers.declarationNumber })
    .from(s.shipmentContainers).where(eq(s.shipmentContainers.id, containerId));
  return row?.declarationNumber ?? null;
}

async function versionOf(shipmentId: number): Promise<number> {
  const [row] = await db.select({ version: s.shipments.version })
    .from(s.shipments).where(eq(s.shipments.id, shipmentId));
  return row?.version ?? -1;
}

function expectApiError(promise: Promise<unknown>, statusCode: number, message: string): Promise<void> {
  return promise.then(
    () => assert.fail(`expected ApiError ${statusCode} "${message}", got success`),
    (error: unknown) => {
      assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`);
      assert.equal(error.statusCode, statusCode);
      assert.equal(error.message, message);
    },
  );
}

before(async () => {
  const [admin] = await db.insert(s.users).values({
    username: `fb110-admin-${suffix}`,
    passwordHash: 'test-only',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning();
  created.userIds.push(admin.id);
  adminId = admin.id;
  actor = { userId: admin.id, role: Role.ADMIN, username: admin.username ?? 'fb110-admin', email: null, fullName: null };
  const [type] = await db.insert(s.containerTypes).values({
    code: `40HC${suffix.slice(-6)}`,
    name: `FB110 type ${suffix}`,
  }).returning();
  created.containerTypeIds.push(type.id);
  containerTypeId = type.id;
});

after(async () => {
  try {
    if (created.shipmentIds.length > 0) {
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, created.shipmentIds));
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, created.shipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, created.shipmentIds));
    }
    if (created.containerTypeIds.length > 0) {
      await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, created.containerTypeIds));
    }
    if (created.customerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, created.customerIds));
    }
    if (created.userIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, created.userIds));
    }
  } catch (err) {
    console.warn('[shipment-declaration-container] cleanup partial:', (err as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
});

describe('FB-110 — per-container tờ khai save across the decomposition owner', () => {
  test('R1: born-READY + add-container lot (partial-but-clean) heals and persists the tờ khai', async () => {
    const lot = await seedFclLot('r1');
    const born = await seedContainerRow(lot.id);

    // The real add-container path: decomposes ONLY the added row, leaving the
    // born container row-less — the exact partial-but-clean FB-110 shape.
    const added = await addCusShipmentContainer({
      shipmentId: lot.id,
      input: { containerNumber: nextContainerNumber(), expectedShipmentVersion: 1 },
      actor,
    });
    assert.equal(await versionOf(lot.id), 2, 'add-container advances the lot version once');

    const preHeal = await activeFulfillments(lot.id);
    assert.equal(preHeal.length, 1, 'pre-state: only the added container owns a fulfillment');
    assert.equal(preHeal[0].shipmentContainerId, added.line.id);

    // Before the fix this was the permanent 409 "Tác vụ thực hiện hiện có
    // không khớp danh sách container." on every save for the born container.
    const number = declTag('r1');
    const { line } = await updateCusShipmentContainerLine({
      shipmentId: lot.id,
      containerId: born.id,
      input: { expectedShipmentVersion: 2, declarationNumber: number },
      actor,
    });
    assert.equal(line.declarationNumber, number, 'the saved line echoes the tờ khai number');

    // DB persistence (the reload-survival half of FB-110).
    assert.equal(await declOf(born.id), number);
    assert.equal(await versionOf(lot.id), 3, 'the touched write advances the version once');

    // The heal: the born container's fulfillment was minted in the same tx,
    // restoring the full per-container set with the canonical insert shape.
    const healed = await activeFulfillments(lot.id);
    assert.equal(healed.length, 2, 'both containers now own an active fulfillment');
    const bornRow = healed.find((row) => row.shipmentContainerId === born.id);
    assert.ok(bornRow, 'the born container holds a fulfillment row');
    assert.equal(bornRow.fulfillmentType, 'FCL_CONTAINER');
    assert.equal(bornRow.cargoMode, 'FCL');
    assert.equal(bornRow.canceledAt, null);
  });

  test('R2: healthy lot — save, edit and clear (empty string → null) one container without touching its sibling', async () => {
    const lot = await seedFclLot('r2');
    const first = await seedContainerRow(lot.id);
    const second = await seedContainerRow(lot.id);
    await seedFulfillmentRow(lot.id, first.id);
    await seedFulfillmentRow(lot.id, second.id);

    const firstNumber = declTag('r2a');
    const secondNumber = declTag('r2b');
    await updateCusShipmentContainerLine({
      shipmentId: lot.id,
      containerId: first.id,
      input: { expectedShipmentVersion: 1, declarationNumber: firstNumber },
      actor,
    });
    assert.equal(await declOf(first.id), firstNumber);
    assert.equal(await declOf(second.id), null, 'an untouched sibling keeps its empty tờ khai');

    await updateCusShipmentContainerLine({
      shipmentId: lot.id,
      containerId: first.id,
      input: { expectedShipmentVersion: 2, declarationNumber: secondNumber },
      actor,
    });
    assert.equal(await declOf(first.id), secondNumber, 'editing replaces the number');

    await updateCusShipmentContainerLine({
      shipmentId: lot.id,
      containerId: first.id,
      input: { expectedShipmentVersion: 3, declarationNumber: '' },
      actor,
    });
    assert.equal(await declOf(first.id), null, 'an empty string clears the tờ khai to null');
    assert.equal(await declOf(second.id), null);
    assert.equal(await versionOf(lot.id), 4, 'each touched save advances the version once');

    const rows = await activeFulfillments(lot.id);
    assert.equal(rows.length, 2, 'a healthy set is never re-decomposed by a document edit');
  });

  test('R3: foreign shapes stay strict — a NULL-container row and a dangling-container row both keep the 409', async () => {
    // Shape 1: an active FCL fulfillment bound to no container at all.
    const nullRowLot = await seedFclLot('r3n');
    const nullRowContainer = await seedContainerRow(nullRowLot.id);
    await seedFulfillmentRow(nullRowLot.id, null);

    await expectApiError(
      updateCusShipmentContainerLine({
        shipmentId: nullRowLot.id,
        containerId: nullRowContainer.id,
        input: { expectedShipmentVersion: 1, declarationNumber: declTag('r3n') },
        actor,
      }),
      409,
      'Tác vụ thực hiện hiện có không khớp danh sách container.',
    );
    assert.equal(await declOf(nullRowContainer.id), null, 'no blind heal: the write fully rolled back');
    assert.equal(await versionOf(nullRowLot.id), 1);
    assert.equal((await activeFulfillments(nullRowLot.id)).length, 1, 'no fulfillment was minted');

    // Shape 2: an active fulfillment pointing at a container of ANOTHER lot.
    const donorLot = await seedFclLot('r3d');
    const donorContainer = await seedContainerRow(donorLot.id);
    const danglingLot = await seedFclLot('r3x');
    const danglingContainer = await seedContainerRow(danglingLot.id);
    await seedFulfillmentRow(danglingLot.id, donorContainer.id);

    await expectApiError(
      updateCusShipmentContainerLine({
        shipmentId: danglingLot.id,
        containerId: danglingContainer.id,
        input: { expectedShipmentVersion: 1, declarationNumber: declTag('r3x') },
        actor,
      }),
      409,
      'Tác vụ thực hiện hiện có không khớp danh sách container.',
    );
    assert.equal(await declOf(danglingContainer.id), null);
    assert.equal((await activeFulfillments(danglingLot.id)).length, 1, 'the dangling row survives untouched');
  });

  test('R4: a number owned by another lot is rejected (SHIPMENT_REFERENCE_DUPLICATE); a same-lot repeat stays legal', async () => {
    const ownerLot = await seedFclLot('r4o');
    const ownerFirst = await seedContainerRow(ownerLot.id);
    const ownerSecond = await seedContainerRow(ownerLot.id);
    await seedFulfillmentRow(ownerLot.id, ownerFirst.id);
    await seedFulfillmentRow(ownerLot.id, ownerSecond.id);

    const foreignLot = await seedFclLot('r4f');
    const foreignContainer = await seedContainerRow(foreignLot.id);
    await seedFulfillmentRow(foreignLot.id, foreignContainer.id);

    const shared = declTag('r4');
    await updateCusShipmentContainerLine({
      shipmentId: ownerLot.id,
      containerId: ownerFirst.id,
      input: { expectedShipmentVersion: 1, declarationNumber: shared },
      actor,
    });

    // Cross-lot: the guard fires with its dedicated code, write rolls back.
    await assert.rejects(
      updateCusShipmentContainerLine({
        shipmentId: foreignLot.id,
        containerId: foreignContainer.id,
        input: { expectedShipmentVersion: 1, declarationNumber: shared },
        actor,
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.message, 'Số tờ khai đã thuộc lô hàng khác. Vui lòng kiểm tra lại trước khi lưu.');
        assert.equal(error.details, 'SHIPMENT_REFERENCE_DUPLICATE');
        return true;
      },
    );
    assert.equal(await declOf(foreignContainer.id), null, 'the rejected number never lands');
    assert.equal(await versionOf(foreignLot.id), 1);

    // Same-lot repeat: legal by design — it is the copy affordance's whole point.
    await updateCusShipmentContainerLine({
      shipmentId: ownerLot.id,
      containerId: ownerSecond.id,
      input: { expectedShipmentVersion: 2, declarationNumber: shared },
      actor,
    });
    assert.equal(await declOf(ownerSecond.id), shared);
    assert.equal(await declOf(ownerFirst.id), shared);
  });
});

describe('FB-109 — copy tờ khai của một container sang các container còn trống', () => {
  test('R1: fan-out fills only empty containers, never overwrites a filled one, and advances the version once', async () => {
    const lot = await seedFclLot('c1');
    const source = await seedContainerRow(lot.id, { declarationNumber: declTag('c1src') });
    const emptyFirst = await seedContainerRow(lot.id);
    const emptySecond = await seedContainerRow(lot.id);
    const filled = await seedContainerRow(lot.id, { declarationNumber: declTag('c1fil') });
    for (const container of [source, emptyFirst, emptySecond, filled]) {
      await seedFulfillmentRow(lot.id, container.id);
    }

    const outcome = await copyCusShipmentContainerDeclaration({
      shipmentId: lot.id,
      containerId: source.id,
      input: { expectedShipmentVersion: 1 },
      actor,
    });
    assert.deepEqual(
      [...outcome.updatedContainerIds].sort((a, b) => a - b),
      [emptyFirst.id, emptySecond.id].sort((a, b) => a - b),
      'exactly the two empty siblings were written',
    );
    assert.equal(outcome.shipmentVersion, 2, 'the lot version advances exactly once');

    assert.equal(await declOf(emptyFirst.id), declTag('c1src'));
    assert.equal(await declOf(emptySecond.id), declTag('c1src'));
    assert.equal(await declOf(filled.id), declTag('c1fil'), 'a container that already had a number is never overwritten');
    assert.equal(await declOf(source.id), declTag('c1src'));

    // R2 (same lot, now fully numbered): the copy has nothing left to do.
    await expectApiError(
      copyCusShipmentContainerDeclaration({
        shipmentId: lot.id,
        containerId: source.id,
        input: { expectedShipmentVersion: 2 },
        actor,
      }),
      409,
      'Mọi container trong lô đã có số tờ khai.',
    );
    assert.equal(await versionOf(lot.id), 2, 'the rejected copy leaves the version untouched');
  });

  test('R3: the FE auto-copy chain on a healed lot — line-update then copy-declaration with the returned version', async () => {
    const lot = await seedFclLot('c3');
    const source = await seedContainerRow(lot.id);

    // Born-ready + two real add-container writes: only the ADDED rows own
    // fulfillments, so the lot starts in the FB-110 partial-but-clean shape.
    const firstAdded = await addCusShipmentContainer({
      shipmentId: lot.id,
      input: { containerNumber: nextContainerNumber(), expectedShipmentVersion: 1 },
      actor,
    });
    const secondAdded = await addCusShipmentContainer({
      shipmentId: lot.id,
      input: { containerNumber: nextContainerNumber(), expectedShipmentVersion: 2 },
      actor,
    });
    assert.equal((await activeFulfillments(lot.id)).length, 2);

    // Step 1 of the chain: save the source number (this is where FB-110's 409
    // used to kill the whole affordance) — the save heals the lot and returns
    // the fresh version the FE feeds straight into the copy call.
    const number = declTag('c3');
    const { line } = await updateCusShipmentContainerLine({
      shipmentId: lot.id,
      containerId: source.id,
      input: { expectedShipmentVersion: 3, declarationNumber: number },
      actor,
    });
    assert.equal(line.shipmentVersion, 4);
    assert.equal((await activeFulfillments(lot.id)).length, 3, 'the heal completed the per-container set');

    // Step 2: the copy fans the saved number out with that exact version.
    const outcome = await copyCusShipmentContainerDeclaration({
      shipmentId: lot.id,
      containerId: source.id,
      input: { expectedShipmentVersion: line.shipmentVersion },
      actor,
    });
    assert.deepEqual(
      [...outcome.updatedContainerIds].sort((a, b) => a - b),
      [firstAdded.line.id, secondAdded.line.id].sort((a, b) => a - b),
    );
    assert.equal(outcome.shipmentVersion, 5);

    for (const container of [source, firstAdded.line, secondAdded.line]) {
      assert.equal(await declOf(container.id), number, `container ${container.id} carries the copied number`);
    }
  });
});

describe('FB-110 guard — the LCL strict law is unchanged by the heal', () => {
  test('a malformed LCL fulfillment set still throws under ensureShipmentFulfillmentsInTx', async () => {
    const [customer] = await db.insert(s.customers).values({ name: `FB110 lcl ${suffix}` }).returning();
    created.customerIds.push(customer.id);
    const [lclLot] = await db.insert(s.shipments).values({
      customerId: customer.id,
      blNumber: `FB110-LCL-${suffix}`.slice(0, 50),
      tradeDirection: 'IMPORT',
      cargoMode: 'LCL',
      status: 'READY_FOR_DISPATCH',
      expectedDeliveryDate: '2026-10-20',
      version: 1,
      createdBy: adminId,
    }).returning();
    created.shipmentIds.push(lclLot.id);

    // Malformed: the lot's canonical LCL row plus a foreign FCL-shaped row
    // squatting on it. (A second LCL_SHIPMENT row is not even seedable —
    // shipment_fulfillments_active_lcl_uniq_idx backstops that at storage —
    // so the reachable malformation is the mixed-shape set below, which the
    // strict law must still refuse instead of healing.)
    await db.insert(s.shipmentFulfillments).values([
      {
        shipmentId: lclLot.id,
        shipmentContainerId: null,
        fulfillmentType: 'LCL_SHIPMENT',
        cargoMode: 'LCL',
        dispatchClassification: 'LCL',
        sourceShipmentVersion: 1,
        siteSnapshot: {},
        createdBy: adminId,
      },
      {
        shipmentId: lclLot.id,
        shipmentContainerId: null,
        fulfillmentType: 'FCL_CONTAINER',
        cargoMode: 'FCL',
        sourceShipmentVersion: 1,
        siteSnapshot: {},
        createdBy: adminId,
      },
    ]);

    await assert.rejects(
      db.transaction((tx) => ensureShipmentFulfillmentsInTx(tx, {
        shipmentId: lclLot.id,
        actorId: adminId,
        allowClerkIntake: true,
      })),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.message, 'Lô hàng lẻ phải có đúng một tác vụ thực hiện.');
        return true;
      },
    );
    assert.equal((await activeFulfillments(lclLot.id)).length, 2, 'the malformed set is left exactly as it was');
  });
});
