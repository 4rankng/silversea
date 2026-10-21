// Card 211026132257 (lcl-01) — "lô hàng lẻ hiện ở TỔNG QUAN nhưng KHÔNG có
// ở CHI TIẾT". The container workboard's day triage must narrow CONTAINER
// rows only: a container-less LCL lot rides outside it entirely (dated or
// not), so the lot row can never be dropped by the board's default day lens
// while Tổng quan (no default date scope) shows it. The 2026-10-18 partial
// (D.6) exempted only UNDATED lots; this pins the completed law.
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
