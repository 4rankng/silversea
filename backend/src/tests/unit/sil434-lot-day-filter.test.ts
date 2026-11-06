// SIL-434 (QA fail 06/11, build dcaa8295): a container-less LCL lot row was
// day-gated on the EDD leg of the appointment coalesce while its LỊCH TRÌNH
// cell printed the SIL-645 stored instant (closingAt/plannedReturnAt) — so a
// lot with EDD 10/11 and closingAt 06/11 passed a 10/11..10/11 filter and
// printed 06/11. The triage day must be the day the cell prints:
//   - container rows: the appointment/EDD coalesce (unchanged law),
//   - lot rows: the stored instant's VN day with the same direction-aware
//     precedence, else the EDD day (derivedScheduleAt is EDD-day-anchored).
// Pure unit test, no database: the drizzle chunks render through PgDialect
// the way cus-container-day-triage.test.ts pins SQL contracts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';

import { workboardRowDaySql, lotTransportDaySql, containerTransportDateSql } from '../../services/cus-workspace-sql.service';

const dialect = new PgDialect();

function render(chunk: SQL): string {
  return dialect.sqlToQuery(chunk).sql;
}

describe('workboardRowDaySql — the filter day equals the printed LỊCH TRÌNH day (SIL-434)', () => {
  it('container rows keep the appointment/EDD coalesce arms', () => {
    const rendered = render(workboardRowDaySql());
    assert.match(rendered, /case when.*is null[\s\S]*else[\s\S]*end/i);
    assert.match(rendered, /"shipment_containers"\."customer_appointment_at" at time zone 'Asia\/Ho_Chi_Minh'/);
    assert.match(rendered, /"shipments"\."expected_delivery_date"/);
  });

  it('the lot arm reads the stored instants with the SIL-645 direction-aware precedence', () => {
    const rendered = render(lotTransportDaySql());
    // IMPORT prefers plannedReturnAt; the else arm prefers closingAt — the
    // exact cross-fallback `lotScheduleInstantFor` renders in the cell.
    assert.match(rendered, /case when "shipments"\."trade_direction" = 'IMPORT'\s*then coalesce\("shipments"\."planned_return_at", "shipments"\."closing_at"\)\s*else coalesce\("shipments"\."closing_at", "shipments"\."planned_return_at"\) end\s*at time zone 'Asia\/Ho_Chi_Minh'/);
    // …falling back to the EDD day (derivedScheduleAt's day).
    assert.match(rendered, /"shipments"\."expected_delivery_date"/);
  });

  it('the case split is a day SOURCE switch — no escape lane, rows still answer both date arms', () => {
    const day = '2026-11-10';
    const arms: SQL[] = [
      sql`${workboardRowDaySql()} >= '${sql.raw(day)}'`,
      sql`${workboardRowDaySql()} <= '${sql.raw(day)}'`,
    ];
    const rendered = render(sql`${arms[0]} and ${arms[1]}`);
    // The repro shape: a lot row whose printed day (06/11) sits outside the
    // 10/11 range can never satisfy `>= '2026-11-10'` — the stored instant
    // leg is inside the compared expression, not an escape arm.
    assert.match(rendered, />= '2026-11-10' and/);
    assert.match(rendered, /and[\s\S]*<= '2026-11-10'/);
    assert.doesNotMatch(rendered, / or /);
  });

  it('the container coalesce stays byte-compatible with the pre-SIL-434 pin', () => {
    const rendered = render(containerTransportDateSql());
    assert.match(rendered, /coalesce\(\s*date\("shipment_containers"\."customer_appointment_at" at time zone 'Asia\/Ho_Chi_Minh'\),\s*"shipments"\."expected_delivery_date"\s*\)/s);
  });
});
