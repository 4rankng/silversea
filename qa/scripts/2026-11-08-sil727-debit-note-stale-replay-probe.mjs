/**
 * SIL-727 stale-replay probe (QA integration — BE unit-only owner ruling
 * 2026-10-19: integration probes live here, never in backend/src/tests).
 *
 * Drives the REAL local stack (backend :3002, dev Postgres :5441) through the
 * QA repro shape:
 *   1. login hoapt → token;
 *   2. find a locked lot with no live debit-note claim;
 *   3. POST /api/shipments/debit-notes → 201 {id:N1};
 *   4. simulate the purge wave (billing_documents.deleted_at = now(),
 *      debit_note_lots.released_at = now() for N1) — the exact staging state
 *      that made the ca0e72b9-wave idempotency record hand out a dead id;
 *   5. POST the same selection again → MUST be 201 with a NEW live id (the
 *      stale-replay repair), never a dead replay;
 *   6. GET export?documentId=N2 → MUST be 200 xlsx bytes (never 'Không tìm
 *      thấy tài liệu');
 *   7. POST once more → MUST be 409 naming `#N2`.
 *
 * Run: node qa/scripts/2026-11-08-sil727-debit-note-stale-replay-probe.mjs
 */
import crypto from 'node:crypto';
import postgres from '../../backend/node_modules/postgres/src/index.js';

const BASE = process.env.PROBE_BASE ?? 'http://localhost:3002';
const DATABASE_URL = process.env.DEV_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5441/silversea';

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const sql = postgres(DATABASE_URL, { max: 1 });

async function main() {
  // 1. login
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }),
  });
  const loginBody = await login.json().catch(() => ({}));
  check('login hoapt', login.status === 200 && typeof loginBody.token === 'string', `status ${login.status} body ${JSON.stringify(loginBody).slice(0, 120)}`);
  const token = loginBody.token;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 2. a locked lot without a live claim
  const lotRows = await sql`
    select l.shipment_id as "shipmentId", s.shipment_code as "code"
    from shipment_cost_locks l
    join shipments s on s.id = l.shipment_id
    where l.unlocked_at is null and s.deleted_at is null
      and not exists (select 1 from debit_note_lots d where d.shipment_id = l.shipment_id and d.released_at is null)
    order by l.locked_at desc limit 1`;
  if (lotRows.length === 0) {
    check('seeded locked lot available', false, 'no locked lot in dev DB — seed one first');
    await sql.end();
    process.exit(1);
  }
  const lotId = lotRows[0].shipmentId;
  console.log(`... lot ${lotId} (${lotRows[0].code})`);

  // 3. issue note #1 — fresh transport key per click (the server derives the
  // authoritative consolidated key from the selection itself).
  const post = () => fetch(`${BASE}/api/shipments/debit-notes`, {
    method: 'POST', headers: { ...auth, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ shipmentIds: [lotId] }),
  });
  const r1 = await post();
  const b1 = await r1.json().catch(() => ({}));
  const n1 = b1.id;
  check('issue note #1 → 201 {id}', r1.status === 201 && Number.isInteger(n1), `status ${r1.status} body ${JSON.stringify(b1).slice(0, 120)}`);
  if (!Number.isInteger(n1)) { await finishImpl(); return; }

  // 4. simulate the purge wave that orphaned documentId 13 on staging
  await sql`update billing_documents set deleted_at = now(), updated_at = now() where id = ${n1}`;
  await sql`update debit_note_lots set released_at = now() where document_id = ${n1}`;

  // 5. re-export the same selection — the dead replay must repair
  const r2 = await post();
  const b2 = await r2.json().catch(() => ({}));
  const n2 = b2.id;
  check('re-export after purge → 201 NEW live id', r2.status === 201 && Number.isInteger(n2) && n2 !== n1, `status ${r2.status} id ${JSON.stringify(b2).slice(0, 120)}`);
  const live = await sql`select 1 from billing_documents where id = ${n2} and deleted_at is null`;
  check('re-issued document is live', live.length === 1);

  // 6. the file downloads
  const exp = await fetch(`${BASE}/api/shipments/${lotId}/debit-note/export?documentId=${n2}`, { headers: auth });
  const bytes = exp.headers.get('content-type')?.includes('spreadsheet') ? (await exp.arrayBuffer()).byteLength : 0;
  check('export GET 200 xlsx bytes', exp.status === 200 && bytes > 0, `status ${exp.status} bytes ${bytes}`);

  // 7. the third click hits the overlap 409 naming the note
  const r3 = await post();
  const t3 = await r3.text();
  check('third click → 409 naming #N', r3.status === 409 && t3.includes(`#${n2}`), `status ${r3.status} body ${t3.slice(0, 200)}`);

  await finishImpl();
}

async function finishImpl() {
  await sql.end();
  if (failures.length > 0) {
    console.error(`PROBE FAIL — ${failures.length} step(s): ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('PROBE PASS — stale replay repairs to a live document; overlap 409 names the note.');
}

main().catch((cause) => { console.error('PROBE ERROR', cause); process.exit(1); });
