// SIL-1088 (K2.85) — the fleet tracking screen's mức-3 lookup window. The
// completed-trip filter used to be "finished today (VN)", which made ended
// work vanish from the board the next morning ("công việc đã kết thúc nhưng
// vẫn tra cứu được" died at midnight), and the API ignored the caller's month
// entirely ("trả đúng 1 bản ghi cho mọi tháng truy vấn"). The window is now
// one whole VN calendar month, [start, end), defaulting to the current VN
// month — pinned here at the boundary instants and at the December rollover.
//
// Pure unit test (lib/vn-date has no DB import).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { vnMonthWindow } from '../../lib/vn-date';

describe('vnMonthWindow — the mức-3 lookup covers the whole VN month', () => {
  it('spans VN midnight of the 1st to VN midnight of the next month (end-exclusive)', () => {
    const { start, end } = vnMonthWindow(11, 2026);
    assert.equal(start.toISOString(), '2026-10-31T17:00:00.000Z');
    assert.equal(end.toISOString(), '2026-11-30T17:00:00.000Z');
  });

  it('rolls over the year at month 12', () => {
    const { start, end } = vnMonthWindow(12, 2026);
    assert.equal(start.toISOString(), '2026-11-30T17:00:00.000Z');
    assert.equal(end.toISOString(), '2026-12-31T17:00:00.000Z');
  });

  it('defaults to the current VN month when the caller omits both parts', () => {
    const defaulted = vnMonthWindow();
    const explicit = vnMonthWindow(
      Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', month: '2-digit' }).format(new Date())),
      Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric' }).format(new Date())),
    );
    assert.equal(defaulted.start.toISOString(), explicit.start.toISOString());
    assert.equal(defaulted.end.toISOString(), explicit.end.toISOString());
  });

  it('rejects an out-of-range month or year instead of silently mis-windowing', () => {
    assert.throws(() => vnMonthWindow(0, 2026));
    assert.throws(() => vnMonthWindow(13, 2026));
    assert.throws(() => vnMonthWindow(1, 1999));
    assert.throws(() => vnMonthWindow(1, 2101));
  });
});
