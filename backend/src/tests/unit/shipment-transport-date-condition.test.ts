// Card 261022201006b — "Lọc theo ngày trên CUS vẫn trả lô ngày khác". The
// lot-level transport-date filter must follow the SINGLE coalesce law
// (containerTransportDateSql): a lot's days are the union of its containers'
// coalesce(appointment VN date, EDD) days; the lot-level expectedDeliveryDate
// is the day ONLY for a lot that owns no container. The previous unconditional
// `OR expectedDeliveryDate BETWEEN` arm re-surfaced reappointed lots under
// their old EDD day (probe fixture lot Z: EDD day1, every container moved to
// day3 — filtering day1 must not return it).
//
// Card 231026000252 — undated passes through ("undated = luôn hiện"). A row
// whose coalesce day is NULL (container with neither appointment nor lot EDD,
// or a container-less LCL lot with no transportDate) has no day a range could
// match, yet both surfaces keep it under every lens. Both arms therefore
// accept NULL alongside the in-range test: dated must pass the filter,
// undated never gets dropped (lot K547238574983, dated 2026-10-17, must NOT
// pass a 23/10..23/10 filter — and an undated lot must pass every filter).
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

describe('shipmentTransportDateCondition — EDD is a fallback day, never an unconditional arm', () => {
  // Distinct bounds on purpose: a from/to swap must break the params pin below.
  const condition = shipmentTransportDateCondition('2026-10-01', '2026-10-31');

  it('keeps the per-container VN-day EXISTS arm (coalesce appointment/EDD)', () => {
    const { sql: rendered, params } = render(condition);
    assert.match(rendered, /exists \(/);
    assert.match(rendered, /at time zone 'Asia\/Ho_Chi_Minh'/);
    // Review finding 2: pin the arm's DAY EXPRESSION to the full
    // containerTransportDateSql law — coalesce(date(appointment at VN), EDD) —
    // so a swap to appointment-only/EDD-only SQL cannot pass this test while
    // silently dropping the per-container fallback (same regex as
    // cus-container-day-triage.test.ts).
    assert.match(
      rendered,
      /coalesce\(\s*date\("shipment_containers"\."customer_appointment_at" at time zone 'Asia\/Ho_Chi_Minh'\),\s*"shipments"\."expected_delivery_date"\s*\) between \$1 and \$2/,
      `EXISTS arm must pin the per-container coalesce law: ${rendered}`,
    );
    // $1/$2 bind the EXISTS between; $3/$4 the gated EDD arm — one bind per
    // comparison, all the caller's date-only strings (the VN projection is
    // SQL-side via at time zone). The null-passthrough adds no bind. Order is
    // [from,to,from,to] — the distinct bounds make a swap visible.
    assert.deepEqual(params, ['2026-10-01', '2026-10-31', '2026-10-01', '2026-10-31']);
  });

  it('EXISTS arm keeps undated container rows under every filter (card 231026000252)', () => {
    const { sql: rendered } = render(condition);
    // A container row whose coalesce day is NULL must ride outside the range —
    // `day is null or day between …`, not the bare `between` of the old shape.
    assert.match(
      rendered,
      /exists \(\s*select 1 from "shipment_containers"[\s\S]*?and \(coalesce\([\s\S]*?\) is null\s+or coalesce\([\s\S]*?\) between \$1 and \$2\)/,
      `EXISTS arm must pass NULL days: ${rendered}`,
    );
  });

  it('gates the lot-level EDD arm behind "the lot owns no container at all"', () => {
    const { sql: rendered } = render(condition);
    // The EDD comparison must ride INSIDE the same arm as the no-container
    // NOT EXISTS — never as a free-standing OR branch.
    assert.match(rendered, /or \(not exists \(/);
    assert.match(
      rendered,
      /not exists \([\s\S]*?\) and \("shipments"\."expected_delivery_date" is null or \("shipments"\."expected_delivery_date" >= \$3/,
      `container-less arm must gate the EDD fallback: ${rendered}`,
    );
    // Every EDD comparison comes after the gate — none fires ungated.
    const gateAt = rendered.indexOf('not exists');
    const firstEddCompare = rendered.indexOf('expected_delivery_date" >');
    assert.ok(gateAt >= 0 && firstEddCompare > gateAt);
    assert.equal(rendered.match(/expected_delivery_date" >=/g)?.length, 1);
    assert.equal(rendered.match(/expected_delivery_date" <=/g)?.length, 1);
  });

  it('container-less arm keeps undated lots (no EDD) under every filter (card 231026000252)', () => {
    const { sql: rendered } = render(condition);
    // The lot EDD leg accepts NULL alongside the range: a container-less LCL
    // lot with no transportDate has no day to match and must still show.
    assert.match(
      rendered,
      /not exists \([\s\S]*?\) and \("shipments"\."expected_delivery_date" is null or /,
      `container-less arm must pass NULL EDD: ${rendered}`,
    );
  });
});
