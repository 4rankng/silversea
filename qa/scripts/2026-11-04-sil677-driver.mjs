// SIL-677 — HTTP driver: POST /api/trips/:id/copy trên trip live thuộc lô.
//
// Chạy với backend boot TỪ WORKTREE NÀY (cùng branch code với fix), ví dụ:
//   cd backend && PORT=3102 DATABASE_URL='postgres://postgres:postgres@localhost:5441/silversea' pnpm dev
//   node qa/scripts/2026-11-04-sil677-driver.mjs http://localhost:3102/api <phase>
//     phase = "before" | "after"
//
// 4 nhánh:
//   pair-active (live, active_trip_pair_id NOT NULL)
//   có-fulfillment (live, fulfillment_id NOT NULL)
//   lot-linked-thường (live, shipment_id NOT NULL + fulfillment NULL)
//   canceled-lot (fixture: source tạm CANCELED — law SIL-655 giữ lot link)
//
// Kỳ vọng:
//   before: 3 nhánh live KHÔNG copy được (4xx/5xx — ghi nhận status thật);
//           canceled-lot vẫn 201 + kế thừa shipment_id (hành vi SIL-655).
//   after:  3 nhánh live 201 + bản copy DETACH (shipment_id/fulfillment_id/
//           active_trip_pair_id+order NULL, status CREATED); canceled-lot
//           201 + kế thừa lot link như trước (không regress).
// Cleanup mọi nhánh: xóa row copy (containers, legs, sidecars, audit) rồi mới
// trả source về trạng thái cũ (nhánh canceled phải xóa copy TRƯỚC khi restore —
// copy chiếm slot live duy nhất của lô).
import { execSync } from 'node:child_process';

const BASE = process.argv[2] || 'http://localhost:3102/api';
const PHASE = process.argv[3] || 'after';
const PSQL_C = process.env.PSQL_CONTAINER ?? 'ss-prod-db';
const psql = (sql) => execSync(
  `docker exec ${PSQL_C} psql -U postgres -d silversea -qtAX -c ${JSON.stringify(sql.replace(/\s+/g, ' ').trim())}`,
).toString().trim();

const results = [];
const check = (id, ok, detail) => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      // material-write gate: mọi POST ghi dữ liệu bắt buộc mang key.
      'Idempotency-Key': `sil677-${PHASE}-${Math.random().toString(36).slice(2, 10)}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON (error page) — keep text */ }
  return { status: res.status, json, text: text.slice(0, 300) };
}

const LOCK_GUARD = `AND NOT EXISTS (SELECT 1 FROM shipment_accounting_locks l WHERE l.shipment_id = t.shipment_id)`;
const BRANCHES = [
  { key: 'pair-active', where: `t.active_trip_pair_id IS NOT NULL` },
  { key: 'co-fulfillment', where: `t.fulfillment_id IS NOT NULL AND t.active_trip_pair_id IS NULL` },
  { key: 'lot-linked-thuong', where: `t.shipment_id IS NOT NULL AND t.fulfillment_id IS NULL AND t.active_trip_pair_id IS NULL` },
];

function pickSource(extraWhere) {
  const row = psql(`
    SELECT t.id, t.shipment_id, t.fulfillment_id, t.status, count(tc.id)
    FROM trips t LEFT JOIN trip_containers tc ON tc.trip_id = t.id
    WHERE t.deleted_at IS NULL AND t.status <> 'CANCELED' ${LOCK_GUARD} AND ${extraWhere}
    GROUP BY t.id, t.shipment_id, t.fulfillment_id, t.status
    ORDER BY t.id DESC LIMIT 1`).split('|');
  return row.length === 5 && row[0] ? { id: Number(row[0]), shipmentId: row[1], fulfillmentId: row[2], status: row[3], containers: Number(row[4]) } : null;
}

function deleteCopy(tripId) {
  psql(`DELETE FROM trip_containers WHERE trip_id=${tripId}`);
  psql(`DELETE FROM trip_legs WHERE trip_id=${tripId}`);
  psql(`DELETE FROM trip_financial_state WHERE trip_id=${tripId}`);
  psql(`DELETE FROM trip_carrier_info WHERE trip_id=${tripId}`);
  psql(`DELETE FROM audit_logs WHERE entity_type='trip' AND entity_id=${tripId}`);
  psql(`DELETE FROM trips WHERE id=${tripId}`);
}

// ── login ────────────────────────────────────────────────────────────────────
const login = await call('POST', '/auth/login', null, { identifier: 'admin', password: 'Abc123' });
check('login', login.status === 200 && login.json?.token, `POST /auth/login → ${login.status}`);
if (login.status !== 200) process.exit(1);
const token = login.json.token;

// ── 3 nhánh live: copy phải detach hoặc từ chối có message — không 500 ───────
let live5xx = 0;
for (const branch of BRANCHES) {
  const src = pickSource(branch.where);
  if (!src) { check(`${branch.key}.fixture`, false, 'không tìm thấy seed trip phù hợp'); continue; }
  const res = await call('POST', `/trips/${src.id}/copy`, token);
  console.log(`  [${PHASE}] ${branch.key}: trip ${src.id} (shipment=${src.shipmentId} fulfillment=${src.fulfillmentId}) → HTTP ${res.status} ${res.text.slice(0, 160)}`);

  if (PHASE === 'before') {
    const notCreated = res.status !== 201 && res.status !== 200;
    if (res.status >= 500) live5xx += 1;
    check(`${branch.key}.before-not-created`, notCreated, `HTTP ${res.status} (copy chưa hoạt động trước fix)`);
    if (res.json?.id) deleteCopy(res.json.id); // phòng khi 2xx bất ngờ
  } else {
    const created = res.status === 201 && Number.isInteger(res.json?.id);
    check(`${branch.key}.after-201`, created, `HTTP ${res.status} (expect 201 — copy hoạt động)`);
    if (!created) continue;
    const copyId = res.json.id;
    const cols = psql(`SELECT coalesce(shipment_id::text,'NULL'), coalesce(fulfillment_id::text,'NULL'), coalesce(active_trip_pair_id::text,'NULL'), coalesce(active_trip_pair_order::text,'NULL'), status FROM trips WHERE id=${copyId}`).split('|');
    check(`${branch.key}.after-detached`,
      cols[0] === 'NULL' && cols[1] === 'NULL' && cols[2] === 'NULL' && cols[3] === 'NULL' && cols[4] === 'CREATED',
      `copy#${copyId}: shipment=${cols[0]} fulfillment=${cols[1]} pair=${cols[2]}/${cols[3]} status=${cols[4]} (expect NULL×4 + CREATED)`);
    // SIL-655 line law: bridge columns carried, numbers/seals reset.
    if (src.containers > 0) {
      const [srcLinked, copyLinked, copyNumbered] = [
        Number(psql(`SELECT count(*) FROM trip_containers WHERE trip_id=${src.id} AND source_shipment_container_id IS NOT NULL`)),
        Number(psql(`SELECT count(*) FROM trip_containers WHERE trip_id=${copyId} AND source_shipment_container_id IS NOT NULL`)),
        Number(psql(`SELECT count(*) FROM trip_containers WHERE trip_id=${copyId} AND (container_number IS NOT NULL OR seal_number IS NOT NULL)`)),
      ];
      check(`${branch.key}.after-line-law`, copyLinked === srcLinked && copyNumbered === 0,
        `bridge cols: source ${srcLinked} → copy ${copyLinked}; numbered/sealed copy rows=${copyNumbered} (expect 0)`);
    }
    deleteCopy(copyId);
    const residual = psql(`SELECT count(*) FROM trips WHERE id=${copyId}`);
    check(`${branch.key}.cleanup`, residual === '0', `bản copy probe đã xóa (residual=${residual})`);
  }
}

// ── nhánh canceled-lot: law SIL-655 — 201 + kế thừa lot link (both phases) ───
const csrc = pickSource(`t.shipment_id IS NOT NULL`);
if (csrc) {
  psql(`UPDATE trips SET status='CANCELED', updated_at=now() WHERE id=${csrc.id}`);
  let cres = null; let copyId = null;
  try {
    cres = await call('POST', `/trips/${csrc.id}/copy`, token);
    console.log(`  [${PHASE}] canceled-lot: trip ${csrc.id} → HTTP ${cres.status} ${cres.text.slice(0, 160)}`);
    const created = cres.status === 201 && Number.isInteger(cres.json?.id);
    check(`canceled-lot.${PHASE}-201`, created, `HTTP ${cres.status} (law SIL-655 arm SourceCanceled giữ nguyên)`);
    if (created) {
      copyId = cres.json.id;
      const cols = psql(`SELECT coalesce(shipment_id::text,'NULL'), status FROM trips WHERE id=${copyId}`).split('|');
      check(`canceled-lot.${PHASE}-keeps-lot-link`, cols[0] === String(csrc.shipmentId),
        `copy#${copyId}: shipment_id=${cols[0]} expect ${csrc.shipmentId} (p2.copy-stays-lot-linked)`);
      check(`canceled-lot.${PHASE}-created-status`, cols[1] === 'CREATED', `copy status=${cols[1]}`);
    }
  } finally {
    if (copyId != null) deleteCopy(copyId); // TRƯỚC khi restore — copy chiếm slot live
    psql(`UPDATE trips SET status='${csrc.status}', updated_at=now() WHERE id=${csrc.id}`);
  }
  const restored = psql(`SELECT status FROM trips WHERE id=${csrc.id}`);
  check(`canceled-lot.restored`, restored === csrc.status, `fixture undone: trip ${csrc.id} status=${restored}`);
}

if (PHASE === 'before') {
  console.log(`\nSUMMARY(before): live branches hitting 5xx = ${live5xx}/3 (ticket reported 500 chưa bắt)`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${PHASE.toUpperCase()}: ${results.length - failed.length}/${results.length} checks pass`);
process.exit(failed.length ? 1 : 0);
