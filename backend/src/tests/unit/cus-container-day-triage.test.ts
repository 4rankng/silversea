// Card 211026132257 (lcl-01) — "lô hàng lẻ hiện ở TỔNG QUAN nhưng KHÔNG có
// ở CHI TIẾT". The container workboard's day triage must narrow DATED rows
// only: a container-less LCL lot rides outside it entirely (dated or not),
// so the lot row can never be dropped by the board's default day lens while
// Tổng quan (no default date scope) shows it. The 2026-10-18 partial (D.6)
// exempted only UNDATED lots; lan 1 pinned the completed lot-row law.
//
// Card 211026180528 (lcl-01 lan 2) — the same sync re-opened by a SECOND
// shape: an intake-skeleton row (containers, no appointment, lot without
// EDD — staging lot SHP-2610-00069) whose triage day coalesce(appointment,
// EDD) is NULL. No date range can match NULL, so the dateArms-only branch
// dropped it under the default day lens while Tổng quan listed it. The
// triage now sends EVERY null-day row outside the date arms.
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

describe('containerDayTriageCondition — LCL lot rows ride outside the day triage (lcl-01)', () => {
  it('keeps the container-row date arms intact', () => {
    const { sql: rendered } = render(containerDayTriageCondition(dateArms()));
    assert.match(rendered, /coalesce\(/);
    assert.match(rendered, />= '2026-10-21'/);
    assert.match(rendered, /<= '2026-10-21'/);
  });

  it('exempts container-less LCL lot rows UNCONDITIONALLY — no date conjunct on the lot arm', () => {
    const { sql: rendered, params } = render(containerDayTriageCondition(dateArms()));
    // The lot arm keys on the LEFT JOIN's null container id + cargoMode LCL…
    assert.match(rendered, /"shipment_containers"\."id" is null/);
    assert.match(rendered, /"shipments"\."cargo_mode" = \$\d+/);
    assert.ok(params.includes('LCL'), `cargoMode must bind LCL: ${JSON.stringify(params)}`);
    // …and carries NO transport-date gate: the 2026-10-18 partial's
    // `transportDate is null` conjunct (undated-only exemption) is gone, so a
    // DATED lot (EDD ≠ lens day) survives the filter too.
    const lotArm = rendered.slice(0, rendered.indexOf('coalesce('));
    assert.equal((lotArm.match(/is null/g) ?? []).length, 1, `lot arm must gate on the container id alone: ${lotArm}`);
  });

  it('is an OR: a real container row matches by its day, a lot row by identity', () => {
    const { sql: rendered } = render(containerDayTriageCondition(dateArms()));
    assert.match(rendered, /^\(\s*\(\s*"shipment_containers"\."id" is null[\s\S]*or\s*\([\s\S]*coalesce\([\s\S]*\)\s*\)$/);
  });
});

describe('containerDayTriageCondition — null-day rows ride outside the day triage (lcl-01 lan 2, card 211026180528)', () => {
  it('exempts rows whose triage day is NULL — coalesce(appointment, EDD) is null arm', () => {
    const { sql: rendered } = render(containerDayTriageCondition(dateArms()));
    // The null-day arm is the triage-day expression itself under `is null`:
    // a container row without an appointment on a lot without an EDD (the
    // intake skeleton, staging SHP-2610-00069) can match no date range and
    // must not be dropped by the board's default day lens.
    assert.match(
      rendered,
      /coalesce\(\s*date\("shipment_containers"\."customer_appointment_at" at time zone 'Asia\/Ho_Chi_Minh'\),\s*"shipments"\."expected_delivery_date"\s*\) is null/,
      `null-day arm missing: ${rendered}`,
    );
  });

  it('carries NO date conjunct on the null-day arm — undated rows survive any lens', () => {
    const { sql: rendered } = render(containerDayTriageCondition(dateArms()));
    // The null-day arm sits between the lot arm (` or coalesce(`) and the
    // date-arms branch (` or (coalesce(`): it must be a bare `… is null`
    // predicate, never ANDed with a range.
    const start = rendered.indexOf(' or coalesce(') + ' or '.length;
    const end = rendered.indexOf(' or (coalesce(');
    const nullDayArm = rendered.slice(start, end);
    assert.ok(nullDayArm.length > 0, `null-day arm not found: ${rendered}`);
    assert.match(nullDayArm, /is null$/);
    assert.doesNotMatch(nullDayArm, />=|<=/, `null-day arm must not carry a range: ${nullDayArm}`);
  });

  it('is a three-arm OR: lot-LCL arm, null-day arm, then the date arms', () => {
    const { sql: rendered } = render(containerDayTriageCondition(dateArms()));
    assert.equal((rendered.match(/ or /g) ?? []).length, 2,
      `expected exactly three OR arms: ${rendered}`);
    const lotArmIdx = rendered.indexOf('"shipment_containers"."id" is null');
    const nullDayIdx = rendered.indexOf(') is null');
    const rangeIdx = rendered.indexOf(">= '2026-10-21'");
    assert.ok(lotArmIdx >= 0 && nullDayIdx > lotArmIdx && rangeIdx > nullDayIdx,
      `arm order must be lot-LCL, null-day, dateArms: ${rendered}`);
  });
});
