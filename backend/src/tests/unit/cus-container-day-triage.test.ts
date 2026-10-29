// Card 211026132257 (lcl-01) — "lô hàng lẻ hiện ở TỔNG QUAN nhưng KHÔNG có
// ở CHI TIẾT". The container workboard's day triage must narrow DATED rows
// through the date arms: a row with a triage day outside the range can never
// be shown by the board's day lens while Tổng quan filters it too.
//
// Card 211026180528 (lcl-01 lan 2) + card 231026000252 (lot K547238574983)
// — the laws this file pinned BEFORE: an unconditional containerless-LCL
// escape and then an unconditional null-day lane ("undated = luôn hiện").
//
// SIL-506 (owner ruling 2026-10-26) SUPERSEDES the null-day lane: 30/45
// transportDate-null containers rode through the Chi tiết filter
// 23/10..23/10 (staging build e5239fb1, role CUS tiepvv) because no date
// range can match NULL. The triage under an active range is now exactly the
// date arms — the law this file pins now:
//   - a DATED row passes the arms only in-range (the 23/10 pin: an
//     in-range day satisfies `>= 23/10 AND <= 23/10`; an out-range or NULL
//     day satisfies neither);
//   - an UNDATED row (coalesce(appointment, EDD) NULL — intake skeleton,
//     container-less lot without EDD) matches no range and is DROPPED; it
//     returns when the range is cleared (the call site skips the triage
//     without dateArms).
// Accepted consequence (per the ruling): LCL-01 same-filter parity with
// Tổng quan held for dated rows only — until SIL-588 (khách 29/10) closed
// the gap: shipmentTransportDateCondition now drops undated lots under an
// active range too, so Tổng quan and Chi tiết agree on undated rows as
// well (visible with no range, filtered out under one).
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

const dateArms = (day: string): SQL[] => [
  sql`${containerTransportDateSql()} >= '${sql.raw(day)}'`,
  sql`${containerTransportDateSql()} <= '${sql.raw(day)}'`,
];

describe('containerDayTriageCondition — dated rows pass the day filter (card 231026000252, kept)', () => {
  it('keeps the container-row date arms intact', () => {
    const { sql: rendered } = render(containerDayTriageCondition(dateArms('2026-10-21')));
    assert.match(rendered, /coalesce\(/);
    assert.match(rendered, />= '2026-10-21'/);
    assert.match(rendered, /<= '2026-10-21'/);
  });

  it('SIL-506 pin: a dated in-range container satisfies the 23/10..23/10 conjunction', () => {
    // The ticket repro lens: `transportDateFrom=2026-10-23&transportDateTo=
    // 2026-10-23`. A container whose triage day (coalesce(appointment VN
    // date, EDD)) IS 2026-10-23 makes both conjuncts TRUE → returned; the
    // arms must carry exactly that day on both bounds.
    const { sql: rendered } = render(containerDayTriageCondition(dateArms('2026-10-23')));
    assert.match(rendered, />= '2026-10-23'/);
    assert.match(rendered, /<= '2026-10-23'/);
  });

  it('has NO unconditional container-less LCL escape — a dated lot row must pass the arms', () => {
    const { sql: rendered, params } = render(containerDayTriageCondition(dateArms('2026-10-21')));
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

describe('containerDayTriageCondition — undated rows drop under an active range (SIL-506 supersedes card 231026000252 null lane)', () => {
  it('SIL-506 pin: a null-day container can never satisfy the 23/10..23/10 filter — no `is null` escape arm', () => {
    const { sql: rendered } = render(containerDayTriageCondition(dateArms('2026-10-23')));
    // The superseded null lane rendered `coalesce(...) is null or (...)`,
    // letting every transportDate-null container through the filter (30/45
    // leaked, ticket SIL-506). NULL compared with `>=`/`<=` yields NULL —
    // never TRUE — so WITHOUT the escape arm an undated row cannot match
    // the range and is dropped. The rendered triage must therefore carry
    // no `is null` predicate at all.
    assert.doesNotMatch(rendered, /is null/, `null-day escape arm present: ${rendered}`);
  });

  it('is a pure AND of the date arms — no OR lane left', () => {
    const { sql: rendered } = render(containerDayTriageCondition(dateArms('2026-10-23')));
    assert.equal((rendered.match(/ or /g) ?? []).length, 0,
      `no OR arm expected: ${rendered}`);
    assert.match(rendered, / and /, `date arms must be ANDed: ${rendered}`);
  });
});
