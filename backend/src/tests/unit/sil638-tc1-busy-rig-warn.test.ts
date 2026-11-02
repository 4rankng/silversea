/**
 * SIL-638 (id 742) TC1 — the "xe đang bận thực hiện lệnh chưa hoàn tất" tier
 * on the assign path.
 *
 * Owner DOC (ticket v2, 31/10) TC1: "trường hợp trùng giờ hoặc xe đang chạy
 * thì hệ thống chặn và hiển thị cảnh báo xung đột thời gian (hoặc xe đang bận
 * thực hiện lệnh chưa hoàn tất)".
 *
 * QA verdict (ticket 02/11 12:28, build ed0056e1): a ca-tối 18:00–22:00
 * assignment SAVED SILENTLY while both same-day legs of the rig were
 * IN_TRANSIT (trips 158+161) — "khối IN_TRANSIT chưa sống". The window scans
 * only compare [start, end) claims, so an edge-touching or later same-day
 * window against a rig that is literally out running right now passes with
 * no signal at all.
 *
 * The law implemented here: an IN_TRANSIT trip holds its rig for its whole
 * Vietnam business day (the run may overrun its planned end — only the
 * COMPLETED transition releases the rig), so any same-day assign-window
 * overlap warns once with the DOC's message and the family's confirmable
 * contract (RIG_OVERLAP_COMPLETED + confirmOverlap). Rotation stays possible
 * (the dispatcher confirms the deliberate share — "cho phép chạy xoay vòng ca
 * sáng/chiều" never becomes 1 xe = 1 lệnh/ngày again), but a save can never
 * be silent while the truck is running.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { busyDayClaimOverlaps, busyRigWarnMessage } from '../../services/trip-pair-rules.service';

const vietnam = (h: number, dayOffset = 0) => {
  const base = new Date('2026-11-09T00:00:00+07:00').getTime() + dayOffset * 24 * 3600_000;
  return new Date(base + h * 3600_000);
};

describe('SIL-638 TC1 — an IN_TRANSIT trip claims its whole business day', () => {
  it('the QA shape: ca-tối 18:00–22:00 assign vs an IN_TRANSIT holder the same day warns', () => {
    // Holder: ca chiều 14:00–18:00 IN_TRANSIT (planned end already passing).
    assert.equal(busyDayClaimOverlaps(vietnam(14), vietnam(18), vietnam(22)), true);
    // Holder: ca sáng 08:00 IN_TRANSIT, later same-day window still warns.
    assert.equal(busyDayClaimOverlaps(vietnam(8), vietnam(14), vietnam(18)), true);
  });

  it('a NEXT-day assignment does not nag — the rig is released for the next day\'s plan', () => {
    assert.equal(busyDayClaimOverlaps(vietnam(8), vietnam(8, 1), vietnam(12, 1)), false);
  });

  it('the warn names the rig and the DOC\'s "đang bận thực hiện lệnh chưa hoàn tất" text', () => {
    assert.match(busyRigWarnMessage('15H-087.19'), /15H-087\.19/);
    assert.match(busyRigWarnMessage('15H-087.19'), /đang bận thực hiện lệnh chưa hoàn tất/);
    assert.match(busyRigWarnMessage('15H-087.19'), /Vẫn lưu\?$/);
  });

  it('the day claim follows the Vietnam business zone, not the server clock', () => {
    // Holder start 17:00Z = 00:00 (+07:00) NEXT day in Vietnam — its claim day
    // is the 10th, so a 10th-day window overlaps and a 9th-day window does not.
    const utc17 = new Date('2026-11-09T17:00:00Z');
    assert.equal(busyDayClaimOverlaps(utc17, vietnam(8, 1), vietnam(12, 1)), true);
    assert.equal(busyDayClaimOverlaps(utc17, vietnam(8), vietnam(12)), false);
  });
});
