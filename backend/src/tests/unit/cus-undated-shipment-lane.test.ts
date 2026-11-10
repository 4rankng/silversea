// SIL-791 (id 917, QA 10/11, KB Ch3 §3.1.5) — undated lots stay visible at
// LOT level while a transport-date range is held. The lane rides the
// /shipments list call site as `or(shipmentTransportDateCondition(...),
// undatedShipmentLaneSql())`; the container triage (SIL-506) and the
// dispatch master-plan (SIL-588 law) stay untouched.
//
// Pure unit test — the drizzle chunk is rendered through PgDialect the way
// shipment-transport-date-condition.test.ts pins SQL contracts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import { undatedShipmentLaneSql } from '../../services/cus-workspace-sql.service';

const dialect = new PgDialect();

function render(chunk: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(chunk);
  return { sql: query.sql, params: query.params };
}

describe('undatedShipmentLaneSql — SIL-791 undated lot lane', () => {
  const lane = undatedShipmentLaneSql();
  const { sql } = render(lane);

  it('gates on a null lot expected delivery date', () => {
    assert.match(sql, /"shipments"\."expected_delivery_date" is null/);
  });

  it('requires no container appointment anywhere on the lot', () => {
    assert.match(sql, /not exists/);
    assert.match(sql, /"shipment_containers"\."customer_appointment_at" is not null/);
    // Correlated on the lot, never a global scan.
    assert.match(sql, /"shipment_containers"\."shipment_id" = "shipments"\."id"/);
  });

  it('carries no parameter — the lane is range-independent', () => {
    assert.equal(render(lane).params.length, 0);
  });
});

describe('SIL-791 call site — /shipments list composes the lane with the range law', () => {
  const reads = readFileSync(
    new URL('../../services/cus-shipment-workspace-reads.service.ts', import.meta.url),
    'utf8',
  );
  // The shipment-mode date branch only.
  const branch = reads.slice(
    reads.indexOf("} else if (query.transportDateFrom || query.transportDateTo) {"),
    reads.indexOf('if (query.customerId) {'),
  );

  it('ORs the undated lane into the shipment-level range condition', () => {
    assert.match(branch, /or\(shipmentTransportDateCondition\(dateFrom, dateTo\), undatedShipmentLaneSql\(\)\)!/);
  });

  it('does not touch the container-mode triage (SIL-506 stays exact)', () => {
    const containerMode = reads.slice(
      reads.indexOf("if (searchMode === 'container') {"),
      reads.indexOf("} else if (query.transportDateFrom || query.transportDateTo) {"),
    );
    assert.match(containerMode, /containerDayTriageCondition\(dateArms\)/);
    assert.doesNotMatch(containerMode, /undatedShipmentLaneSql/);
  });
});
