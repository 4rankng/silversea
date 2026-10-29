// Card 261022201006b — "Lọc theo ngày trên CUS vẫn trả lô ngày khác". The
// lot-level transport-date filter must follow the SINGLE coalesce law
// (containerTransportDateSql): a lot's days are the union of its containers'
// coalesce(appointment VN date, EDD) days; the lot-level expectedDeliveryDate
// is the day ONLY for a lot that owns no container. The previous unconditional
// `OR expectedDeliveryDate BETWEEN` arm re-surfaced reappointed lots under
// their old EDD day (probe fixture lot Z: EDD day1, every container moved to
// day3 — filtering day1 must not return it).
//
// SIL-588 (id 688, khách 29/10 — b_d. Phạm Trung Kiên) supersedes card
// 231026000252's overview lane "undated = luôn hiện", mirroring the SIL-506
// owner ruling that already narrowed Chi tiết: under an ACTIVE range the
// Tổng quan filter returns DATED IN-RANGE rows only. An undated lot
// (container rows with neither appointment nor lot EDD, or a container-less
// LCL lot without transportDate) has no day the range names — it DROPS while
// the range is held and returns the moment the range is cleared (the call
// site pushes this condition only when a bound is set). Tổng quan, Chi tiết
// and the dispatch master-plan delivery-date filter share this one law.
//
// Pure unit test — the drizzle chunk is rendered through PgDialect the way
// cus-container-day-triage.test.ts pins SQL contracts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import { shipmentTransportDateCondition } from '../../services/cus-workspace-sql.service';

const dialect = new PgDialect();

function render(chunk: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(chunk);
  return { sql: query.sql, params: query.params };
}

describe('shipmentTransportDateCondition — an active range returns dated in-range lots only (SIL-588)', () => {
  // Distinct bounds on purpose: a from/to swap must break the params pin below.
  const condition = shipmentTransportDateCondition('2026-10-01', '2026-10-31');

  it('keeps the per-container VN-day EXISTS arm (coalesce appointment/EDD, bare between)', () => {
    const { sql: rendered, params } = render(condition);
    assert.match(rendered, /exists \(/);
    assert.match(rendered, /at time zone 'Asia\/Ho_Chi_Minh'/);
    // The arm's DAY EXPRESSION stays the full containerTransportDateSql law —
    // coalesce(date(appointment at VN), EDD) — so a swap to
    // appointment-only/EDD-only SQL cannot pass this test while silently
    // dropping the per-container fallback (same regex family as
    // cus-container-day-triage.test.ts).
    assert.match(
      rendered,
      /coalesce\(\s*date\("shipment_containers"\."customer_appointment_at" at time zone 'Asia\/Ho_Chi_Minh'\),\s*"shipments"\."expected_delivery_date"\s*\) between \$1 and \$2/,
      `EXISTS arm must pin the per-container coalesce law: ${rendered}`,
    );
    // $1/$2 bind the EXISTS between; $3/$4 the gated EDD arm — one bind per
    // comparison, all the caller's date-only strings (the VN projection is
    // SQL-side via at time zone). Order is [from,to,from,to] — the distinct
    // bounds make a swap visible.
    assert.deepEqual(params, ['2026-10-01', '2026-10-31', '2026-10-01', '2026-10-31']);
  });

  it('SIL-588 pin: the EXISTS arm carries NO null-day lane — a bare `between` drops undated containers', () => {
    const { sql: rendered } = render(condition);
    // The old shape OR-ed `coalesce(...) is null or coalesce(...) between …`
    // inside the EXISTS (card 231026000252). It must be gone: SQL `NULL
    // between x and y` is NULL → the arm is not satisfied → the lot only
    // passes when a container day is genuinely in range.
    assert.doesNotMatch(
      rendered,
      /coalesce\([\s\S]*?\) is null\s+or coalesce\(/,
      `EXISTS arm must not pass NULL days: ${rendered}`,
    );
    assert.match(rendered, /\) between \$1 and \$2/);
  });

  it('gates the lot-level EDD arm behind "the lot owns no container at all"', () => {
    const { sql: rendered } = render(condition);
    // The EDD comparison must ride INSIDE the same arm as the no-container
    // NOT EXISTS — never as a free-standing OR branch.
    assert.match(rendered, /or \(not exists \(/);
    assert.match(
      rendered,
      /not exists \([\s\S]*?\) and "shipments"\."expected_delivery_date" between \$3 and \$4/,
      `container-less arm must gate the EDD fallback: ${rendered}`,
    );
    // Every EDD comparison comes after the gate — none fires ungated, and the
    // SIL-588 shape is exactly one `between` (no >=/<= pair, no null lane).
    const gateAt = rendered.indexOf('not exists');
    const eddCompare = rendered.indexOf('expected_delivery_date" between');
    assert.ok(gateAt >= 0 && eddCompare > gateAt);
    assert.equal(rendered.match(/expected_delivery_date" between/g)?.length ?? 0, 1);
    assert.equal(rendered.match(/expected_delivery_date" >=/g)?.length ?? 0, 0);
    assert.equal(rendered.match(/expected_delivery_date" <=/g)?.length ?? 0, 0);
  });

  it('SIL-588 pin: a container-less lot without EDD matches neither arm (no null lane anywhere)', () => {
    const { sql: rendered } = render(condition);
    // `expected_delivery_date between` with NULL EDD is NULL → the
    // container-less arm fails → the undated lot drops under the active
    // range. The ONLY `is null` allowed in the chunk is the deletedAt-style
    // gate this builder does not own — here: none at all.
    assert.equal(rendered.match(/is null/g)?.length ?? 0, 0, `no null-passthrough lane may remain: ${rendered}`);
  });
});
