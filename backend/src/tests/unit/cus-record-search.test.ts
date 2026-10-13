// QA2-005 (card 121026084713): the CUS workboard record search must cover
// mã lô (shipment_code) and the customer name alongside Bill/Booking,
// container, and declaration numbers — the same field family the dispatch
// q-search (shipmentQSearchPredicate) covers. Pure unit test, no database:
// the drizzle chunk is rendered through PgDialect the way advisory-lock
// tests do, and the SQL text pins the wire contract (multi-field ilike,
// pattern wrapping/escaping, empty-search passthrough, mode shape).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import { cusRecordSearchCondition } from '../../services/cus-workspace-sql.service';

const dialect = new PgDialect();

function render(chunk: SQL): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(chunk);
}

describe('cusRecordSearchCondition — field coverage (QA2-005)', () => {
  it('shipment mode searches Bill, Booking, mã lô, container, tờ khai, customer name, and raw ad-hoc name', () => {
    const condition = cusRecordSearchCondition('aB12C', 'shipment');
    assert.ok(condition, 'a non-empty term must produce a condition');
    const { sql } = render(condition);
    assert.match(sql, /btrim\("shipments"\."bl_number"\) ilike/);
    assert.match(sql, /btrim\("shipments"\."booking_ref"\) ilike/);
    assert.match(sql, /btrim\("shipments"\."shipment_code"\) ilike/);
    // Container number rides an EXISTS so the count/status-count queries
    // (which run `from shipments` with no container join) stay valid.
    assert.match(sql, /exists \(\s+select 1\s+from "shipment_containers"/);
    assert.match(sql, /btrim\("shipment_containers"\."container_number"\) ilike/);
    assert.match(sql, /exists \(\s+select 1\s+from "shipment_declarations"/);
    // Customer name: the operational coalesce (short_name → name) OR the
    // full name, mirroring dispatch's shipmentQSearchPredicate arms.
    assert.match(sql, /exists \(\s+select 1\s+from "customers"/);
    assert.match(sql, /nullif\(btrim\("customers"\."short_name"\), ''\)/);
    assert.match(sql, /btrim\("customers"\."name"\) ilike/);
    // Ad-hoc lots carry their customer as raw text on the shipment row.
    assert.match(sql, /btrim\("shipments"\."raw_customer_name"\) ilike/);
  });

  it('container mode searches the container number as a direct column', () => {
    const condition = cusRecordSearchCondition('MSCU6639870', 'container');
    assert.ok(condition);
    const { sql } = render(condition);
    assert.match(sql, /btrim\("shipment_containers"\."container_number"\) ilike/);
    // Card 261013200312: the per-cont tờ khai attribute is also a direct
    // column in container mode — no shipment_containers EXISTS needed.
    assert.match(sql, /btrim\("shipment_containers"\."declaration_number"\) ilike/);
    assert.doesNotMatch(sql, /exists \(\s+select 1\s+from "shipment_containers"/);
  });

  it('every arm is case-insensitive ilike — never a bare like', () => {
    for (const mode of ['shipment', 'container'] as const) {
      const { sql } = render(cusRecordSearchCondition('aB12C', mode)!);
      // 9 arms: bl, booking, mã lô, container, tờ khai entity, tờ khai
      // per-cont (261013200312), customer ×2, raw name.
      assert.equal((sql.match(/ilike/g) ?? []).length, 9, `${mode}: expected 9 ilike arms`);
      assert.equal(sql.match(/(^|[^a-z])like\b/g), null, `${mode}: bare like must not appear`);
    }
  });
});

describe('cusRecordSearchCondition — pattern semantics', () => {
  it('wraps the trimmed term as a substring pattern, preserving case', () => {
    const { params } = render(cusRecordSearchCondition('  aB12C  ', 'shipment')!);
    assert.ok(params.length > 0);
    for (const param of params) assert.equal(param, '%aB12C%');
  });

  it('escapes LIKE wildcards even though the shared schema already forbids them', () => {
    const { params } = render(cusRecordSearchCondition('A%B_C', 'shipment')!);
    for (const param of params) assert.equal(param, '%A\\%B\\_C%');
  });

  it('empty or whitespace-only search produces no condition (passthrough)', () => {
    assert.equal(cusRecordSearchCondition(undefined, 'shipment'), undefined);
    assert.equal(cusRecordSearchCondition('', 'shipment'), undefined);
    assert.equal(cusRecordSearchCondition('   ', 'shipment'), undefined);
    assert.equal(cusRecordSearchCondition(undefined, 'container'), undefined);
  });
});
