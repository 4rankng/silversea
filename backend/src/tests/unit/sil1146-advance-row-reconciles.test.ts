/**
 * SIL-1146 — QA retest 4 (staging build 6398dfbc): the Quỹ cá nhân row showed
 * Đã ứng 820.000 − ĐNTT 2.466.000 = −1.646.000 next to a −322.000₫ 'Số dư
 * quỹ'. Root cause: the balance is the WHOLE-BOOK canonical settlement
 * balance while the old columns showed the report WINDOW's flows — the
 * 1.324.000₫ of advance phiếu disbursed outside the window (and any returned
 * / settled amount) never appeared on the row.
 *
 * Law: the row carries its own components — recordedTotal − dnttTotal −
 * returnedTotal − settledTotal == remainingSigned — sourced from the ONE
 * settlement authority (getSettlementEligibleStaffBalances), so the
 * displayed inputs always sum to the displayed total.
 *
 * Pure laws + source scans only (BE unit-only owner ruling: no db/app boot).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalSignedBalance } from '../../services/advance-shared.service';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const reportService = read('../../services/ops-reconciliation-report.service.ts');
const advanceShared = read('../../services/advance-shared.service.ts');

describe('SIL-1146 — the advance row reconciles: components sum to the balance', () => {
  test('QA retest shape: out-of-window advances explain −322.000₫ exactly', () => {
    // The QA row's hidden component: 1.324.000₫ of advance phiếu disbursed
    // outside the report window (whole-book recorded 2.144.000 vs the 820.000
    // the old window column showed); the ĐNTT all sat inside the window.
    const components = { recorded: 2_144_000, dntt: 2_466_000, returned: 0, settled: 0 };
    assert.equal(canonicalSignedBalance(components), -322_000);
    // The window arithmetic QA read on screen: 820.000 − 2.466.000 =
    // −1.646.000 is NOT the balance — it sits exactly 1.324.000₫ BELOW the
    // balance, the out-of-window advance phiếu the old row never displayed.
    assert.equal((-322_000) - (820_000 - 2_466_000), 1_324_000);
  });

  test('returned and settled phiếu net into the same one balance', () => {
    assert.equal(canonicalSignedBalance({ recorded: 5_000_000, dntt: 3_000_000, returned: 500_000, settled: 1_500_000 }), 0);
    assert.equal(canonicalSignedBalance({ recorded: 1_000_000, dntt: 300_000, returned: 0, settled: 0 }), 700_000);
    assert.equal(canonicalSignedBalance({ recorded: 0, dntt: 0, returned: 0, settled: 0 }), 0);
  });

  test('the settlement authority carries components; the report row publishes them', () => {
    // getSettlementEligibleStaffBalances items expose their four sums.
    assert.match(advanceShared, /const components = \{ recorded, dntt, returned, settled \}/);
    assert.match(advanceShared, /outstanding: canonicalSignedBalance\(components\)/);
    // The report row maps the authority's components onto the row payload
    // (unscoped = whole-book sums; scoped đợt = the lot's own basis).
    assert.match(reportService, /canonicalComponentsByStaff/);
    assert.match(reportService, /batchInfo \? advanced : \(canonicalComponentsByStaff\.get\(key\)\?\.recorded \?\? 0\)/);
    assert.match(reportService, /batchInfo \? 0 : \(canonicalComponentsByStaff\.get\(key\)\?\.settled \?\? 0\)/);
    assert.match(reportService, /recordedTotal, dnttTotal, returnedTotal, settledTotal,/);
  });
});
