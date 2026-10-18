/**
 * Card 171026154000 — master-plan Loại hàng scope + row projection.
 *
 * Single source of truth lock: the Sản lượng chip's "Lẻ: N lô" counts lots
 * with an ACTIVE LCL_SHIPMENT fulfillment (computeDispatchSummaryForSet); the
 * list projection must carry that same fact per row (`hasActiveLclShipment`)
 * and the `cargoMode` scope param must filter on that same predicate — never
 * on `shipments.cargo_mode` alone — so the pick, the chip and the CHỌN LÔ
 * checkbox can never disagree on a real payload. Regression shape: an LCL lot
 * whose only fulfillment is canceled (cargoMode='LCL', no active fulfillment)
 * is NOT counted by the chip and must NOT surface under the Hàng lẻ pick;
 * a legacy NULL-cargo_mode lot is a cont lot for both.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { listShipmentsPaginated } from '../services/shipment.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];

describe('shipment list — Loại hàng scope + hasActiveLclShipment projection (card 171026154000)', () => {
  after(async () => {
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  });

  test('projects the chip predicate per row and scopes both picks on it', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `171026154000 customer ${suffix}` })
      .returning();
    createdCustomerIds.push(customer.id);

    const [liveLcl, staleLcl, fclLot, legacyLot] = await db.insert(s.shipments).values([
      {
        customerId: customer.id,
        blNumber: `SCOPE-A-${suffix.slice(-8)}`,
        tradeDirection: 'IMPORT',
        cargoMode: 'LCL',
        status: 'READY_FOR_DISPATCH',
        expectedDeliveryDate: '2026-10-20',
      },
      {
        // cargoMode says LCL but the consolidation demand is gone (canceled
        // fulfillment): the chip must not count it, the Hàng lẻ pick must not
        // return it — otherwise the checkbox would offer a lot the carrier
        // write cannot reach (the fulfillment IS the carrier channel).
        customerId: customer.id,
        blNumber: `SCOPE-B-${suffix.slice(-8)}`,
        tradeDirection: 'IMPORT',
        cargoMode: 'LCL',
        status: 'READY_FOR_DISPATCH',
        expectedDeliveryDate: '2026-10-21',
      },
      {
        customerId: customer.id,
        blNumber: `SCOPE-C-${suffix.slice(-8)}`,
        tradeDirection: 'IMPORT',
        cargoMode: 'FCL',
        status: 'READY_FOR_DISPATCH',
        expectedDeliveryDate: '2026-10-22',
      },
      {
        // Legacy lot predating the cargo_mode column: a cont lot for both the
        // chip and the scope.
        customerId: customer.id,
        blNumber: `SCOPE-D-${suffix.slice(-8)}`,
        tradeDirection: 'IMPORT',
        cargoMode: null,
        status: 'READY_FOR_DISPATCH',
        expectedDeliveryDate: '2026-10-23',
      },
    ]).returning();
    createdShipmentIds.push(liveLcl.id, staleLcl.id, fclLot.id, legacyLot.id);

    await db.insert(s.shipmentFulfillments).values([
      {
        shipmentId: liveLcl.id,
        fulfillmentType: 'LCL_SHIPMENT',
        dispatchClassification: 'LCL',
        cargoMode: 'LCL',
        sourceShipmentVersion: liveLcl.version,
      },
      {
        shipmentId: staleLcl.id,
        fulfillmentType: 'LCL_SHIPMENT',
        dispatchClassification: 'LCL',
        cargoMode: 'LCL',
        sourceShipmentVersion: staleLcl.version,
        canceledAt: new Date(),
        cancellationReason: 'Điều chỉnh số liệu',
      },
    ]);

    const expectedActive = new Set([liveLcl.id]);

    // Both list query variants must agree — the plain page query and the
    // transaction variant includeDispatchSummary uses.
    for (const extra of [{}, { includeDispatchSummary: true as const }]) {
      const unscoped = await listShipmentsPaginated({ customerId: customer.id, page: 1, limit: 20, ...extra });
      const flagged = unscoped.items.filter((row) => row.hasActiveLclShipment === true).map((row) => row.id);
      assert.deepEqual(
        [...flagged].sort(),
        [...expectedActive].sort(),
        `projection matches the chip predicate (includeDispatchSummary=${'includeDispatchSummary' in extra})`,
      );
      for (const id of [staleLcl.id, fclLot.id, legacyLot.id]) {
        assert.equal(
          unscoped.items.find((row) => row.id === id)?.hasActiveLclShipment,
          false,
          `non-LCL-fulfillment lot ${id} projects false`,
        );
      }
      // The chip counts exactly the rows the checkbox gate renders.
      if ('includeDispatchSummary' in extra) {
        assert.equal(unscoped.dispatchSummary?.lclFulfillments, expectedActive.size);
      }
    }

    // Hàng lẻ pick: exactly the active-LCL-fulfillment lots — page 1, no
    // pagination digging.
    const lclScope = await listShipmentsPaginated({ customerId: customer.id, page: 1, limit: 20, cargoMode: 'LCL' });
    assert.deepEqual(
      lclScope.items.map((row) => row.id).sort(),
      [...expectedActive].sort(),
    );
    // Every returned row gets a checkbox fact (the grid gate reads it).
    assert.ok(lclScope.items.every((row) => row.hasActiveLclShipment === true));

    // Cont pick: the exact complement — stale LCL, FCL and legacy lots, and
    // never the checkbox rows.
    const fclScope = await listShipmentsPaginated({ customerId: customer.id, page: 1, limit: 20, cargoMode: 'FCL' });
    const fclIds = fclScope.items.map((row) => row.id).sort((a, b) => a - b);
    assert.deepEqual(fclIds, [staleLcl.id, fclLot.id, legacyLot.id].sort((a, b) => a - b));
    assert.ok(fclScope.items.every((row) => row.hasActiveLclShipment === false));

    // The chip scoped to the Hàng lẻ pick counts the same rows the pick
    // returned — header and view can never drift.
    const lclScopedSummary = await listShipmentsPaginated({
      customerId: customer.id, page: 1, limit: 20, cargoMode: 'LCL', includeDispatchSummary: true,
    });
    assert.equal(lclScopedSummary.dispatchSummary?.lclFulfillments, lclScope.items.length);
  });

  test('a canceled fulfillment never resurrects the flag after later updates', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `171026154000 cancel customer ${suffix}` })
      .returning();
    createdCustomerIds.push(customer.id);
    const [lot] = await db.insert(s.shipments).values({
      customerId: customer.id,
      blNumber: `SCOPE-E-${suffix.slice(-8)}`,
      tradeDirection: 'IMPORT',
      cargoMode: 'LCL',
      status: 'READY_FOR_DISPATCH',
      expectedDeliveryDate: '2026-10-24',
    }).returning();
    createdShipmentIds.push(lot.id);
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: lot.id,
      fulfillmentType: 'LCL_SHIPMENT',
      dispatchClassification: 'LCL',
      cargoMode: 'LCL',
      sourceShipmentVersion: lot.version,
    }).returning();

    const before = await listShipmentsPaginated({ customerId: customer.id, page: 1, limit: 20, cargoMode: 'LCL' });
    assert.equal(before.items.find((row) => row.id === lot.id)?.hasActiveLclShipment, true);

    await db.update(s.shipmentFulfillments)
      .set({ canceledAt: new Date(), cancellationReason: 'Hủy điều xe' })
      .where(eq(s.shipmentFulfillments.id, fulfillment.id));

    const afterCancel = await listShipmentsPaginated({ customerId: customer.id, page: 1, limit: 20, cargoMode: 'LCL' });
    assert.equal(afterCancel.items.find((row) => row.id === lot.id), undefined);
    assert.equal(afterCancel.total, 0);
  });
});
