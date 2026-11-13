// SIL-814 (id 942) — /shipments-debit still rendered a bare '0' TỔNG PHẢI THU
// KHÁCH on R3M-KR1 (Đã khóa, no Ghép label): the 06/11 cost freeze baked
// freightAuto 0 / receivableTotal 0 from freight snapshot 703, while the live
// freight channel now reads snapshots 839/840 = 3.952.000. The locked cell
// must judge the freeze's OWN freight knowledge (receivableCellFreightKnown),
// not the live channel — the frozen figure itself is never mutated.
//
// Per the BE unit-only ruling (da4d2f0b) the summary mapping's DB behavior is
// qa/scripts territory; this file pins the caller wiring that routes the
// locked cell through the db-free arming seam (precedent: sil812).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const service = readFileSync(
  path.resolve(process.cwd(), 'src/services/shipment-debit-summary.service.ts'),
  'utf8',
);
const items = service.slice(service.indexOf('const items: ShipmentDebitSummaryItem[]'));

test('SIL-814 — the locked receivable cell reads the frozen freight, not the live channel', () => {
  assert.match(
    items,
    /frozenNumber\(lock\.snapshot, 'freightAuto'\)/,
    'the freeze-time freightAuto is the only knowledge a locked cell may trust',
  );
  assert.match(
    items,
    /receivableCellFreightKnown\(\{[\s\S]*?locked: lock != null,[\s\S]*?frozenFreight: lock != null \? frozenNumber\(lock\.snapshot, 'freightAuto'\) : null,[\s\S]*?liveFreight: freightAuto,/,
    'the display gate routes through the SIL-814 seam (locked → frozen-vs-live agreement)',
  );
});

test('SIL-814 — the arming law lives in the db-free seam so it stays unit-testable', () => {
  const arming = readFileSync(
    path.resolve(process.cwd(), 'src/services/debit-receivable-arming.ts'),
    'utf8',
  );
  assert.match(arming, /export function receivableCellFreightKnown/, 'seam exported from debit-receivable-arming');
});
