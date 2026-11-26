// SIL-1101 (K2.119) — a Số hóa đơn is a hard identity key across the WHOLE
// expense ledger. The QA repro entered invoice QA-R2F2-119 for lô 547 then
// lô 548 → two trip-cost rows (59, 60); re-entering the SAME number on the
// SAME lô 547 + same trip 150 still minted a third row (62). Both lanes of
// expense-accounting-create (trip-scoped + shipment-level) had no check at
// all, and the Ops per-lô gate only looked inside ONE lô.
// Pinned at the unit boundary (BE unit-only law, no db boot): the pick law
// and the message law run headlessly below; source-wiring scans pin all
// three creation writers onto the shared guard, ordered before their first
// row insert.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickInvoiceNumberConflict,
  invoiceNumberConflictMessage,
} from '../../services/invoice-number-conflict.service';

const here = dirname(fileURLToPath(import.meta.url));

/** Test seam: the source slice between two anchors (sil657 convention). */
const sliceBetween = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing anchor: ${start}`);
  const to = source.indexOf(end, from);
  assert.ok(to > from, `missing end anchor: ${end}`);
  return source.slice(from, to);
};

const candidate = (over: Partial<Parameters<typeof pickInvoiceNumberConflict>[0][number]> = {}) => ({
  invoiceNumber: 'QA-R2F2-119' as string | null,
  shipmentId: 547 as number | null,
  shipmentCode: 'LOT-547' as string | null,
  tripId: 150 as number | null,
  tripCode: 'TC-150' as string | null,
  ...over,
});

describe('pickInvoiceNumberConflict — the ledger-wide identity pick (SIL-1101)', () => {
  test('the QA repro branch: the same number on ANOTHER lot/trip is a conflict', () => {
    const hit = pickInvoiceNumberConflict(
      [candidate({ shipmentId: 548, shipmentCode: 'LOT-548' })],
      'QA-R2F2-119',
    );
    assert.ok(hit);
    assert.equal(hit.shipmentId, 548);
    assert.equal(hit.shipmentCode, 'LOT-548');
    assert.equal(hit.invoiceNumber, 'QA-R2F2-119');
  });

  test('same lot + same trip re-entry is also a duplicate', () => {
    const hit = pickInvoiceNumberConflict([candidate()], 'QA-R2F2-119');
    assert.ok(hit);
    assert.equal(hit.shipmentId, 547);
    assert.equal(hit.tripId, 150);
  });

  test('the fold matches case/space variants of the stored number', () => {
    const hit = pickInvoiceNumberConflict([candidate({ invoiceNumber: ' qa-r2f2-119 ' })], 'QA-R2F2-119');
    assert.ok(hit);
    assert.equal(hit.shipmentCode, 'LOT-547');
  });

  test('a different number is no conflict; an empty entry never looks', () => {
    assert.equal(pickInvoiceNumberConflict([candidate({ invoiceNumber: 'QA-R2F2-120' })], 'QA-R2F2-119'), null);
    assert.equal(pickInvoiceNumberConflict([candidate()], ''), null);
    assert.equal(pickInvoiceNumberConflict([], 'QA-R2F2-119'), null);
  });

  test('first matching candidate wins (callers pass stores in id order)', () => {
    const hit = pickInvoiceNumberConflict(
      [candidate({ shipmentCode: 'LOT-547' }), candidate({ shipmentCode: 'LOT-548', tripCode: null })],
      'QA-R2F2-119',
    );
    assert.ok(hit);
    assert.equal(hit.shipmentCode, 'LOT-547');
  });
});

describe('invoiceNumberConflictMessage — the 400 names the number and its owner', () => {
  test('names lot and trip like the QA harm', () => {
    assert.equal(
      invoiceNumberConflictMessage({
        invoiceNumber: 'QA-R2F2-119', shipmentId: 548, shipmentCode: 'LOT-548', tripId: 151, tripCode: 'TC-151',
      }),
      'Số hóa đơn QA-R2F2-119 đã tồn tại trên lô LOT-548, chuyến TC-151.',
    );
  });

  test('lot-only and trip-only owners keep one clause each', () => {
    assert.equal(
      invoiceNumberConflictMessage({
        invoiceNumber: 'TD-1', shipmentId: 9, shipmentCode: 'LOT-9', tripId: null, tripCode: null,
      }),
      'Số hóa đơn TD-1 đã tồn tại trên lô LOT-9.',
    );
    assert.equal(
      invoiceNumberConflictMessage({
        invoiceNumber: 'TD-1', shipmentId: null, shipmentCode: null, tripId: 3, tripCode: 'TC-3',
      }),
      'Số hóa đơn TD-1 đã tồn tại trên chuyến TC-3.',
    );
  });

  test('no resolvable owner still refuses with the document named', () => {
    assert.equal(
      invoiceNumberConflictMessage({
        invoiceNumber: 'TD-1', shipmentId: null, shipmentCode: null, tripId: null, tripCode: null,
      }),
      'Số hóa đơn TD-1 đã tồn tại trong hệ thống.',
    );
  });
});

describe('source wiring — every creation writer sits on the shared guard', () => {
  const read = (rel: string) => readFileSync(join(here, '..', '..', 'services', rel), 'utf8');

  test('createAccountingExpense guards BOTH lanes before any row insert', () => {
    const source = read('expense-accounting-create.service.ts');
    const tripLane = sliceBetween(
      source,
      "throw new ApiError(409, 'Chọn chuyến đang hoạt động và thuộc lô hàng.');",
      'tx.insert(s.driverIncidentalCosts)',
    );
    assert.match(tripLane, /assertInvoiceNumberAvailable\(tx, invoiceNumber\)/, 'trip lane must guard before the driver insert');
    const shipmentLane = sliceBetween(
      source,
      'Same lot included: one invoice number is one document, once.',
      'tx.insert(s.opsExpenseEntries).values({ shipmentId: input.shipmentId, shipmentContainerId: null,',
    );
    assert.match(shipmentLane, /assertInvoiceNumberAvailable\(tx, invoiceNumber\)/, 'shipment-level lane must guard before the ops insert');
  });

  test('createOpsExpense keeps the per-lô 409 AND adds the ledger-wide 400', () => {
    const source = read('ops-expenses.service.ts');
    const gate = sliceBetween(source, 'const invoiceHit = await findLiveDuplicateOpsInvoiceNumber', 'const duplicateGate');
    assert.match(gate, /OPS_EXPENSE_INVOICE_DUPLICATE/, 'the pinned per-lô 409 stays');
    assert.match(gate, /assertInvoiceNumberAvailable\(\s*executor,\s*invoiceNumber,\s*\{\s*excludeShipmentId: input\.shipmentId\s*\}\s*\)/, 'cross-lot guard runs with the own-lot exclusion');
  });

  test('invoice-tracking create guards BEFORE the row insert; update excludes its own row', () => {
    const source = read('invoice-tracking.service.ts');
    const createLane = sliceBetween(source, 'if (trip.shipmentId !== input.shipmentId)', 'tx.insert(s.invoiceTracking)');
    assert.match(createLane, /assertInvoiceNumberAvailable\(tx, input\.invoiceNumber\)/);
    const updateLane = sliceBetween(source, 'SIL-1101 — the edit lane obeys the same law', 'const [updated] = await tx.update(s.invoiceTracking)');
    assert.match(updateLane, /excludeInvoiceTrackingId: existing\.id/);
    assert.match(updateLane, /excludeTripExpenseId: existing\.expenseId \?\? undefined/);
  });
});
