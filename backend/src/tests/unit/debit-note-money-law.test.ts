// SIL-855 QA fail 23/11 (build 6bcc081e) — the MONEY LAW of a đợt-scoped
// Debit Note. Round 5 recorded 7.904.000 + VAT 8% 632.320 = 8.536.320 ₫, but
// the preview showed R3P-677-C = 0 ₫ and [Lưu] posted 4.268.160 ₫ — HALF the
// money never reached Công nợ. Root cause chain, pinned at every layer:
// 1. R3P-677-C's cước existed ONLY as the accountant's SIL-805 inline
//    override (bảng giá thiếu tuyến/loại xe → pricing projection
//    MISSING_AUTHORITY). Every board cell merges that override
//    (applyDebitRateOverridesToCells) and the đợt sum bills the merged cell,
//    but buildCostSnapshot froze the raw pricing channel only →
//    freightAuto/receivableTotal null in the lock snapshot.
// 2. buildFrozenShipmentDebitLines emitted NO lines for the moneyless
//    snapshot: the SIL-693 unpriced guard only fired on basis SKIP, while a
//    đủ-căn-cứ LOCK verdict with a bảng-giá miss (and no override) slid
//    through silently.
// 3. Nothing compared the note's frozen-line totals against the round
//    record — preview ≡ issuance (both half) but ≢ đợt.
// Pinned here: the freeze override law (wiring), the builder's LOCK-miss 409
// (SKIP/AD_HOC/legacy/known-zero laws byte-identically unchanged), the round
// reconcile in BOTH the preview and the [Lưu] issuance, and the repair lever
// (governed CANCEL releases claims → the same selection re-issues).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFrozenShipmentDebitLines,
} from '../../services/shipment-cost-lock-lines';
import { assertRoundIssuanceTotals } from '../../services/debit-settlement-shared';

const here = dirname(fileURLToPath(import.meta.url));
const roundsSource = readFileSync(join(here, '../../services/debit-settlement-rounds.service.ts'), 'utf8');
const costLockSource = readFileSync(join(here, '../../services/shipment-cost-lock.service.ts'), 'utf8');
const summarySource = readFileSync(join(here, '../../services/shipment-debit-summary.service.ts'), 'utf8');
const routesSource = readFileSync(join(here, '../../routes/financial/billing-documents.routes.ts'), 'utf8');

// ─── layer 2: the builder refuses a LOCK-miss freeze instead of billing 0 ₫ ─

describe('buildFrozenShipmentDebitLines — LOCK-miss unpriced freight (R3P-677-C shape)', () => {
  const qaSnapshot: Record<string, unknown> = {
    freightAuto: null,
    receivableTotal: null,
    chiHoTotal: null,
    freightPricingBasis: { action: 'LOCK', rateKey: 'CONT40.HEAVY', transportDate: '2027-04-20' },
  };

  test('basis LOCK + freightAuto null → 409 với remedy (nhập cước / bổ sung bảng giá + khóa lại), không note rỗng', () => {
    assert.throws(
      () => buildFrozenShipmentDebitLines(qaSnapshot, 'R3P-677-C'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        const message = 'message' in error ? String(error.message) : '';
        assert.match(message, /R3P-677-C/);
        assert.match(message, /chưa xác định trong bản khóa lô/);
        assert.match(message, /Kiểm soát lô hàng/);
        assert.match(message, /khóa lại/);
        return true;
      },
    );
  });

  test('known 0 vẫn là một giá trị — freightAuto 0 + receivable 0 + basis LOCK giữ luật D02 (note rỗng, không chặn)', () => {
    const zeroKnown: Record<string, unknown> = {
      freightAuto: 0,
      receivableTotal: 0,
      chiHoTotal: 0,
      freightPricingBasis: { action: 'LOCK', rateKey: '5T' },
    };
    assert.equal(buildFrozenShipmentDebitLines(zeroKnown, 'R4B-ZERO-01').length, 0);
  });
});

// ─── layer 3: the money law — note totals ≡ đợt record, cả preview lẫn [Lưu] ─

describe('assertRoundIssuanceTotals — tổng Debit Note ≡ tổng đợt chốt (QA round 5)', () => {
  // The đợt as [Chốt đợt] recorded it: 2 lô × 3.952.000 @ VAT 8%.
  const round5 = { id: 5, roundNo: 1, periodKey: '2027-05', amount: '7904000', vatRate: 8 };

  test('đúng số QA: 2×3.952.000 + VAT 632.320 = 8.536.320 ≡ round 5 — không chặn', () => {
    assert.doesNotThrow(() =>
      assertRoundIssuanceTotals({ net: 7_904_000, tax: 632_320, gross: 8_536_320 }, round5));
  });

  test('một nửa tiền (QA defect: net 3.952.000, gross 4.268.160) → 409, không được đẩy thiếu', () => {
    assert.throws(
      () => assertRoundIssuanceTotals({ net: 3_952_000, tax: 316_160, gross: 4_268_160 }, round5),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        const message = 'message' in error ? String(error.message) : '';
        assert.match(message, /Lần 1 · 2027-05/);
        assert.match(message, /8\.536\.320|8536320/);
        assert.match(message, /khóa lại/);
        return true;
      },
    );
  });

  test('lệch net 1 ₫ cũng chặn (VND integer money law)', () => {
    assert.throws(
      () => assertRoundIssuanceTotals({ net: 7_904_001, tax: 632_320, gross: 8_536_321 }, round5),
      /lệch với đợt chốt/,
    );
  });

  test('lệch VAT (spread không về đúng VAT nguyên gốc của đợt) → chặn', () => {
    assert.throws(
      () => assertRoundIssuanceTotals({ net: 7_904_000, tax: 632_321, gross: 8_536_321 }, round5),
      /lệch với đợt chốt/,
    );
  });

  test('đợt 0 ₫ (miễn phí) với note rỗng — nhất quán, không chặn', () => {
    assert.doesNotThrow(() =>
      assertRoundIssuanceTotals({ net: 0, tax: 0, gross: 0 }, { id: 9, roundNo: 1, periodKey: '2027-06', amount: '0', vatRate: 8 }));
  });
});

// ─── layer 1 + layer 3 wiring: freeze override law + reconcile at both acts ──

describe('SIL-855 wiring — freeze đọc override SIL-805; preview + [Lưu] đối chiếu round', () => {
  test('buildCostSnapshot đóng băng MỘT LUẬT: freight + tổng từ cùng lần đọc bảng merge (SIL-1022)', () => {
    const freeze = costLockSource.slice(
      costLockSource.indexOf('async function buildCostSnapshot'),
      costLockSource.indexOf('export interface LockShipmentCostInput'),
    );
    assert.match(freeze, /getDebitMergeBoard\(\{ shipmentIds: \[shipmentId\] \}\)/);
    assert.match(freeze, /freightAuto: frozenFreight/);
    assert.match(freeze, /receivableTotal: frozenTongTc/);
    // Kênh override riêng của freeze đã gỡ — cước đóng băng là ô merge đã hợp
    // nhất SIL-805 (revenue.cuoc), không còn luật summary trộn lẫn.
    assert.doesNotMatch(freeze, /freightOverrideByLot/);
    assert.doesNotMatch(freeze, /shipmentDebitRateOverrides/);
  });

  test('summary đọc ghi đè ô SIL-805 từ bảng + hợp nhất vào cột cước (một cột cho cước/gate/receivable/profit)', () => {
    // The receivable law reads the SAME merged cell the boards bill (QA round
    // 5: revenue full 3.952.000 ₫ while control.tongTc stayed null).
    assert.match(summarySource, /s\.shipmentDebitRateOverrides\.cuocThu/);
    assert.match(summarySource, /isNull\(s\.shipmentDebitRateOverrides\.shipmentContainerId\)/);
    assert.match(summarySource, /cuocThuOverrideByLot\.get\(lot\.id\)/);
    assert.match(summarySource, /cuocThuCellOverride !== 0 \|\| effectiveFreight\.value != null/);
  });

  test('debit-merge: Tổng TC đọc cùng ô Cước thu merge (ghi đè SIL-805 đi trước kênh tự động)', () => {
    const mergeSource = readFileSync(join(here, '../../services/debit-merge.service.ts'), 'utf8');
    assert.match(mergeSource, /cuocThuOverrideValue\(rateOverrideByLot\.get\(lot\.id\)\?\.cuocThu\)/);
    assert.match(mergeSource, /cuocThuCellOverride !== 0 \|\| effectiveFreight\.value != null/);
  });

  test('preview đối chiếu tổng trước khi trả bảng xem trước', () => {
    assert.match(roundsSource, /assertRoundIssuanceTotals\(totals, round\)/);
  });

  test('[Lưu] gộp đối chiếu tổng NGAY TRONG issueInTx — trước khi insert billing_documents', () => {
    const start = costLockSource.indexOf('export async function createConsolidatedDebitNote');
    assert.ok(start > 0, 'issuance anchor found');
    const issuance = costLockSource.slice(start);
    const assertIdx = issuance.indexOf('assertRoundIssuanceTotals(totals, roundMoneyRecord)');
    const insertIdx = issuance.indexOf('await tx.insert(s.billingDocuments)');
    assert.ok(assertIdx > 0 && insertIdx > assertIdx, 'the reconcile must run before the document insert');
    assert.match(costLockSource, /roundMoneyRecord = \{ id: round\.id, roundNo: round\.roundNo, periodKey: round\.periodKey, amount: round\.amount, vatRate: round\.vatRate \}/);
  });

  test('chọn đợt đọc cả amount (money law cần số đợt đã ghi)', () => {
    assert.match(costLockSource, /amount: s\.debitSettlementRounds\.amount/);
  });
});

// ─── the repair lever: governed CANCEL → claims released → re-issue ─────────

describe('SIL-855 repair law — hủy governed, phát hành lại cùng selection', () => {
  test('office cancel route tồn tại, đúng roles kế toán, bắt buộc lý do, idempotent', () => {
    assert.match(routesSource, /router\.post\('\/finance\/billing-documents\/:id\/cancel'/);
    assert.match(routesSource, /billingDocumentCancelSchema\.parse\(req\.body\)/);
    assert.match(routesSource, /IDEMPOTENCY_ENDPOINTS\.BILLING_DOCUMENT_CANCEL/);
    const cancelBlock = routesSource.slice(routesSource.indexOf("/finance/billing-documents/:id/cancel"));
    assert.match(cancelBlock.slice(0, 2000), /transitionDebitNoteStatus\(/);
  });

  test('lifecycle: SENT → CANCELED hợp lệ và hủy PHẢI nhả claim lô (DOCUMENT_CANCELED)', () => {
    const lifecycleSource = readFileSync(join(here, '../../services/debit-note-lifecycle.service.ts'), 'utf8');
    assert.match(lifecycleSource, /SENT: \['PENDING_CONFIRM', 'CANCELED'\]/);
    assert.match(lifecycleSource, /releaseReason: 'DOCUMENT_CANCELED'/);
  });

  test('replay không bị ghim bởi note đã hủy — billingDocumentIsLive coi CANCELED là dead', () => {
    const live = costLockSource.slice(
      costLockSource.indexOf('async function billingDocumentIsLive'),
      costLockSource.indexOf('/** Freeze gate for every Lớp-2 write surface'),
    );
    assert.match(live, /debitNoteStatus: s\.billingDocuments\.debitNoteStatus/);
    assert.match(live, /row\.debitNoteStatus !== 'CANCELED'/);
  });

  test('Công nợ aggregates loại note CANCELED (đã là luật hiện có — pin đúng chỗ nối vào repair path)', () => {
    const allocationSource = readFileSync(join(here, '../../services/payment-allocation.service.ts'), 'utf8');
    assert.match(allocationSource, /not in \('DRAFT', 'CANCELED'\)/);
  });
});
