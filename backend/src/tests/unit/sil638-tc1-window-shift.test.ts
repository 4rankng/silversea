/**
 * SIL-638 (id 742) TC1 — ONE vehicle may run several ĐƠN orders per day in
 * DIFFERENT shift windows; hard block only on (a) real window overlap or
 * (b) an unfinished in-progress trip (QA 01/11: ca sáng 08:00 saved, ca chiều
 * 14:00 refused 6 hours apart).
 *
 * Root cause pinned here: the plan-row holder scans (the shared law owner,
 * dispatch-plan-conflict-scan.service) measured every holder by the LOT's
 * scheduled slot — `coalesce(customerAppointmentAt, closingAt, plannedReturnAt,
 * expectedDeliveryDate day)` — never by the holder's dispatched trip window,
 * so an issued 08:00–12:00 leg still claimed the lot slot and refused the
 * 14:00 assignment. The fix makes the holder's live-trip window
 * (trips.plannedStartAt / plannedEndAt, else +8h) the primary claim.
 *
 * DB-free per the BE unit-only ruling (2026-10-19): the pure overlap law is
 * pinned directly; the SQL wiring is pinned by source-scan on the law owner.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { tripClaimWindowOverlaps } from '../../services/trip-pair-rules.service';

const here = path.dirname(fileURLToPath(import.meta.url));
const scanSource = readFileSync(
  path.join(here, '../../services/dispatch-plan-conflict-scan.service.ts'),
  'utf8',
);

function vnInstant(day: number, hour: number): Date {
  return new Date(Date.UTC(2026, 11, day, hour - 7, 0, 0));
}

describe('TC1 — pure shift-window law (tripClaimWindowOverlaps)', () => {
  it('ca sáng 08:00–12:00 và ca chiều 14:00–18:00 KHÔNG trùng — cùng xe vẫn lưu', () => {
    assert.equal(
      tripClaimWindowOverlaps(
        vnInstant(21, 8).toISOString(),
        vnInstant(21, 12).toISOString(),
        vnInstant(21, 14),
        vnInstant(21, 18),
      ),
      false,
    );
  });

  it('hai ca CHỒNG nhau (10:00 lên xe đang giữ 08:00–12:00) → chặn', () => {
    assert.equal(
      tripClaimWindowOverlaps(
        vnInstant(21, 8).toISOString(),
        vnInstant(21, 12).toISOString(),
        vnInstant(21, 10),
        vnInstant(21, 14),
      ),
      true,
    );
  });

  it('chạm mép (12:00 kết thúc, 12:00 bắt đầu) không phải trùng', () => {
    assert.equal(
      tripClaimWindowOverlaps(
        vnInstant(21, 8).toISOString(),
        vnInstant(21, 12).toISOString(),
        vnInstant(21, 12),
        vnInstant(21, 16),
      ),
      false,
    );
  });

  it('holder không có giờ kết thúc giữ xe 8 giờ từ giờ bắt đầu', () => {
    // 08:00 open-ended claim spans to 16:00 — a 14:00 leg overlaps it.
    assert.equal(
      tripClaimWindowOverlaps(
        vnInstant(21, 8).toISOString(),
        null,
        vnInstant(21, 14),
        vnInstant(21, 18),
      ),
      true,
    );
  });
});

describe('TC1 — holder scans claim the dispatched trip window, not the lot slot', () => {
  it('FCL branch: holder start coalesces the live trip planned_start_at FIRST', () => {
    assert.match(
      scanSource,
      /coalesce\(\$\{holderTripStart\}, \$\{holderSlotSql\}, \$\{holderDaySql\}\)/,
      'holder start must prefer the live trip window over the lot slot',
    );
  });

  it('FCL branch: holder end prefers the trip staged end, else start + 8h', () => {
    const endBlock = scanSource.match(/const holderEndSql = sql`coalesce\([\s\S]*?\)`;/);
    assert.ok(endBlock, 'holderEndSql law block must exist');
    assert.match(endBlock[0], /ht\.planned_end_at/);
    assert.match(endBlock[0], /\$\{holderTripStart\} \+ interval '8 hours'/);
    // The trip window outranks the pre-dispatch "Giờ trả hàng" and lot slot.
    const tripEndIndex = endBlock[0].indexOf('ht.planned_end_at');
    const fulfillmentEndIndex = endBlock[0].indexOf('plannedEndAt');
    assert.ok(tripEndIndex < fulfillmentEndIndex, 'trip end wins over fulfillment plannedEndAt');
  });

  it('LCL branch: same trip-window law', () => {
    assert.match(
      scanSource,
      /coalesce\(\$\{lclHolderTripStart\}, \$\{lclHolderSlotSql\}, \$\{lclHolderDaySql\}\)/,
    );
    assert.match(scanSource, /lclHolderEndSql = sql`coalesce\(\s*\(select ht\.planned_end_at/);
  });

  it('the claiming trip is LIVE only (không đếm chuyến đã hủy/đã xóa)', () => {
    const liveTripSubqueries = scanSource.match(/select ht\.planned_start_at from \$\{s\.trips\} ht[\s\S]*?limit 1/g) ?? [];
    assert.ok(liveTripSubqueries.length >= 1, 'trip-window subquery must exist');
    for (const subquery of liveTripSubqueries) {
      assert.match(subquery, /ht\.deleted_at is null/);
      assert.match(subquery, /ht\.status in \('CREATED', 'IN_TRANSIT'\)/);
      assert.match(subquery, /order by ht\.id desc limit 1/);
    }
  });

  it('a holder riding its own trip window is STRONG evidence (fallbackSlot requires no trip start)', () => {
    assert.match(
      scanSource,
      /fallbackSlot: sql`\(\$\{holderTripStart\} is null and \$\{s\.shipmentContainers\.customerAppointmentAt\} is null\)`/,
    );
  });
});
