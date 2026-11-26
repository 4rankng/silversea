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
  debitMergeOpsChargeContribution,
} from '../../services/debit-merge.service';

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
