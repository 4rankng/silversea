// SIL-820 (id 949) — the sell split (TỔNG CHI HỘ - CÓ HĐ / TỔNG DỊCH VỤ -
// KHÔNG HĐ) must not fabricate a '0' on a lot whose total is not determined.
// The 24/10 law is VALUE-based and screen-wide (KB Ch.8 §8.1.3): pending
// (chưa chốt) → ô TRỐNG; a 0 stays only as a computed component inside a
// determined total. Db-free unit seam (2026-10-19 owner ruling): the pure
// gate lives in debit-receivable-arming, the service wires it behind the
// SIL-814 frozen-vs-live gate — pinned byte-level below.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sellSplitDisplayValue } from '../../services/debit-receivable-arming';

const here = dirname(fileURLToPath(import.meta.url));
const summary = readFileSync(join(here, '../../services/shipment-debit-summary.service.ts'), 'utf8');

describe('sellSplitDisplayValue (SIL-820 value-based zero law)', () => {
  test('open undetermined lot — split 0 is fabricated → ô TRỐNG (R3Q-680-B / QBOBD39C / 100GX19033 / 339IVN0130626)', () => {
    assert.equal(sellSplitDisplayValue({ value: 0, totalDetermined: false }), null);
  });

  test('a 0 inside a determined total stays — MATS8322408000 DỊCH VỤ 0 trong 5.682.000', () => {
    assert.equal(sellSplitDisplayValue({ value: 0, totalDetermined: true }), 0);
  });

  test('non-zero component passes even when the total is undetermined (real entered money)', () => {
    assert.equal(sellSplitDisplayValue({ value: 2_000_000, totalDetermined: false }), 2_000_000);
    assert.equal(sellSplitDisplayValue({ value: 2_000_000, totalDetermined: true }), 2_000_000);
  });

  test('null passes through (Chưa xác định stays blank)', () => {
    assert.equal(sellSplitDisplayValue({ value: null, totalDetermined: false }), null);
    assert.equal(sellSplitDisplayValue({ value: null, totalDetermined: true }), null);
  });
});

describe('SIL-820 wiring in the debit summary service', () => {
  test('both split columns gate their zeros behind the displayed receivableTotal (post-SIL-814 frozen-vs-live gate)', () => {
    assert.match(summary, /const chiHoSellRaw = knownSum\(/);
    assert.match(summary, /const serviceSellRaw = knownSum\(/);
    assert.match(summary, /const chiHoSellTotal = sellSplitDisplayValue\(\{ value: chiHoSellRaw, totalDetermined: receivableValue != null \}\)/);
    assert.match(summary, /const serviceSellTotal = sellSplitDisplayValue\(\{ value: serviceSellRaw, totalDetermined: receivableValue != null \}\)/);
    // The gate consumes the ALREADY-gated receivableValue: the frozen-vs-live
    // display gate (receivableDisplayValue + receivableCellFreightKnown) runs
    // above this line, so a locked lot's stale frozen zero (R4B-693-001)
    // blanks together with its split, and a legit D02 zero keeps it.
    const gateAt = summary.indexOf('receivableValue = receivableDisplayValue({');
    const splitAt = summary.indexOf('const chiHoSellTotal = sellSplitDisplayValue(');
    assert.ok(gateAt > -1 && splitAt > gateAt, 'sell split gate must run AFTER the receivable display gate');
  });
});
