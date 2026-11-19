// SIL-855 QA fail (build 09069560) — the Debit Note round preview showed
// VAT 0 ₫ / sau-thuế 7.904.000 ₫ while the recorded đợt carried VAT 8% =
// 632.320 ₫ / 8.536.320 ₫, because the frozen-line builder stamped EXEMPT/0
// and the preview never applied the đợt's recorded vatRate. Pinned here:
// - the builder's vatRatePercent spread (shared vatForAmount math) —
//   STANDARD lines at the đợt's rate, EXEMPT/0 preserved without a đợt;
// - preview ≡ issuance parity: both stamp round.vatRate onto the SAME
//   frozen lines (source-scan, the round-attach wiring-pin style);
// - the BKS BÁO KHÁCH fallback: effectiveBillingPlate first, then the lot's
//   ĐV-assigned trip plates (the board's non-canceled-trip projection).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFrozenShipmentDebitLines,
  type BillingDocumentLine,
  type FrozenDebitLotRenderInfo,
} from '../../services/shipment-cost-lock-lines';
import { vatForAmount } from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const roundsSource = readFileSync(join(here, '../../services/debit-settlement-rounds.service.ts'), 'utf8');
const costLockSource = readFileSync(join(here, '../../services/shipment-cost-lock.service.ts'), 'utf8');

/** A frozen lot whose receivable is all freight — the QA repro shape. */
function lotLines(vatRatePercent?: number) {
  const lot: FrozenDebitLotRenderInfo = {
    billingTruckNo: '15H-104.03',
    vehicleType: 'Container 40HC',
    ...(vatRatePercent !== undefined ? { vatRatePercent } : {}),
  };
  return buildFrozenShipmentDebitLines(
    { receivableTotal: 3_952_000, freightAuto: 3_952_000, chiHoTotal: 0 },
    'SHP-2611-00308',
    lot,
  );
}

describe('buildFrozenShipmentDebitLines vatRatePercent — SIL-855 đợt VAT', () => {
  test('8% stamps STANDARD lines: tax = vatForAmount(base, 8), gross = net + tax', () => {
    const lines = lotLines(8);
    assert.equal(lines.length, 1, 'receivable==freight → one FREIGHT line');
    const line = lines[0]!;
    assert.equal(line.netAmount, 3_952_000);
    assert.equal(line.taxAmount, 316_160, '3.952.000 × 8% = 316.160 ₫ (QA lot 1)');
    assert.equal(line.grossAmount, 4_268_160);
    assert.equal(line.vatTreatment, 'STANDARD');
    assert.equal(line.vatRate, 0.08);
    assert.equal(line.baseAmount, 3_952_000);
  });

  test('the QA board row parity: two 3.952.000 lots sum to the recorded 632.320 ₫ VAT', () => {
    const lot1 = documentSum(lotLines(8));
    const lot2 = documentSum(lotLines(8));
    const tax = lot1.tax + lot2.tax;
    assert.equal(lot1.net + lot2.net, 7_904_000);
    assert.equal(tax, 632_320, 'Σ per-lot VAT = the đợt row 632.320 ₫');
    assert.equal(tax, vatForAmount(7_904_000, 8), 'per-line spread matches the single vatForAmount aggregate');
    assert.equal(lot1.gross + lot2.gross, 8_536_320);
  });

  test('5% and 10% stamp their policy fractions', () => {
    assert.equal(lotLines(5)[0]!.vatRate, 0.05);
    assert.equal(lotLines(5)[0]!.taxAmount, Math.round(3_952_000 * 5) / 100);
    assert.equal(lotLines(10)[0]!.vatRate, 0.1);
  });

  test('no đợt (undefined) and 0% keep the EXEMPT/0 law byte-identically', () => {
    for (const lines of [lotLines(), lotLines(0)]) {
      const line = lines[0]!;
      assert.equal(line.vatTreatment, 'EXEMPT');
      assert.equal(line.vatRate, 0);
      assert.equal(line.taxAmount, 0);
      assert.equal(line.grossAmount, 3_952_000);
    }
  });

  test('a rate outside the chốt policy refuses (409)', () => {
    assert.throws(
      () => lotLines(7),
      (error: { statusCode?: number }) => error.statusCode === 409,
    );
  });
});

function documentSum(lines: BillingDocumentLine[]) {
  return lines.reduce(
    (totals, line) => ({
      net: totals.net + Number(line.netAmount ?? line.baseAmount ?? 0),
      tax: totals.tax + Number(line.taxAmount ?? 0),
      gross: totals.gross + Number(line.grossAmount ?? 0),
    }),
    { net: 0, tax: 0, gross: 0 },
  );
}

describe('SIL-855 wiring — preview and [Lưu] issuance stamp the SAME round.vatRate', () => {
  test('round preview passes the đợt VAT into the frozen-line builder', () => {
    const start = roundsSource.indexOf('export async function getDebitNoteRoundPreview');
    assert.ok(start > 0, 'preview anchor found');
    const body = roundsSource.slice(start);
    assert.match(body, /vatRatePercent:\s*round\.vatRate/, 'preview stamps round.vatRate');
    assert.match(body, /totals:\s*documentVatTotals\(allLines\)/, 'preview totals still ride documentVatTotals');
  });

  test('[Lưu] issuance selects the đợt VAT and stamps it on the issued lines', () => {
    const start = costLockSource.indexOf('export async function createConsolidatedDebitNote');
    assert.ok(start > 0, 'issuance anchor found');
    const body = costLockSource.slice(start);
    assert.match(body, /vatRate:\s*s\.debitSettlementRounds\.vatRate/, 'the round select carries vatRate');
    assert.match(body, /roundVatRatePercent\s*=\s*round\.vatRate/, 'captured from the attached đợt');
    assert.match(body, /vatRatePercent:\s*roundVatRatePercent/, 'issued lines stamp the same rate');
  });

  test('round preview falls back to the lot trip plates for BKS BÁO KHÁCH', () => {
    const start = roundsSource.indexOf('export async function getDebitNoteRoundPreview');
    const body = roundsSource.slice(start);
    assert.match(body, /previewPlateOf\(lot\)/, 'the item column runs the fallback resolver');
    assert.match(body, /effectiveBillingPlate\(lot\)/, 'effectiveBillingPlate stays first');
    assert.match(body, /ne\(s\.trips\.status, 'CANCELED'\)/, 'same non-canceled-trip projection the board reads');
    assert.match(body, /row\.truckCarrierId == null \? row\.ownPlate : null/, 'own-fleet plate law mirrors the board');
  });
});
