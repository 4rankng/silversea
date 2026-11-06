// SIL-683 (id 795) — completion business date = the Asia/Ho_Chi_Minh calendar
// day of the completion instant. `trips.completed_at` and the trips_composite
// twin are naive timestamps holding UTC wall clock (the recoverable-cost
// precedent), so ONLY the `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh'`
// chain renders the right VN day — and it does so independent of the Postgres
// session TimeZone, because the chain ends in a naive VN timestamp before
// ::date / to_char. The register, debit-note draft and billing-document
// invariants previously hand-rolled the single `at time zone
// 'Asia/Ho_Chi_Minh'` (INTERPRETS UTC wall as +07 → −7h), so a trip completed
// 2026-11-06T02:59:44Z landed as 2026-11-05 — 4/4 ticket trips, and debit-note
// ranges 05/11–05/11 instead of 06/11.
//
// Pure unit test: SQL chunks render through PgDialect (the
// shipment-transport-date-condition pattern); the defect class is pinned by a
// source scan so a hand-rolled single-chain cannot come back. The 23:xx /
// 00:xx boundary PROOF on real Postgres lives in
// qa/2026-11-06-lane-be/driver-sil683-boundary.sql (DB-backed, per the BE
// unit-only owner ruling).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import {
  tripCompletionBusinessDateSql,
  tripCompletionBusinessDateTextSql,
  tripCompletionBusinessDateCompositeDateSql,
  tripCompletionBusinessDateCompositeTextSql,
} from '../../services/completion-business-date-sql.service';

const dialect = new PgDialect();
const UTC_THEN_VN = /at time zone 'UTC'\s+at time zone 'Asia\/Ho_Chi_Minh'/i;

function render(chunk: SQL) {
  return dialect.sqlToQuery(chunk);
}

describe('completion business date law — UTC wall → VN day, shared owner (SIL-683)', () => {
  it('every shared expression chains UTC BEFORE Asia/Ho_Chi_Minh', () => {
    for (const chunk of [
      tripCompletionBusinessDateSql(),
      tripCompletionBusinessDateTextSql,
      tripCompletionBusinessDateCompositeDateSql,
      tripCompletionBusinessDateCompositeTextSql,
    ]) {
      const { sql: rendered } = render(chunk);
      assert.match(rendered, UTC_THEN_VN, `the UTC→VN chain is the law: ${rendered}`);
    }
  });

  it('the text twins render YYYY-MM-DD and the date twins cast ::date', () => {
    assert.match(render(tripCompletionBusinessDateTextSql).sql, /to_char\(/);
    assert.match(render(tripCompletionBusinessDateCompositeTextSql).sql, /to_char\(/);
    assert.match(render(tripCompletionBusinessDateSql()).sql, /::date/);
    assert.match(render(tripCompletionBusinessDateCompositeDateSql).sql, /::date/);
  });

  it('columns stay pinned: trips.completed_at for plain twins, trips_composite for composite twins', () => {
    assert.match(render(tripCompletionBusinessDateTextSql).sql, /"trips"\."completed_at"/);
    assert.match(render(tripCompletionBusinessDateSql()).sql, /"trips"\."completed_at"/);
    assert.match(render(tripCompletionBusinessDateCompositeTextSql).sql, /"trips_composite"\."completed_at"/);
    assert.match(render(tripCompletionBusinessDateCompositeDateSql).sql, /"trips_composite"\."completed_at"/);
  });
});

const SERVICE_DIR = path.resolve(import.meta.dirname, '../../services');
const REGISTER = readFileSync(path.join(SERVICE_DIR, 'accounting-transport-register.service.ts'), 'utf8');
const DRAFT = readFileSync(path.join(SERVICE_DIR, 'billing-document-draft.service.ts'), 'utf8');
const INVARIANTS = readFileSync(path.join(SERVICE_DIR, 'billing-document-invariants.service.ts'), 'utf8');

// A completedAt followed by a single VN at-time-zone with NO UTC arm in between
// is exactly the SIL-683 defect. The law imports carry the chain; the scan
// forbids re-hand-rolling it.
const SINGLE_CHAIN_OVER_COMPLETED_AT = /completedAt[^;`]*?at time zone 'Asia\/Ho_Chi_Minh'/;

describe('defect-class source scan — no hand-rolled single VN chain over completedAt (SIL-683)', () => {
  it('transport register uses the shared law expression', () => {
    assert.match(REGISTER, /import \{ tripCompletionBusinessDateTextSql \} from '\.\/reporting-shared'/);
    assert.match(REGISTER, /const completionBusinessDate = tripCompletionBusinessDateTextSql;/);
    assert.doesNotMatch(REGISTER, SINGLE_CHAIN_OVER_COMPLETED_AT);
  });

  it('debit-note draft uses the shared law expressions everywhere', () => {
    assert.match(DRAFT, /tripCompletionBusinessDateCompositeDateSql/);
    assert.match(DRAFT, /tripCompletionBusinessDateCompositeTextSql/);
    assert.doesNotMatch(DRAFT, SINGLE_CHAIN_OVER_COMPLETED_AT);
  });

  it('billing-document invariants use the shared law expressions', () => {
    assert.match(INVARIANTS, /tripCompletionBusinessDateTextSql/);
    assert.match(INVARIANTS, /tripCompletionBusinessDateCompositeTextSql/);
    assert.doesNotMatch(INVARIANTS, SINGLE_CHAIN_OVER_COMPLETED_AT);
  });
});
