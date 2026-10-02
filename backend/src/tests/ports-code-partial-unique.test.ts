// ports.code uniqueness is partial: only real codes on live rows collide.
// A legacy empty-string row used to landmine every create with an empty or
// absent code into a raw 500 (plain unique + '' row = instant collision).
// Proves: '' rows coexist, NULLs coexist, real duplicate codes still reject.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP_DB = `ports_code_test_${Date.now().toString(36)}`;
let sql: postgres.Sql;

before(async () => {
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`CREATE DATABASE ${TMP_DB}`);
  await admin.end();
  const dump = spawnSync('docker', ['exec', 'ss-prod-db', 'pg_dump', '-U', 'postgres', '-d', 'silversea', '--schema-only'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(dump.status, 0, 'schema dump must succeed (local docker required)');
  spawnSync('docker', ['exec', '-i', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', TMP_DB, '-q'], { input: dump.stdout, encoding: 'utf8', timeout: 180000 });
  sql = postgres('postgres://postgres:postgres@localhost:5441/' + TMP_DB);
  // The migration under test (idempotent: the schema copy already carries
  // the applied index — this replays it from scratch via DROP/CREATE IF).
  const content = readFileSync(path.join(backendRoot, 'drizzle/20260919210000_ports_code_partial_unique.sql'), 'utf8');
  for (const stmt of content.split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean)) {
    await sql.unsafe(stmt);
  }
});

after(async () => {
  if (sql) await sql.end();
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await admin.end();
});

describe('ports.code partial unique', () => {
  test('empty and absent codes coexist; real duplicates still reject', async () => {
    await sql`insert into ports (name, code) values ('pc-a', '')`;
    await sql`insert into ports (name, code) values ('pc-b', '')`;
    await sql`insert into ports (name) values ('pc-null')`;
    await sql`insert into ports (name) values ('pc-null-2')`;
    const dupes = await sql`select count(*)::int as n from ports where name like 'pc-%'`;
    assert.equal(dupes[0].n, 4, 'empty-string and NULL codes never collide');
    await sql`insert into ports (name, code) values ('pc-real', 'PCREAL')`;
    const again = await sql`insert into ports (name, code) values ('pc-real-2', 'PCREAL')`.then(() => false).catch((err) => err.code === '23505');
    assert.equal(again, true, 'a real duplicate code still rejects');
  });

  test('soft-deleted rows do not block code reuse', async () => {
    await sql`insert into ports (name, code, deleted_at) values ('pc-del', 'PCDEL', now())`;
    const reuse = await sql`insert into ports (name, code) values ('pc-del-2', 'PCDEL')`.then(() => true).catch(() => false);
    assert.equal(reuse, true, 'a soft-deleted row must not block reuse of its code');
  });
});
