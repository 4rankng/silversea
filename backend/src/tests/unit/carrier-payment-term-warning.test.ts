// K2.45 — the carrier's payment deadline ("hạn thanh toán") is stamped from
// the carrier customer's linked supplier ("Nhà cung cấp liên kết"). Deleting
// that supplier record clears the link, so the deadline stops resolving. The
// close must SURVIVE it (FB-018 / ac13e8b4 — the posting never fails), but
// the reason has to be visible, not silent.
//
// These pins cover the reason law: a broken link names itself, a healthy link
// (even one whose supplier simply set no term) says nothing.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Executor } from '../../db';
import {
  carrierPaymentTermWarning,
  resolveTripCarrierPaymentTermWarning,
} from '../../services/carrier-payment-term.service';

describe('K2.45 — carrier payment term reason', () => {
  test('a carrier whose linked supplier still exists raises nothing (an unset term is the supplier\'s choice)', () => {
    assert.equal(carrierPaymentTermWarning({
      carrierExists: true,
      linkedSupplierId: 42,
      isCarrier: true,
      linkedSupplierExists: true,
    }), null);
  });

  test('a link pointing at a deleted supplier names the missing record', () => {
    const warning = carrierPaymentTermWarning({
      carrierExists: true,
      linkedSupplierId: 42,
      isCarrier: true,
      linkedSupplierExists: false,
    });
    assert.ok(warning, 'a dangling link must raise a reason');
    assert.match(warning, /#42/);
    assert.match(warning, /hạn thanh toán/);
  });

  test('a carrier with no linked supplier at all — the shape a supplier delete leaves — raises a reason', () => {
    const warning = carrierPaymentTermWarning({
      carrierExists: true,
      linkedSupplierId: null,
      isCarrier: true,
      linkedSupplierExists: null,
    });
    assert.ok(warning, 'an unlinked carrier must raise a reason');
    assert.match(warning, /hạn thanh toán/);
    assert.match(warning, /nhà cung cấp liên kết/);
  });

  test('a row that is not a carrier and links nobody raises nothing', () => {
    assert.equal(carrierPaymentTermWarning({
      carrierExists: true,
      linkedSupplierId: null,
      isCarrier: false,
      linkedSupplierExists: null,
    }), null);
    assert.equal(carrierPaymentTermWarning({
      carrierExists: false,
      linkedSupplierId: null,
      isCarrier: true,
      linkedSupplierExists: null,
    }), null);
  });
});

describe('K2.45 — the close resolves the reason from the trip\'s carrier', () => {
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

  const externalTrip = {
    carrierType: 'EXTERNAL',
    externalEntityId: 7,
    externalEntityType: 'CUSTOMER',
  };

  test('an external trip whose carrier lost its linked supplier raises the reason', async () => {
    const executor = stubExecutor([
      [externalTrip],
      [{ linkedSupplierId: null, isCarrier: true }],
    ]);
    const warning = await resolveTripCarrierPaymentTermWarning(executor, 5);
    assert.ok(warning, 'the close must explain the missing payment deadline');
    assert.match(warning, /hạn thanh toán/);
  });

  test('an external trip whose carrier still has its supplier raises nothing', async () => {
    const executor = stubExecutor([
      [externalTrip],
      [{ linkedSupplierId: 42, isCarrier: true }],
      [{ deletedAt: null }],
    ]);
    assert.equal(await resolveTripCarrierPaymentTermWarning(executor, 5), null);
  });

  test('an own-fleet trip raises nothing — it carries no carrier payable', async () => {
    const executor = stubExecutor([
      [{ carrierType: 'OWN', externalEntityId: null, externalEntityType: null }],
    ]);
    assert.equal(await resolveTripCarrierPaymentTermWarning(executor, 5), null);
  });
});
