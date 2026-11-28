// SIL-1152 (K5.48) — the unfiltered quotation list shows ONE frame per
// customer: the frame that applies. The selection law is pure
// (selectActiveFrameIds) so the unit suite pins it without a db:
//   - in force (effectiveDate ≤ today) beats a future frame,
//   - later effective date wins,
//   - same-day ties break on updatedAt — the frame a re-import just bumped
//     outranks the same-day stray the old import bug created (QA retest
//     28/11: bumped frame 20 vs stray frame 22, both eff 28/11),
//   - a customer with only future frames keeps their newest one visible.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { selectActiveFrameIds } from '../../services/quotation.service';

const at = (iso: string, minutes: number) => new Date(`${iso}T00:00:00.000Z`).getTime() + minutes * 60_000;

describe('SIL-1152 — selectActiveFrameIds: mỗi khách một khung trong danh sách chưa lọc', () => {
  test('repro QA 28/11: bump khung 20 cùng ngày thắng khung stray 22 (tie-break updatedAt)', () => {
    // Before the fix's re-import: stray 22 is newer (eff 28/11) and wins.
    const before = [
      { id: 20, customerId: 1, effectiveDate: '2026-11-27', updatedAt: new Date(at('2026-11-27', 0)) },
      { id: 22, customerId: 1, effectiveDate: '2026-11-28', updatedAt: new Date(at('2026-11-28', 0)) },
    ];
    assert.deepEqual(selectActiveFrameIds(before, '2026-11-28'), new Set([22]));
    // After the marker-targeted re-import: frame 20 bumped to today, touched
    // later — the same-day tie must fall to 20, not to the stray's higher id.
    const after = [
      { id: 20, customerId: 1, effectiveDate: '2026-11-28', updatedAt: new Date(at('2026-11-28', 30)) },
      { id: 22, customerId: 1, effectiveDate: '2026-11-28', updatedAt: new Date(at('2026-11-28', 0)) },
    ];
    assert.deepEqual(selectActiveFrameIds(after, '2026-11-28'), new Set([20]));
  });

  test('đang hiệu lực thắng khung tương lai của cùng khách', () => {
    const rows = [
      { id: 5, customerId: 2, effectiveDate: '2026-12-01', updatedAt: new Date(at('2026-11-20', 0)) },
      { id: 3, customerId: 2, effectiveDate: '2026-11-27', updatedAt: new Date(at('2026-11-10', 0)) },
    ];
    assert.deepEqual(selectActiveFrameIds(rows, '2026-11-28'), new Set([3]));
  });

  test('chưa có khung nào trong hiệu lực → khung tương lai mới nhất vẫn hiện', () => {
    const rows = [
      { id: 8, customerId: 3, effectiveDate: '2026-12-01', updatedAt: new Date(at('2026-11-15', 0)) },
      { id: 9, customerId: 3, effectiveDate: '2026-12-05', updatedAt: new Date(at('2026-11-14', 0)) },
    ];
    assert.deepEqual(selectActiveFrameIds(rows, '2026-11-28'), new Set([8]));
  });

  test('khách hàng độc lập nhau — mỗi khách một khung thắng', () => {
    const rows = [
      { id: 20, customerId: 1, effectiveDate: '2026-11-28', updatedAt: new Date(at('2026-11-28', 30)) },
      { id: 22, customerId: 1, effectiveDate: '2026-11-28', updatedAt: new Date(at('2026-11-28', 0)) },
      { id: 11, customerId: 4, effectiveDate: '2026-10-01', updatedAt: new Date(at('2026-10-01', 0)) },
      { id: 12, customerId: 4, effectiveDate: '2026-11-01', updatedAt: new Date(at('2026-11-01', 0)) },
    ];
    assert.deepEqual(selectActiveFrameIds(rows, '2026-11-28'), new Set([20, 12]));
  });
});
