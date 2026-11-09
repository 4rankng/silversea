// SIL-728 — the "Còn phải hoàn ứng" report converges with the settlement
// phiếu family (unit source pins, no db — 2026-10-19 owner ruling):
//   1. The unscoped ĐÃ ỨNG nets the legacy settlement consumption
//      (advance_settlement_requests × advance_settlements, VOIDED/REVERSED
//      excluded) — the SAME consumption family the signed-wallet authority
//      reads — so a fully-settled staff stops carrying a ghost âm forever
//      (QA fail 09/11: Vũ Đình Cường −4.300.000₫ displayed, wallet 0).
//   2. The row's collection affordances: a wallet deficit rides the
//      advance-recovery drawer; a report-âm row with a settled wallet opens
//      the /advances settlement dialog (the FE pins live in
//      OpsReconciliationReportPage.test.tsx — here we pin the DATA the FE
//      branches on: remainingSigned + outstandingSigned both reach the row).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(
  path.resolve(process.cwd(), 'src/services/ops-reconciliation-report.service.ts'),
  'utf8',
);

test('the unscoped ĐÃ ỨNG nets the legacy settlement consumption the wallet authority reads', () => {
  assert.match(source, /advanceSettlementRequests[\s\S]*?advanceSettlements[\s\S]*?advanceRequests/,
    'the netting joins the legacy phiếu family');
  assert.match(source, /notInArray\(s\.advanceSettlements\.status, \['VOIDED', 'REVERSED'\]\)/,
    'voided/reversed settlements never net (same family rule as the wallet)');
  assert.match(source, /Math\.max\(0, \(heldByStaff\.get\(key\) \?\? 0\) - Number\(row\.settled\)\)/,
    'the netting floors per staff — ĐÃ ỨNG is money actually held');
  assert.match(source, /batchInfo \? undefined : gte\(s\.opsExpenseEntries\.paidAt, costFrom\)/,
    'the scoped (đợt) branch keeps its allocation-only ĐÃ ỨNG untouched');
});

test('the report row carries both collection signals the FE branches on', () => {
  const push = source.slice(source.indexOf('rows.push({'));
  assert.match(push, /remainingSigned, outstandingSigned, needsCollection/,
    'remainingSigned (report âm) + outstandingSigned (wallet) + needsCollection all serialize');
});
