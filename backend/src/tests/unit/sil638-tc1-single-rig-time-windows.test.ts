/**
 * SIL-638 (id 742) TC1 — one rig may run several ĐƠN orders per day as long
 * as the dispatch windows do not overlap, and an IN_TRANSIT (or CREATED)
 * holder inside the window blocks.
 *
 * DOC logic-hang-kep-kethop: "ca chiều lưu thành công — KHÔNG chặn cứng
 * 1 xe = 1 lệnh ĐƠN/ngày"; "trùng giờ hoặc xe đang chạy thì hệ thống chặn".
 *
 * The blocking decision is SQL inside assertResourceAvailability /
 * assertPlanRowRigAvailable (integration-owned). The pure law it implements —
 * a holder claims [start, end ?? start+8h) and blocks only on STRICT window
 * overlap — is pinned here; this tree stays db-free per the BE unit-only
 * ruling (2026-10-19).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  declaredKepShareMode,
  OPEN_ENDED_TRIP_CLAIM_SPAN_HOURS,
  tripClaimWindowOverlaps,
} from '../../services/trip-pair-rules.service';

function utc(day: number, hour: number): Date {
  return new Date(Date.UTC(2026, 9, day, hour, 0, 0));
}

describe('tripClaimWindowOverlaps (SIL-638 TC1 — time-scoped rig law)', () => {
  const incoming = { start: utc(31, 8), end: utc(31, 12) }; // ca sáng 08:00–12:00

  it('allows a same-day later shift — ca chiều 14:00–18:00 is NOT an overlap', () => {
    assert.equal(tripClaimWindowOverlaps('2026-10-31T14:00:00.000Z', '2026-10-31T18:00:00.000Z', incoming.start, incoming.end), false);
  });

  it('allows back-to-back shifts — touching edges are not an overlap', () => {
    assert.equal(tripClaimWindowOverlaps('2026-10-31T12:00:00.000Z', '2026-10-31T16:00:00.000Z', incoming.start, incoming.end), false);
  });

  it('blocks Cont C 10:00–14:00 — a same-window overlap', () => {
    assert.equal(tripClaimWindowOverlaps('2026-10-31T10:00:00.000Z', '2026-10-31T14:00:00.000Z', incoming.start, incoming.end), true);
  });

  it('blocks a holder that starts inside the incoming window', () => {
    assert.equal(tripClaimWindowOverlaps('2026-10-31T09:00:00.000Z', '2026-10-31T10:30:00.000Z', incoming.start, incoming.end), true);
  });

  it('an open-ended holder (xe đang chạy, chưa có giờ kết thúc) claims 8 hours from its start', () => {
    assert.equal(OPEN_ENDED_TRIP_CLAIM_SPAN_HOURS, 8);
    // Started 07:00 → claims until 15:00 → blocks the 08:00–12:00 window.
    assert.equal(tripClaimWindowOverlaps('2026-10-31T07:00:00.000Z', null, incoming.start, incoming.end), true);
    // A 17:00 window starts after the default span ends → allowed.
    assert.equal(
      tripClaimWindowOverlaps('2026-10-31T07:00:00.000Z', null, utc(31, 17), utc(31, 21)),
      false,
    );
  });

  it('another day never overlaps', () => {
    assert.equal(tripClaimWindowOverlaps('2026-10-30T08:00:00.000Z', '2026-10-30T20:00:00.000Z', incoming.start, incoming.end), false);
  });
});

describe('declaredKepShareMode (SIL-638 TC1/TC2 — classification carve gate)', () => {
  const kep = (classification: string, twentyFoot = true) => ({
    issuingContainerIsTwentyFoot: twentyFoot,
    classification,
    departureDate: '2026-10-31',
  });

  it('a plain ĐƠN (SINGLE) resolving context has NO carve mode', () => {
    assert.equal(declaredKepShareMode(kep('SINGLE')), null);
  });

  it('LCL rows have no carve mode either', () => {
    assert.equal(declaredKepShareMode(kep('LCL')), null);
    assert.equal(declaredKepShareMode(kep('LCL_PICKUP')), null);
  });

  it('Kẹp needs the 20′ proof — a 40′ DOUBLE is not a clamp', () => {
    assert.equal(declaredKepShareMode(kep('DOUBLE', true)), 'KEP');
    assert.equal(declaredKepShareMode(kep('DOUBLE', false)), null);
  });

  it('Kết hợp resolves the sequential KET_HOP mode', () => {
    assert.equal(declaredKepShareMode(kep('COMBINED')), 'KET_HOP');
  });

  it('no context resolves no mode (the guard runs classification-free)', () => {
    assert.equal(declaredKepShareMode(null), null);
  });
});
