// SIL-1151 (KB Ch.3 §3.4.2) — the "thiếu thông tin" status follows ONE
// criterion at container level: the row's own số tờ khai (có = ĐẦY ĐỦ /
// COMPLETE, không = VẪN THIẾU / MISSING). Pins the QA repro (card K3.60,
// build d08ecc75): rows with a tờ khai read MISSING while rows without one
// read COMPLETE, because the status computed from many fields and the
// declaration bit was lot-scoped. Endpoint-level gate over the REAL route +
// schema + service so projection and the informationStatus=MISSING queue can
// never drift apart again.
// Fixture shape mirrors cus-team-toggle-list-expansion.test.ts: a throwaway
// database, schema restored from the dev image, stub auth, tracked teardown.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import { Role } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';

const TMP_DB = `sil1151_status_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every import of db-touching modules.
process.env.DATABASE_URL = TMP_URL;

let sql: postgres.Sql;
let app: express.Express;
let server: Server;
let baseUrl: string;

let viewerId: number;
let customerId: number;

interface FlatRow {
  id: number;
  shipmentId: number;
  containerNumber: string | null;
  declarationNumber: string | null;
  isLotLevel?: boolean;
  informationStatus: 'COMPLETE' | 'MISSING';
  missingFields: Array<{ code: string; label: string }>;
}

async function rows(query: string): Promise<FlatRow[]> {
  const response = await fetch(`${baseUrl}/api/shipments/cus-workspace/containers${query}`);
  if (response.status !== 200) {
    assert.fail(`containers should succeed: ${await response.text()}`);
  }
  const body = await response.json() as { items: FlatRow[] };
  return body.items;
}

before(async () => {
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`CREATE DATABASE ${TMP_DB}`);
  await admin.end();
  const dump = execFileSync(
    'docker',
    ['exec', 'ss-prod-db', 'pg_dump', '-U', 'postgres', '-d', 'silversea', '--schema-only'],
    { encoding: 'utf8', timeout: 120000 },
  );
  const dumpSql = dump.split('\n').filter((line) => !line.startsWith('\\')).join('\n');
  const restore = postgres(TMP_URL);
  await restore.unsafe(dumpSql);
  await restore.end();
  sql = postgres(TMP_URL);

  const [viewer] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('sil1151-view', 'sil1151@test.vn', 'Trạng Thái Tờ Khai', 'x', 'CUS') returning id`;
  viewerId = viewer.id;
  const [customer] = await sql`insert into customers (name) values ('Khách SIL-1151') returning id`;
  customerId = customer.id;

  const insertLot = (code: string, cargoMode: string) => sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customerId}, ${cargoMode}, ${code}, 'PENDING_DATE', ${viewerId})
    returning id`;

  // FCL-A: two containers — only cont-1 carries its OWN số tờ khai. The old
  // lot-scoped bit cleared cont-2 through its sibling; the law is per row.
  const [lotA] = await insertLot('SIL1151-A', 'FCL');
  const lotAId = Number(lotA.id);
  const [cont1] = await sql`insert into shipment_containers (shipment_id, container_number, declaration_number)
    values (${lotAId}, 'SIL1151A0001', '5151515151') returning id`;
  const [cont2] = await sql`insert into shipment_containers (shipment_id, container_number)
    values (${lotAId}, 'SIL1151A0002') returning id`;

  // FCL-B: no container-level number anywhere, but the lot owns a declaration
  // ENTITY row — the entity must never clear a container row's own slot.
  const [lotB] = await insertLot('SIL1151-B', 'FCL');
  const lotBId = Number(lotB.id);
  const [contB] = await sql`insert into shipment_containers (shipment_id, container_number)
    values (${lotBId}, 'SIL1151B0001') returning id`;
  await sql`insert into shipment_declarations (shipment_id, declaration_number)
    values (${lotBId}, '5252525252')`;

  // LCL-C: the lot row's own number is the lot-level declaration entity.
  const [lotC] = await insertLot('SIL1151-C', 'LCL');
  const lotCId = Number(lotC.id);
  await sql`insert into shipment_declarations (shipment_id, declaration_number)
    values (${lotCId}, '5353535353')`;

  // LCL-D: no declaration at all — the QA's "container trống số" rows that
  // must read MISSING, never COMPLETE.
  const [lotD] = await insertLot('SIL1151-D', 'LCL');
  const lotDId = Number(lotD.id);

  void cont1; void cont2; void contB; void lotDId;

  // ── Real route stack: stub auth → shipments cus-workspace router ──
  // Dynamic imports on purpose (house pattern, see
  // cus-team-toggle-list-expansion.test.ts): app modules open their drizzle
  // pool at import time, so they must load only AFTER DATABASE_URL points at
  // the throwaway database above.
  const { cusWorkspaceRoutes } = await import('../routes/shipments/cus-workspace.routes');
  const { ApiError } = await import('../errors');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: AuthUser }).user = {
      userId: viewerId,
      username: 'sil1151-view',
      email: 'sil1151@test.vn',
      fullName: 'Trạng Thái Tờ Khai',
      role: Role.CUS,
    };
    next();
  });
  app.use('/api/shipments', cusWorkspaceRoutes);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const statusCode = err instanceof ApiError ? err.statusCode : 500;
    res.status(statusCode).json({ error: err instanceof Error ? err.message : 'Lỗi máy chủ' });
  });

  server = app.listen(0);
  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  server.once('listening', onListening);
  await listening;
  const address = server.address();
  if (address == null || typeof address === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await sql?.end();
  server?.close();
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await admin.end();
});

describe('SIL-1151 — informationStatus theo tờ khai cấp container (KB Ch.3 §3.4.2)', () => {
  test('mỗi dòng: declarationNumber có giá trị → COMPLETE, trống → MISSING', async () => {
    const items = await rows('?page=1&limit=50');
    assert.ok(items.length >= 4, `expected the four fixture rows, got ${items.length}`);
    for (const row of items) {
      const expected = row.declarationNumber ? 'COMPLETE' : 'MISSING';
      assert.equal(row.informationStatus, expected,
        `row ${row.containerNumber ?? row.shipmentId} (decl ${row.declarationNumber}) must read ${expected}`);
      assert.deepEqual(row.missingFields.map((field) => field.code),
        row.declarationNumber ? [] : ['DECLARATION']);
    }
  });

  test('tờ khai CỦA CONTAINER là luật — số của sibling/không xóa được VẪN THIẾU', async () => {
    const items = await rows('?page=1&limit=50');
    const withOwn = items.find((row) => row.containerNumber === 'SIL1151A0001');
    const withoutOwn = items.find((row) => row.containerNumber === 'SIL1151A0002');
    assert.equal(withOwn?.declarationNumber, '5151515151');
    assert.equal(withOwn?.informationStatus, 'COMPLETE');
    // Same lot, sibling carries 5151515151 — the row still lacks its own.
    assert.equal(withoutOwn?.declarationNumber, null);
    assert.equal(withoutOwn?.informationStatus, 'MISSING');
    // A lot-level declaration ENTITY never clears a container row either.
    const entityLotCont = items.find((row) => row.containerNumber === 'SIL1151B0001');
    assert.equal(entityLotCont?.declarationNumber, null);
    assert.equal(entityLotCont?.informationStatus, 'MISSING');
  });

  test('dòng lô LCL theo cùng luật: có số tờ khai cấp lô = COMPLETE, không = MISSING', async () => {
    const items = await rows('?page=1&limit=50');
    const lotRows = items.filter((row) => row.isLotLevel === true);
    assert.equal(lotRows.length, 2, `the two LCL lots, got ${JSON.stringify(lotRows.map((r) => r.shipmentId))}`);
    const withDecl = lotRows.find((row) => row.declarationNumber === '5353535353');
    assert.equal(withDecl?.informationStatus, 'COMPLETE');
    const withoutDecl = lotRows.find((row) => row.declarationNumber == null);
    assert.equal(withoutDecl?.informationStatus, 'MISSING',
      'an LCL lot row without tờ khai must never read COMPLETE');
  });

  test('hàng đợi informationStatus=MISSING khớp đúng chiếu — gồm cả dòng lô LCL', async () => {
    const all = await rows('?page=1&limit=50');
    const expected = all.filter((row) => row.informationStatus === 'MISSING')
      .map((row) => row.id).sort((a, b) => a - b);
    const queue = await rows('?page=1&limit=50&informationStatus=MISSING');
    assert.deepEqual(queue.map((row) => row.id).sort((a, b) => a - b), expected,
      'the SQL queue must return exactly the rows the projection marks MISSING');
    assert.ok(queue.some((row) => row.isLotLevel === true),
      'the queue includes declaration-less LCL lot rows (FCL-only scoping superseded)');
    assert.ok(queue.length > 0, 'the fixture guarantees missing-declaration rows');
  });
});
