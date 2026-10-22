// Card 211026132257 (lcl-01) — "lô hàng lẻ hiện ở TỔNG QUAN nhưng KHÔNG có
// ở CHI TIẾT". The container workboard's day triage must narrow DATED rows
// only: a row with NO triage day rides outside it entirely, so it can never be
// dropped by the board's default day lens while Tổng quan shows it.
//
// Card 211026180528 (lcl-01 lan 2) — the same sync re-opened by a SECOND
// shape: an intake-skeleton row (containers, no appointment, lot without
// EDD — staging lot SHP-2610-00069) whose triage day coalesce(appointment,
// EDD) is NULL. No date range can match NULL, so the dateArms-only branch
// dropped it under the default day lens while Tổng quan listed it. The
// triage sends EVERY null-day row outside the date arms.
//
// Card 231026000252 (the law this file pins now) — the lan-1 blanket escape
// for container-less LCL lots ("dated or not, ride outside the triage")
// over-shot: transportDate=2026-10-17 stayed visible under a 23/10..23/10
// filter on Chi tiết while Tổng quan filtered it away ("bỏ qua bộ lọc ngày
// hoàn toàn", lot K547238574983). The law is now uniform for every row shape:
//   - undated (coalesce(appointment, EDD) NULL) always shows — any lens;
//   - dated must pass the date arms, INCLUDING a container-less LCL lot row
//     whose day is the lot EDD leg of the same coalesce.
// One law on both surfaces keeps the lcl-01 sync goal: a lot visible under a
// filter on Tổng quan is visible under the SAME filter on Chi tiết.
//
// Pure unit test, no database: the drizzle chunk is rendered through
// PgDialect the way cus-record-search.test.ts pins SQL contracts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';

import { containerDayTriageCondition, containerTransportDateSql } from '../../services/cus-workspace-sql.service';

const dialect = new PgDialect();

function render(chunk: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(chunk);
  return { sql: query.sql, params: query.params };
}

const dateArms = (): SQL[] => [
  sql`${containerTransportDateSql()} >= '2026-10-21'`,
  sql`${containerTransportDateSql()} <= '2026-10-21'`,
];

describe('containerDayTriageCondition — dated rows pass the day filter (card 231026000252)', () => {
  it('keeps the container-row date arms intact', () => {
    const { sql: rendered } = render(containerDayTriageCondition(dateArms()));
    assert.match(rendered, /coalesce\(/);
    assert.match(rendered, />= '2026-10-21'/);
    assert.match(rendered, /<= '2026-10-21'/);
  });

  it('has NO unconditional container-less LCL escape — a dated lot row must pass the arms', () => {
    const { sql: rendered, params } = render(containerDayTriageCondition(dateArms()));
    // The old lan-1 arm (`"shipment_containers"."id" is null and cargo_mode =
    // LCL`) let a dated LCL lot bypass the filter entirely (lot K547238574983
    // visible under a 23/10..23/10 filter). It is gone: a lot row's day is
    // its EDD leg of the coalesce and it passes the same arms as any
    // container row.
    assert.doesNotMatch(rendered, /"shipment_containers"\."id" is null/);
    assert.doesNotMatch(rendered, /cargo_mode/);
    assert.ok(!params.includes('LCL'), `no LCL bind expected: ${JSON.stringify(params)}`);
  });
});

describe('containerDayTriageCondition — null-day rows ride outside the day triage (lcl-01 lan 2, card 211026180528)', () => {
  it('exempts rows whose triage day is NULL — coalesce(appointment, EDD) is null arm', () => {
    const { sql: rendered } = render(containerDayTriageCondition(dateArms()));
    // The null-day arm is the triage-day expression itself under `is null`:
    // a container row without an appointment on a lot without an EDD (the
    // intake skeleton, staging SHP-2610-00069) — and a container-less LCL
    // lot with no transportDate — can match no date range and must not be
    // dropped by the board's default day lens.
    assert.match(
      rendered,
      /coalesce\(\s*date\("shipment_containers"\."customer_appointment_at" at time zone 'Asia\/Ho_Chi_Minh'\),\s*"shipments"\."expected_delivery_date"\s*\) is null/,
      `null-day arm missing: ${rendered}`,
    );
  });

  it('carries NO date conjunct on the null-day arm — undated rows survive any lens', () => {
    const { sql: rendered } = render(containerDayTriageCondition(dateArms()));
    // The null-day arm is everything before the date-arms branch (` or (`):
    // a bare `… is null` predicate, never ANDed with a range.
    const end = rendered.indexOf(' or (');
    const nullDayArm = rendered.slice(0, end);
    assert.ok(end > 0, `null-day arm not found: ${rendered}`);
    assert.match(nullDayArm, /is null$/);
    assert.doesNotMatch(nullDayArm, />=|<=/, `null-day arm must not carry a range: ${nullDayArm}`);
  });

  it('is a two-arm OR: null-day lane first, then the date arms', () => {
    const { sql: rendered } = render(containerDayTriageCondition(dateArms()));
    assert.equal((rendered.match(/ or /g) ?? []).length, 1,
      `expected exactly two OR arms: ${rendered}`);
    const nullDayIdx = rendered.indexOf(') is null');
    const rangeIdx = rendered.indexOf(">= '2026-10-21'");
    assert.ok(nullDayIdx >= 0 && rangeIdx > nullDayIdx,
      `arm order must be null-day then dateArms: ${rendered}`);
  });
});
