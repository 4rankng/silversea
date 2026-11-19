// Ticket 18/11 Task 2.4 (SIL-855) — Debit Note ↔ đợt chốt laws, pinned db-free:
// - a Debit Note (công nợ phải thu) attaches ONLY a THU round of the same
//   customer (the pure assert shared by the chốt service and the issuance);
// - Chọn Debit NEVER creates công nợ: the settlement-round creator writes
//   only the round + its lots — no billing_documents row until the preview's
//   [Lưu] (source-scan, the same wiring-pin style as debit-note-live-bks);
// - the round preview computes on the SAME frozen basis as the issuance
//   (buildFrozenShipmentDebitLines + documentVatTotals) and the POST carries
//   the đợt through the wire (settlementRoundId) into billing_documents.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRoundAttachableToDebitNote } from '../../services/debit-settlement-shared';

const here = dirname(fileURLToPath(import.meta.url));
const roundsSource = readFileSync(join(here, '../../services/debit-settlement-rounds.service.ts'), 'utf8');
const costLockSource = readFileSync(join(here, '../../services/shipment-cost-lock.service.ts'), 'utf8');
const coreRoutesSource = readFileSync(join(here, '../../routes/shipments/core.routes.ts'), 'utf8');

const THU_ROUND = { customerId: 11, direction: 'THU', roundNo: 1, periodKey: '2026-11' };
const TRA_ROUND = { customerId: 11, direction: 'TRA', roundNo: 1, periodKey: '2026-11' };

describe('assertRoundAttachableToDebitNote — SIL-855 attach law', () => {
  test('THU round of the same customer attaches cleanly', () => {
    assert.doesNotThrow(() => assertRoundAttachableToDebitNote(THU_ROUND, 11));
  });

  test('TRA round refuses with the phải-trả reason (never posts công nợ phải thu)', () => {
    assert.throws(
      () => assertRoundAttachableToDebitNote(TRA_ROUND, 11),
      (error: { status?: number; message?: string }) => {
        assert.equal(error.status, 400);
        assert.match(error.message ?? '', /chiều TRA/);
        assert.match(error.message ?? '', /không phát sinh công nợ phải thu/);
        return true;
      },
    );
  });

  test("another customer's round refuses (409)", () => {
    assert.throws(
      () => assertRoundAttachableToDebitNote(THU_ROUND, 22),
      (error: { status?: number; message?: string }) => {
        assert.equal(error.status, 409);
        assert.match(error.message ?? '', /không cùng khách hàng/);
        return true;
      },
    );
  });
});

describe('SIL-855 wiring — Chọn Debit never creates công nợ; [Lưu] names the đợt', () => {
  test('createDebitSettlementRound writes only the round + lots, no billing_documents', () => {
    const start = roundsSource.indexOf('export async function createDebitSettlementRound');
    const end = roundsSource.indexOf('export async function listDebitSettlementRounds');
    assert.ok(start > 0 && end > start, 'function anchors found');
    const body = roundsSource.slice(start, end);
    assert.match(body, /debitSettlementRounds\)\.values\(/, 'inserts the round');
    assert.match(body, /debitSettlementRoundLots\)\.values\(/, 'inserts the round lots');
    assert.doesNotMatch(body, /billingDocuments|billing_documents/, 'no billing documents row at Chọn Debit');
  });

  test('the round preview computes on the SAME frozen basis as the issuance', () => {
    assert.match(roundsSource, /buildFrozenShipmentDebitLines\(/, 'preview uses the frozen-line builder');
    assert.match(roundsSource, /documentVatTotals\(/, 'preview uses the issuance VAT totals');
    assert.match(roundsSource, /effectiveBillingPlate\(/, 'preview stamps the issued-line plate law');
  });

  test('[Lưu] carries settlementRoundId through the wire into billing_documents', () => {
    assert.match(coreRoutesSource, /settlementRoundId: z\.number\(\)\.int\(\)\.positive\(\)\.nullish\(\)/, 'route accepts the đợt');
    assert.match(costLockSource, /settlementRoundId,\n/, 'issuance stores the đợt on billing_documents');
    assert.match(costLockSource, /assertRoundAttachableToDebitNote\(round, customerId\)/, 'issuance runs the attach law');
  });
});
