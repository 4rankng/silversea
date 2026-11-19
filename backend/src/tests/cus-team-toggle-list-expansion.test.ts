// SIL-851 (2) — endpoint-level gate for the [Hiện thông tin lô hàng team]
// toggle on GET /api/shipments/cus-workspace (the /shipments list CUS calls):
// team=true widens to the ACTIVE group's creators' lots; team off stays
// own-only (+ the NULL/non-CUS-creator fallback arms, both modes); the
// widening COLLAPSES when the group is INACTIVE — the exact mechanism behind
// the QA "regression" round: the only groups on staging (probe 'QA Team 1/2')
// were deactivated between rounds, so the toggle had nothing to widen to.
// The query law itself is unit-pinned (cus-visibility.test.ts); this gate
// exercises the REAL route + schema + service so the wire contract (team
// param survives the zod schema, total + creatorCode per row) cannot drift.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import { Role } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';

const TMP_DB = `cus_team_toggle_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every import of db-touching modules (see
// cus-write-audit-field-diff.test.ts) — app modules import dynamically in before().
process.env.DATABASE_URL = TMP_URL;

let sql: postgres.Sql;
let app: express.Express;
let server: Server;
let baseUrl: string;

let viewerId: number;
let teammateId: number;
let opsId: number;
let customerId: number;
let groupId: number;
let ownLotA: number;
let ownLotB: number;
let teammateLots: number[];
let opsLot: number;

/** Which seeded user the stub auth layer hands to the stack for the next request. */
let actingUser: { id: number; username: string; fullName: string };

interface ListResponse {
  total: number;
  items: Array<{ id: number; creatorCode: string | null }>;
}

async function list(query: string): Promise<ListResponse> {
  const response = await fetch(`${baseUrl}/api/shipments/cus-workspace${query}`);
  if (response.status !== 200) {
    assert.fail(`list should succeed: ${await response.text()}`);
  }
  return await response.json() as ListResponse;
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
    values ('thanh-view', 'thanh@test.vn', 'Đinh Thành Viên', 'x', 'CUS') returning id`;
  viewerId = viewer.id;
  const [teammate] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('tiep-team', 'tiep@test.vn', 'Vũ Văn Đội', 'x', 'CUS') returning id`;
  teammateId = teammate.id;
  const [ops] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('ops-creator', 'ops@test.vn', 'Ops Tạo Lô', 'x', 'OPS') returning id`;
  opsId = ops.id;
  const [customer] = await sql`insert into customers (name) values ('Khách team-toggle') returning id`;
  customerId = customer.id;
  const [group] = await sql`insert into cus_groups (name, status) values ('team-toggle-team', 'ACTIVE') returning id`;
  groupId = group.id;
  await sql`insert into cus_group_members (group_id, user_id) values (${groupId}, ${viewerId}), (${groupId}, ${teammateId})`;

  const insertLot = (code: string, createdBy: number) => sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customerId}, 'FCL', ${code}, 'PENDING_DATE', ${createdBy})
    returning id`;
  ownLotA = Number((await insertLot('TEAM-A-1', viewerId))[0].id);
  ownLotB = Number((await insertLot('TEAM-A-2', viewerId))[0].id);
  teammateLots = [
    Number((await insertLot('TEAM-B-1', teammateId))[0].id),
    Number((await insertLot('TEAM-B-2', teammateId))[0].id),
    Number((await insertLot('TEAM-B-3', teammateId))[0].id),
  ];
  opsLot = Number((await insertLot('TEAM-OPS-1', opsId))[0].id);

  // ── Real route stack: stub auth → shipments cus-workspace router ──
  const { cusWorkspaceRoutes } = await import('../routes/shipments/cus-workspace.routes');
  const { ApiError } = await import('../errors');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const actor = actingUser;
    (req as express.Request & { user?: AuthUser }).user = {
      userId: actor.id,
      username: actor.username,
      email: `${actor.username}@test.vn`,
      fullName: actor.fullName,
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
  // WITH (FORCE): the imported routers' drizzle pool still holds sockets —
  // same teardown as cus-write-audit-field-diff.test.ts.
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await admin.end();
});

function asViewer(): void {
  actingUser = { id: viewerId, username: 'thanh-view', fullName: 'Đinh Thành Viên' };
}

describe('CUS team toggle — GET /shipments/cus-workspace expansion law (SIL-851)', () => {
  test('toggle OFF: own lots + the non-CUS-creator fallback lot, NOT the teammate lots', async () => {
    asViewer();
    const page = await list('');
    assert.equal(page.total, 3, `own 2 + ops-created 1: ${JSON.stringify(page)}`);
    const ids = page.items.map((item) => item.id).sort((a, b) => a - b);
    assert.deepEqual(ids, [ownLotA, ownLotB, opsLot].sort((a, b) => a - b));
  });

  test('toggle ON (team=true): the ACTIVE teammate lots appear with creatorCode per row', async () => {
    asViewer();
    const page = await list('?team=true');
    assert.equal(page.total, 6, `own 2 + teammate 3 + ops 1: ${JSON.stringify(page)}`);
    const creatorByLot = Object.fromEntries(page.items.map((item) => [item.id, item.creatorCode]));
    for (const lot of teammateLots) {
      assert.equal(creatorByLot[lot], 'tiep-team', `teammate lot ${lot} must ride creatorCode tiep-team`);
    }
    assert.equal(creatorByLot[ownLotA], 'thanh-view');
  });

  test('teammate private lot search: team=true finds it, team off does not (QA repro MSCU7712000111)', async () => {
    asViewer();
    const found = await list('?team=true&searchSuffix=TEAM-B-2');
    assert.equal(found.total, 1);
    assert.equal(found.items[0]?.id, teammateLots[1]);
    const withoutTeam = await list('?searchSuffix=TEAM-B-2');
    assert.equal(withoutTeam.total, 0);
  });

  test('group INACTIVE: team=true collapses back to own-only — the QA data root cause', async () => {
    asViewer();
    await sql`update cus_groups set status = 'INACTIVE' where id = ${groupId}`;
    const page = await list('?team=true');
    assert.equal(page.total, 3, `no ACTIVE group → arm 2 empty → own + fallback: ${JSON.stringify(page)}`);
  });
});
