// FIN-01 (QA 28/11, đợt Lần 12 · 2026-11 · Phải thu — khóa 3.998.800 ₫ vs
// chốt 4.638.000 ₫, chênh lệch 639.200 ₫, Save + XLSX disabled, UI không chỉ
// dòng nào lệch): the line-level variance read + the controlled reconciliation
// with an audit trail, pinned db-free (BE unit-only law):
//   1. buildDebitRoundVarianceReport (pure) — the mismatch localizes per LINE,
//      the zero-variance control stays reconciled (a real 0₫ line is money,
//      never a missing basis), a missing basis is null '—' never a fabricated
//      0₫, and the aggregate sum never adds up over holes;
//   2. the wiring — the variance route rides the preview's clearance, the
//      reconcile POST is a declared material write gated to the office trio
//      behind a MANDATORY reason, realigns the recorded total inside the
//      idempotency envelope, refuses the zero-variance control and an
//      already-issued đợt, writes ONE audit row (before→after + reason +
//      actor) in the same transaction as the write, and pre-flights the SAME
//      money law the preview/[Lưu] run so a reconciliation that still could
//      not export is refused BEFORE any write;
//   3. the existing hard block stays — the preview still reconciles against
//      the đợt record (assertRoundIssuanceTotals) and the chốt creator now
//      freezes each lot's contribution (the per-lot closed money).
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDebitRoundVarianceReport, assertRoundIssuanceTotals } from '../../services/debit-settlement-shared';

const here = dirname(fileURLToPath(import.meta.url));
const roundsSource = readFileSync(join(here, '../../services/debit-settlement-rounds.service.ts'), 'utf8');
const routesSource = readFileSync(join(here, '../../routes/accounting-debit.ts'), 'utf8');
const schemaSource = readFileSync(join(here, '../../db/schema/financial.ts'), 'utf8');

const ROUND = { id: 13, roundNo: 12, periodKey: '2026-11', direction: 'THU' as const, vatRate: 8, amount: '4638000' };

// ─── 1. the pure variance builder ────────────────────────────────────────────

describe('buildDebitRoundVarianceReport — the QA Lần 12 · 2026-11 shape', () => {
  const qaLines = [
    { shipmentId: 901, billOrBooking: 'BL-2611-A', exportNet: 1_998_800, closedNet: 2_319_000 },
    { shipmentId: 902, billOrBooking: 'BL-2611-B', exportNet: 2_000_000, closedNet: 2_319_000 },
  ];

  it('the mismatch localizes per LINE (bill, bases, diff, VAT) — not just the two aggregates', () => {
    const report = buildDebitRoundVarianceReport({ round: ROUND, lines: qaLines, closedBasis: 'CHOT_RECORDED' });
    assert.equal(report.totals.exportNet, 3_998_800);
    assert.equal(report.totals.closedTotal, 4_638_000);
    assert.equal(report.totals.varianceNet, -639_200);
    assert.equal(report.mismatchCount, 2);
    assert.equal(report.reconciled, false);
    assert.deepEqual(report.items.map((item) => [item.billOrBooking, item.diff]), [['BL-2611-A', -320_200], ['BL-2611-B', -319_000]]);
    assert.ok(report.items.every((item) => item.mismatch));
    // VAT columns ride the đợt's rate per line (8% here).
    assert.equal(report.items[0]!.exportVat, 159_904);
    assert.equal(report.items[0]!.closedVat, 185_520);
    assert.equal(report.round.closedVat, 371_040);
    assert.equal(report.round.closedGross, 5_009_040);
  });

  it('a single drifted line is the one flagged; clean lines stay clean', () => {
    const report = buildDebitRoundVarianceReport({
      round: ROUND,
      lines: [
        { shipmentId: 901, billOrBooking: 'BL-A', exportNet: 2_319_000, closedNet: 2_319_000 },
        { shipmentId: 902, billOrBooking: 'BL-B', exportNet: 1_679_800, closedNet: 2_319_000 },
      ],
      closedBasis: 'CHOT_RECORDED',
    });
    assert.equal(report.mismatchCount, 1);
    assert.equal(report.items[0]!.mismatch, false);
    assert.equal(report.items[1]!.mismatch, true);
    assert.equal(report.items[1]!.diff, -639_200);
  });

  it('the zero-variance control stays reconciled — a real 0₫ line is money, not a hole', () => {
    // The QA control pair (fresh 1603/1604): 120.000 ₫ + a real 0₫ line
    // exports fine today and must keep doing so — reconciled, no flags.
    const report = buildDebitRoundVarianceReport({
      round: { ...ROUND, amount: '120000' },
      lines: [
        { shipmentId: 1603, billOrBooking: 'BL-120K', exportNet: 120_000, closedNet: 120_000 },
        { shipmentId: 1604, billOrBooking: 'BL-ZERO', exportNet: 0, closedNet: 0 },
      ],
      closedBasis: 'CHOT_RECORDED',
    });
    assert.equal(report.reconciled, true);
    assert.equal(report.mismatchCount, 0);
    assert.equal(report.totals.varianceNet, 0);
    assert.equal(report.items[1]!.exportNet, 0);
    assert.equal(report.items[1]!.diff, 0);
    assert.equal(report.items[1]!.mismatch, false);
  });

  it('a missing basis is null — never a fabricated 0₫, and the sum refuses to add over holes', () => {
    const report = buildDebitRoundVarianceReport({
      round: ROUND,
      lines: [
        { shipmentId: 901, billOrBooking: 'BL-A', exportNet: 3_998_800, closedNet: 4_638_000 },
        { shipmentId: 902, billOrBooking: 'BL-B', exportNet: null, closedNet: null, basisError: 'Lô chưa khóa chi phí — chưa có nền số liệu khóa để đối chiếu.' },
      ],
      closedBasis: 'BOARD_FALLBACK',
    });
    assert.equal(report.items[1]!.exportNet, null);
    assert.equal(report.items[1]!.diff, null);
    assert.equal(report.totals.exportNet, null);
    assert.equal(report.totals.varianceNet, null);
    assert.equal(report.reconciled, false);
    assert.equal(report.items[1]!.basisError, 'Lô chưa khóa chi phí — chưa có nền số liệu khóa để đối chiếu.');
  });
});

// ─── 2. the wiring: routes, service guards, audit trail ─────────────────────

describe('FIN-01 wiring — variance read + controlled reconcile (source pins)', () => {
  it('the variance read rides the preview clearance (office trio), read-only', () => {
    const route = routesSource.match(/accountingDebitRoutes\.get\('\/debit-board\/settlement-rounds\/:roundId\/variance', ([A-Z_]+),/);
    assert.ok(route, 'variance route missing');
    assert.equal(route[1], 'OFFICE_ROLES');
  });

  it('the reconcile POST is a declared material write under the office trio with a mandatory reason', () => {
    const route = routesSource.match(/accountingDebitRoutes\.post\('\/debit-board\/settlement-rounds\/:roundId\/reconcile', declareMaterialWrite\('([^']+)', \{ method: 'POST', path: '([^']+)' \}\), ([A-Z_]+),/);
    assert.ok(route, 'reconcile route missing');
    assert.equal(route[1]!, 'accounting.debit-board.settlement-round.reconcile');
    assert.equal(route[2], '/api/accounting/debit-board/settlement-rounds/:roundId/reconcile');
    assert.equal(route[3], 'OFFICE_ROLES');
    assert.match(routesSource, /reason: z\.string\(\)\.trim\(\)\.min\(1, 'Vui lòng nhập lý do đối chiếu\.'\)\.max\(2000\)/);
    assert.match(routesSource, /IDEMPOTENCY_ENDPOINTS\.DEBIT_BOARD_SETTLEMENT_ROUND_RECONCILE/);
  });

  it('the idempotency endpoint is registered beside the settlement-round create', () => {
    const idempotencySource = readFileSync(join(here, '../../services/idempotency.service.ts'), 'utf8');
    assert.match(idempotencySource, /DEBIT_BOARD_SETTLEMENT_ROUND_RECONCILE: 'accounting\.debit-board\.settlement-round\.reconcile'/);
  });

  it('the write + its audit row share ONE transaction, carrying before→after, reason, actor, old→new', () => {
    const reconcileBody = roundsSource.slice(roundsSource.indexOf('export async function reconcileDebitSettlementRound'));
    // single transaction: the update and the audit insert run on the same tx
    assert.match(reconcileBody, /await tx\.update\(s\.debitSettlementRounds\)/);
    assert.match(reconcileBody, /await tx\.insert\(s\.auditLogs\)\.values\(/);
    assert.match(reconcileBody, /message: 'DEBIT_SETTLEMENT_ROUND_RECONCILED'/);
    assert.match(reconcileBody, /entityType: 'debit_settlement_round'/);
    assert.match(reconcileBody, /payload: \{\s*\n\s*before: \{ amount: beforeRoundAmount, vat: beforeVat, gross: beforeRoundAmount \+ beforeVat \}/);
    assert.match(reconcileBody, /after: \{ amount: target, vat: afterVat, gross: target \+ afterVat \}/);
    assert.match(reconcileBody, /reason,/);
    assert.match(reconcileBody, /userId: input\.actor\.userId/);
  });

  it('the reconcile refuses a zero variance (the control) and an already-issued đợt', () => {
    const reconcileBody = roundsSource.slice(roundsSource.indexOf('export async function reconcileDebitSettlementRound'));
    assert.match(reconcileBody, /không có chênh lệch để đối chiếu/);
    assert.match(reconcileBody, /isNull\(s\.debitNoteLots\.releasedAt\)/);
    assert.match(reconcileBody, /tổng đợt chỉ đối chiếu được trước khi phát hành/);
  });

  it('the reconcile pre-flights the SAME money law the preview and the issuance run', () => {
    const reconcileBody = roundsSource.slice(roundsSource.indexOf('export async function reconcileDebitSettlementRound'));
    const assertIdx = reconcileBody.indexOf('assertRoundIssuanceTotals(');
    const writeIdx = reconcileBody.indexOf('await tx.update(s.debitSettlementRounds)');
    assert.ok(assertIdx >= 0 && writeIdx > assertIdx, 'the money law must run BEFORE the recorded total is written');
    // and the target is the SAME frozen/board basis the preview prints
    assert.match(reconcileBody, /buildFrozenShipmentDebitLines/);
    assert.match(reconcileBody, /documentVatTotals/);
  });

  it('the hard block stays: the preview still reconciles against the đợt record', () => {
    assert.match(roundsSource, /assertRoundIssuanceTotals\(totals, round, isTra/);
  });

  it('the variance read mirrors the preview basis and labels the legacy fallback', () => {
    const varianceBody = roundsSource.slice(roundsSource.indexOf('export async function getDebitSettlementRoundVariance'));
    assert.match(varianceBody, /buildFrozenShipmentDebitLines/);
    assert.match(varianceBody, /documentVatTotals/);
    assert.match(varianceBody, /closedBasis: lotRows\.every\(\(lot\) => lot\.chotAmount != null\) \? 'CHOT_RECORDED' : 'BOARD_FALLBACK'/);
    assert.match(varianceBody, /DEBIT_SETTLEMENT_ROUND_RECONCILED/);
  });

  it('the chốt freezes each lot contribution (the per-lot closed money) — schema + write', () => {
    assert.match(schemaSource, /debit_settlement_round_lots[\s\S]{0,800}?amount: numeric\('amount', \{ precision: 15, scale: 0 \}\)/);
    assert.match(roundsSource, /amount: String\(basisByLot\.get\(shipmentId\)\)/);
    const migrationPath = join(here, '../../../drizzle/20261128110000_fin01_debit_round_lot_amount.sql');
    assert.ok(existsSync(migrationPath), 'the ALTER TABLE migration is missing');
    assert.match(readFileSync(migrationPath, 'utf8'), /ALTER TABLE "debit_settlement_round_lots" ADD COLUMN "amount" numeric\(15, 0\)/);
  });
});

// ─── 3. the standing laws this block must not disturb ───────────────────────

describe('FIN-01 — standing money laws untouched', () => {
  it('assertRoundIssuanceTotals still refuses a half-money issuance (QA round 5 law)', () => {
    assert.throws(
      () => assertRoundIssuanceTotals({ net: 3_952_000, tax: 316_160, gross: 4_268_160 }, { id: 5, roundNo: 1, periodKey: '2026-11', amount: '7904000', vatRate: 8 }),
      /Tổng Debit Note lệch với đợt chốt/,
    );
    assert.doesNotThrow(() => assertRoundIssuanceTotals({ net: 7_904_000, tax: 632_320, gross: 8_536_320 }, { id: 5, roundNo: 1, periodKey: '2026-11', amount: '7904000', vatRate: 8 }));
  });
});
