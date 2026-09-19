// The alignment migration (drizzle/20260919213000_align_expense_type_invoice_policy.sql)
// flips only live rows still carrying the exact untouched seed signature of
// the five invoice-bearing ops types — seed-heritage drift, not admin
// intent. Admin-customized rows, half-customized rows, soft-deleted rows,
// and out-of-scope codes keep their shape. The pin runs the file's own
// UPDATE against a throwaway DB seeded with a schema-only dump of dev.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP_DB = `expense_align_pin_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
const MIGRATION = '20260919213000_align_expense_type_invoice_policy.sql';
const DEFAULT_EVIDENCE = JSON.stringify(['RECEIPT', 'BANK_TRANSFER', 'ONSITE_PHOTO', 'SIGNED_CONFIRMATION']);

let sql: postgres.Sql;

before(async () => {
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`CREATE DATABASE ${TMP_DB}`);
  await admin.end();
  const dump = spawnSync('docker', ['exec', 'ss-prod-db', 'pg_dump', '-U', 'postgres', '-d', 'silversea', '--schema-only'], {
    encoding: 'utf8', timeout: 120000,
  });
  assert.equal(dump.status, 0, 'schema dump must succeed (local docker required)');
  const restore = spawnSync('docker', ['exec', '-i', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', TMP_DB, '-q'], {
    input: dump.stdout, encoding: 'utf8', timeout: 180000,
  });
  assert.equal(restore.status, 0, 'schema restore must succeed');
  sql = postgres(TMP_URL);
  // Five fixtures spanning the guard: (drifted → flips), (drifted but
  // soft-deleted → stays), (admin-aligned → stays), (half-customized →
  // stays), (drifted out-of-scope code → stays).
  const mk = (code: string, req: boolean, sub: boolean, deleted = false) => sql`
    insert into forwarder_expense_types (code, name, requires_invoice, substitute_evidence_allowed, no_invoice_evidence_types, deleted_at)
    values (${code}, ${'Pin ' + code}, ${req}, ${sub}, ${DEFAULT_EVIDENCE}::jsonb, ${deleted ? new Date() : null})`;
  await mk('LIFTING', false, true);
  await mk('LOWERING', false, true, true);
  await mk('WEIGHING', true, false);
  await mk('INFRASTRUCTURE', false, false);
  await mk('OTHER', false, true);

  const content = readFileSync(path.join(backendRoot, 'drizzle', MIGRATION), 'utf8');
  const statements = content.split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);
  assert.equal(statements.length, 1, 'the alignment migration is a single guarded UPDATE');
  for (const stmt of statements) await sql.unsafe(stmt);
});

after(async () => {
  if (sql) await sql.end();
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await admin.end();
});

describe('expense type invoice policy alignment', () => {
  test('only live drifted seed-default rows flip; every guarded shape stays', async () => {
    const rows = await sql`
      select code, requires_invoice as "requiresInvoice", substitute_evidence_allowed as "subAllowed", no_invoice_evidence_types as "evidence"
      from forwarder_expense_types where code in ('LIFTING','LOWERING','WEIGHING','INFRASTRUCTURE','OTHER')`;
    const byCode = new Map(rows.map((r) => [r.code, r]));
    // postgres.js hands the jsonb back as a string on this connection's
    // protocol path; the invariant is the content, so normalize both sides.
    const asArray = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);
    const evidenceOf = (code: string) => asArray(byCode.get(code)?.evidence);
    const lifting = byCode.get('LIFTING');
    assert.equal(lifting?.requiresInvoice, true, 'drifted live LIFTING flips to invoice-required');
    assert.equal(lifting?.subAllowed, false, 'substitute evidence closes on the flipped row');
    assert.deepEqual(evidenceOf('LIFTING'), [], 'evidence types clear on the flipped row');
    const lowering = byCode.get('LOWERING');
    assert.equal(lowering?.requiresInvoice, false, 'soft-deleted drifted row stays untouched');
    assert.equal(lowering?.subAllowed, true, 'soft-deleted drifted row keeps substitute evidence');
    const weighing = byCode.get('WEIGHING');
    assert.equal(weighing?.requiresInvoice, true, 'admin-aligned row is not rewritten');
    assert.deepEqual(evidenceOf('WEIGHING'), ['RECEIPT', 'BANK_TRANSFER', 'ONSITE_PHOTO', 'SIGNED_CONFIRMATION'], 'admin row keeps its evidence list');
    const infra = byCode.get('INFRASTRUCTURE');
    assert.equal(infra?.requiresInvoice, false, 'half-customized row stays untouched');
    assert.equal(infra?.subAllowed, false, 'half-customized row keeps admin shape');
    const other = byCode.get('OTHER');
    assert.equal(other?.requiresInvoice, false, 'out-of-scope drifted code stays untouched');
    assert.equal(other?.subAllowed, true, 'out-of-scope drifted code keeps substitute evidence');
  });
});
