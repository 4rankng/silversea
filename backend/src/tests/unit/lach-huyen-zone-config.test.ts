// K2.121 — the Lạch Huyện surcharge auto-calculates from the
// `port_zone_surcharges` config (500.000₫/đầu for Hateco), so a lot that
// lifts/drops at a fee-configured port carries the fee without anyone
// declaring an Ops ZONE_SURCHARGE override.
//
// The boards read this batch as the CONFIG rung of the zone ladder (the Ops
// override still wins), so what matters is that the batch answers PER LOT
// and counts each container's lift/drop end at a configured port once.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Executor } from '../../db';
import { resolveLotPortZoneConfigBatch } from '../../services/zone-surcharge.service';

/** A stub executor that answers each select() with the next queued rows. */
function stubExecutor(responses: Array<Array<Record<string, unknown>>>) {
  let call = 0;
  const executor = {
    select: () => {
      const rows = responses[call++] ?? [];
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        limit: () => chain,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(rows)),
      };
      return chain;
    },
  };
  return executor as unknown as Executor;
}

describe('K2.121 — the port-config zone surcharge batch', () => {
  test('counts one fee per configured lift/drop end of every container', async () => {
    // Lot 5 drops one container at Hateco (port 10, 500.000₫) → one lift.
    // Lot 6 lifts one container at Hateco AND drops another there → two lifts.
    const executor = stubExecutor([
      [
        { shipmentId: 5, pickupPortId: 2, dropoffPortId: 10 },
        { shipmentId: 6, pickupPortId: 10, dropoffPortId: 10 },
      ],
      [{ portId: 10, amount: '500000' }],
    ]);

    const byLot = await resolveLotPortZoneConfigBatch([5, 6], executor);

    assert.equal(byLot.get(5), 500000);
    assert.equal(byLot.get(6), 1000000);
  });

  test('a lot whose ports carry no fee config stays unknown (never a fabricated 0)', async () => {
    const executor = stubExecutor([
      [{ shipmentId: 5, pickupPortId: 2, dropoffPortId: 3 }],
      [{ portId: 10, amount: '500000' }],
    ]);

    const byLot = await resolveLotPortZoneConfigBatch([5], executor);

    assert.equal(byLot.has(5), false);
  });

  test('a lot without containers never reaches the config read', async () => {
    const executor = stubExecutor([[]]);

    const byLot = await resolveLotPortZoneConfigBatch([5], executor);

    assert.equal(byLot.size, 0);
  });
});
