// Card 261022201006b — "Lọc theo ngày trên CUS vẫn trả lô ngày khác". The
// lot-level transport-date filter must follow the SINGLE coalesce law
// (containerTransportDateSql): a lot's days are the union of its containers'
// coalesce(appointment VN date, EDD) days; the lot-level expectedDeliveryDate
// is the day ONLY for a lot that owns no container. The previous unconditional
// `OR expectedDeliveryDate BETWEEN` arm re-surfaced reappointed lots under
// their old EDD day (probe fixture lot Z: EDD day1, every container moved to
// day3 — filtering day1 must not return it).
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
  const condition = shipmentTransportDateCondition('2026-10-23', '2026-10-23');

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
    // SQL-side via at time zone).
    assert.deepEqual(params, ['2026-10-23', '2026-10-23', '2026-10-23', '2026-10-23']);
  });

  it('gates the lot-level EDD arm behind "the lot owns no container at all"', () => {
    const { sql: rendered } = render(condition);
    // The EDD comparison must ride INSIDE the same arm as the no-container
    // NOT EXISTS — never as a free-standing OR branch.
    assert.match(rendered, /or \(not exists \(/);
    assert.match(rendered, /not exists \([\s\S]*?\) and "shipments"\."expected_delivery_date" >= \$3/);
    // Every EDD comparison comes after the gate — none fires ungated.
    const gateAt = rendered.indexOf('not exists');
    const firstEddCompare = rendered.indexOf('expected_delivery_date" >');
    assert.ok(gateAt >= 0 && firstEddCompare > gateAt);
    assert.equal(rendered.match(/expected_delivery_date" >=/g)?.length, 1);
    assert.equal(rendered.match(/expected_delivery_date" <=/g)?.length, 1);
  });
});
