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
  resolveCarrierPaymentTermWarnings,
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

  // SIL-1082 K2.45 round 3 (QA comment 8974): the generic sentence FAILED —
  // the reason must call the deleted records by name, not "#id" or "nhà xe
  // chưa có...". QA deleted BOTH ends (NCC 54 + carrier KH 74), so the close
  // names the recovered supplier tombstone AND the tombstoned carrier row.
  test('a recovered supplier tombstone names the deleted record; a tombstoned carrier names itself', () => {
    const warning = carrierPaymentTermWarning({
      carrierExists: true,
      carrierId: 74,
      carrierName: 'QA45-NT04',
      carrierDeleted: true,
      linkedSupplierId: null,
      isCarrier: true,
      linkedSupplierExists: null,
      deletedLinkedSuppliers: [{ id: 54, name: 'QA45-NT04' }],
    });
    assert.match(warning!, /hạn thanh toán/);
    assert.match(warning!, /nhà cung cấp liên kết đã bị xóa \("QA45-NT04" \(#54\)\)/);
    assert.match(warning!, /hồ sơ nhà xe "QA45-NT04" \(#74\) cũng đã bị xóa/);
  });

  test('a named but still-linked supplier keeps the reason silent only while the link resolves', () => {
    // An intact link with a live supplier never warns, even with names present.
    assert.equal(carrierPaymentTermWarning({
      carrierExists: true, carrierId: 74, carrierName: 'QA45-NT04', carrierDeleted: false,
      linkedSupplierId: 54, isCarrier: true, linkedSupplierExists: true,
      linkedSupplierName: 'QA45-NT04', deletedLinkedSuppliers: [],
    }), null);
    // A dangling link with the tombstone row still readable names it verbatim.
    const warning = carrierPaymentTermWarning({
      carrierExists: true,
      linkedSupplierId: 54,
      isCarrier: true,
      linkedSupplierExists: false,
      linkedSupplierName: 'HATECO',
    });
    assert.match(warning!, /nhà cung cấp liên kết "HATECO" \(#54\) không còn tồn tại/);
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

  test('an external trip over tombstoned carrier + supplier names BOTH records (the QA45 shape)', async () => {
    const executor = stubExecutor([
      [externalTrip],
      [{
        id: 74,
        name: 'QA45-NT04',
        deletedAt: new Date('2026-11-27T00:00:00Z'),
        linkedSupplierId: null,
        isCarrier: true,
      }],
      [{ id: 54, name: 'QA45-NT04' }],
    ]);
    const warning = await resolveTripCarrierPaymentTermWarning(executor, 5);
    assert.ok(warning, 'the close must explain the missing payment deadline');
    assert.match(warning, /"QA45-NT04" \(#54\)/);
    assert.match(warning, /hồ sơ nhà xe "QA45-NT04" \(#74\)/);
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

describe('K2.45 — the list read resolves the reason for a page of carriers in one pass', () => {
  /** Same queued-rows stub as the close above: the batch makes one carriers
   *  select, one live-suppliers select only when some carrier actually links
   *  a supplier, and one tombstone-recovery select only when an unlinked
   *  nhà xe mirror is on the page. */
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

  test('names the dangling link, stays silent for healthy and unlinked carriers', async () => {
    const executor = stubExecutor([
      [
        { id: 7, linkedSupplierId: 42, isCarrier: true },
        { id: 8, linkedSupplierId: 43, isCarrier: true },
        { id: 9, linkedSupplierId: null, isCarrier: true },
      ],
      [
        { id: 42, deletedAt: null },
        { id: 43, deletedAt: new Date('2026-11-01T00:00:00Z') },
      ],
    ]);
    const warnings = await resolveCarrierPaymentTermWarnings(executor, [7, 8, 9]);
    assert.equal(warnings.get(7), null, 'a live link never warns');
    assert.match(warnings.get(8) ?? '', /#43/, 'a soft-deleted supplier names the missing record');
    assert.match(warnings.get(9) ?? '', /nhà cung cấp liên kết/, 'an unlinked nhà xe warns');
  });

  test('an empty id list pays for no query at all', async () => {
    const executor = stubExecutor([]);
    const warnings = await resolveCarrierPaymentTermWarnings(executor, []);
    assert.equal(warnings.size, 0);
  });

  test('an unlinked carrier that is not a nhà xe mirror raises nothing', async () => {
    const executor = stubExecutor([
      [{ id: 9, linkedSupplierId: null, isCarrier: false }],
    ]);
    const warnings = await resolveCarrierPaymentTermWarnings(executor, [9]);
    assert.equal(warnings.get(9), null);
  });

  test('an unlinked carrier recovers the deleted supplier name through the tombstone back-pointer', async () => {
    // No live linked suppliers (no names query — skipped when no carrier
    // links), but supplier #54 still points back at carrier #9 through
    // linked_customer_id — the trace the supplier-delete hook leaves, and
    // the only place the name survives.
    const executor = stubExecutor([
      [{ id: 9, name: 'QA45-NT03', deletedAt: null, linkedSupplierId: null, isCarrier: true }],
      [{ id: 54, name: 'QA45-NT03', linkedCustomerId: 9 }],
    ]);
    const warnings = await resolveCarrierPaymentTermWarnings(executor, [9]);
    assert.match(warnings.get(9) ?? '', /"QA45-NT03" \(#54\)/);
  });
});
