// SIL-1072 (K6.55) — a saved-but-unapproved fee must be VISIBLE on the
// Ghép bộ Debit board. QA staging build b9ab12e1: lô W5C-K3105-A carried a
// pending "Phí nâng/hạ theo vùng" (ZONE_SURCHARGE, no negotiated charge)
// that entered NO bucket — no lachHuyen cell, no group-4/5 line — so the
// board showed an all-empty row while the API reported pendingFeeCount=1.
//
// The fix routes PENDING zone rows into the group-5 no-invoice family so
// they render as a named red line like every other pending fee. Two laws
// are pinned here: (A) the pure builder carries the line through, (B) the
// service's zone branch performs the pending-only routing AND the
// receivable law stays untouched (zone rows never bill Tổng TC from their
// điều-vận cost amount).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDebitMergeNoInvoice,
} from '../../services/debit-merge.service';
import { opsChargeReceivableContribution as debitMergeOpsChargeContribution, zoneFeeBillsLachHuyenCells } from '../../services/debit-receivable-arming';

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(
  join(here, '..', '..', 'services', 'debit-merge.service.ts'),
  'utf8',
);

describe('SIL-1072 — pending zone fee rides the group-5 builder', () => {
  it('a pending zone row renders as a named fee line with side + giờ lưu (same as every pending fee)', () => {
    const result = buildDebitMergeNoInvoice([
      {
        costGroup: 'OPS_REGULAR',
        charge: null,
        paid: '1500000',
        feeName: 'Phí nâng/hạ theo vùng',
        pending: true,
        savedAt: '2026-11-26T09:20:00.000Z',
      },
    ]);
    assert.deepEqual(result.fees, [{
      name: 'Phí nâng/hạ theo vùng',
      amount: 1500000,
      side: 'gn',
      pending: true,
      savedAt: '2026-11-26T09:20:00.000Z',
    }]);
    assert.equal(result.gnFeePending, true);
  });

  it('an approved zone row does NOT join the bucket (the zone branch routes pending only)', () => {
    // The approved zone fee bills in the Lạch Huyện cell — the builder is
    // never handed it. Pin the branch shape that guarantees it:
    const zoneBranch = serviceSource.slice(
      serviceSource.indexOf('if (row.expenseTypeCode === zoneCode) {'),
      serviceSource.indexOf("} else if (row.costGroup != null && row.costGroup.startsWith('INVOICED_')"),
    );
    assert.match(zoneBranch, /if \(pending\) \{\s*const bucket = noInvoiceRawByLot\.get\(lot\) \?\? \[\];/);
    assert.match(zoneBranch, /feeName: debitMergeFeeNameOf\(\{ feeName: row\.feeName, typeName: row\.typeName \}\)/);
    // The push lives INSIDE the pending guard — an approved zone row can
    // never reach the bucket.
    const pushStart = zoneBranch.indexOf('noInvoiceRawByLot.set(lot, bucket);');
    const guardStart = zoneBranch.indexOf('if (pending)');
    assert.ok(pushStart > guardStart && guardStart > -1, 'the bucket push must sit inside the pending guard');
  });

  it('the display bucket never moves Tổng TC — zone rows still contribute nothing receivable', () => {
    assert.equal(debitMergeOpsChargeContribution({ expenseTypeCode: 'ZONE_SURCHARGE', charge: null, amount: '1500000' }), null);
    assert.equal(debitMergeOpsChargeContribution({ expenseTypeCode: 'ZONE_SURCHARGE', charge: '0', amount: '1500000' }), null);
    assert.equal(debitMergeOpsChargeContribution({ expenseTypeCode: 'ZONE_SURCHARGE', charge: '300000', amount: '900000' }), 300000);
  });
});

describe('SIL-1226 — a pending zone fee bills no Lạch Huyện cell (thu or trả)', () => {
  // QA 28/11 (lô LG28-FCL-01/02, build 88418971): a pending 1.500.000₫
  // "Phí nâng/hạ theo vùng" zeroed the thu cell (un-negotiated charge 0
  // answered `charge != null` as a negotiated 0, so the port-zone config
  // fallback never ran) and overwrote the trả cell with its cost. The one
  // shared duyệt-axis rule gates BOTH boards' cell builders; an approved
  // row keeps billing the cells (the Ops override wins).
  it('the shared predicate keys on confirmedAt exactly', () => {
    assert.equal(zoneFeeBillsLachHuyenCells(null), false, 'pending (chờ duyệt) — cells stay the auto config');
    assert.equal(zoneFeeBillsLachHuyenCells(new Date('2026-11-28T03:00:00Z')), true, 'approved — the override bills the cells');
    assert.equal(zoneFeeBillsLachHuyenCells('2026-11-28T03:00:00Z'), true, 'ISO string (registry rows) approves the same');
  });

  it('BOTH boards read the ONE rule in their zone branches (no drift)', () => {
    for (const [file, marker] of [
      ['debit-merge.service.ts', 'zoneFeeBillsLachHuyenCells(row.confirmedAt) && row.charge != null'],
      ['accounting-debit-close.service.ts', 'zoneFeeBillsLachHuyenCells(row.confirmedAt)'],
    ] as const) {
      const source = readFileSync(join(here, '..', '..', 'services', file), 'utf8');
      assert.ok(source.includes(marker), `${file} must gate its zone cells on the shared duyệt-axis rule`);
    }
    // The chốt board's cost bucket push must sit INSIDE the approved gate —
    // a pending cost may no longer overwrite the trả cell.
    const closeSource = readFileSync(join(here, '..', '..', 'services', 'accounting-debit-close.service.ts'), 'utf8');
    const gateStart = closeSource.indexOf('if (zoneFeeBillsLachHuyenCells(row.confirmedAt)) {');
    const costPush = closeSource.indexOf('zoneCostRows.set(lot, bucket);');
    assert.ok(gateStart > -1 && costPush > gateStart, 'the zone cost push must sit inside the approved gate');
  });
});
