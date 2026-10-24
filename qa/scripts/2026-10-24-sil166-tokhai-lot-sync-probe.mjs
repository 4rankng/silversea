// SIL-166 — QA integration probe (LOCAL ONLY, make dev stack).
// Pins the lot-level tờ khai copy law end-to-end over the real API: a
// declaration written at LOT level (quick-create combined payload or the
// declarations routes the "Sửa thông tin lô" modal rides) must land on every
// still-EMPTY container row of the lot (FB-109 never-overwrite predicate),
// while per-container inline edit keeps its own 22/10 sync behavior.
// Run: node qa/scripts/2026-10-24-sil166-tokhai-lot-sync-probe.mjs
//      (env overrides: API, default http://localhost:3002/api)
import { execSync } from 'node:child_process';

const API = process.env.API ?? 'http://localhost:3002/api';
const PSQL_C = process.env.PSQL_CONTAINER ?? 'ss-prod-db';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function jf(path, opts) {
  const res = await fetch(`${API}${path}`, opts);
  let body = null; try { body = await res.json(); } catch { body = `<non-json ${res.status}>`; }
  return { status: res.status, body };
}
const auth = (t, e = {}) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...e });
const psql = (sql) => execSync(`docker exec ${PSQL_C} psql -U postgres -d silversea -qtAX -c ${JSON.stringify(sql)}`).toString().trim();

const results = [];
const check = (id, ok, detail) => { results.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} :: ${detail}`); };

let L = null;
for (let i = 0; i < 3 && !L?.token; i++) {
  const r = await jf('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) });
  try { L = r.body; } catch { L = null; }
  if (!L?.token) await sleep(1000);
}
if (!L?.token) { console.log('LOGIN FAILED'); process.exit(1); }
const T = L.token;
const key = () => crypto.randomUUID();

const boot = (await jf('/catalogs/bootstrap', { headers: auth(T) })).body;
const customers = (await jf('/customers?limit=5', { headers: auth(T) })).body;
const cust = (customers.items ?? customers.rows ?? customers)[0];
const ct = (boot.containerTypes ?? [])[0];
const stamp = Date.now().toString().slice(-6);

const det = (sid) => jf(`/shipments/cus-workspace/${sid}`, { headers: auth(T) }).then((r) => r.body);
const declRows = (sid) => psql(`select coalesce(declaration_number,'<NULL>') from shipment_containers where shipment_id=${sid} order by id`).split('\n').filter(Boolean);
const lineUpdate = (sid, cid, body) => jf(`/shipments/cus-workspace/${sid}/containers/${cid}`, { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify(body) });

// ── TC-SIL166-01: tạo lô 3 cont KÈM tờ khai mức lô (combined quick-create) ──
const TK1 = `TK166-${stamp}`;
const lot1 = await jf('/shipments/quick', { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({
  customerId: cust.id, tradeDirection: 'IMPORT', blNumber: `SIL166A${stamp}`, declarationNumber: TK1, shippingLineName: 'MAERSK',
  containers: [
    { containerNumber: '', containerTypeId: ct.id },
    { containerNumber: '', containerTypeId: ct.id },
    { containerNumber: '', containerTypeId: ct.id },
  ],
}) });
check('FIXTURE lot A (create + tờ khai)', lot1.status === 201, `status=${lot1.status} id=${lot1.body?.id}`);
const sidA = lot1.body.id;
const dA = await det(sidA);
check('TC-SIL166-01 detail: mọi cont nhận tờ khai lô',
  dA.containers.length === 3 && dA.containers.every((c) => (c.declarationNumber ?? '') === TK1),
  `api=[${dA.containers.map((c) => c.declarationNumber ?? '<NULL>').join('|')}]`);
check('TC-SIL166-01 DB: shipment_containers mang số', declRows(sidA).every((v) => v === TK1),
  `db=[${declRows(sidA).join('|')}]`);

// ── Lô B chưa có tờ khai — 2 cont đều TRỐNG số ──
const lotB = await jf('/shipments/quick', { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({
  customerId: cust.id, tradeDirection: 'IMPORT', blNumber: `SIL166B${stamp}`, shippingLineName: 'MAERSK',
  containers: [
    { containerNumber: '', containerTypeId: ct.id },
    { containerNumber: '', containerTypeId: ct.id },
  ],
}) });
check('FIXTURE lot B (chưa có tờ khai)', lotB.status === 201, `status=${lotB.status} id=${lotB.body?.id}`);
const sidB = lotB.body.id;
let dB = await det(sidB);
const versionBefore = dB.summary.version;

// TC-SIL166-02: thêm tờ khai MỨC LÔ (đúng API modal "Sửa thông tin lô") →
// cả 2 dòng trống nhận số
const LOT = `TK166-LOT-${stamp}`;
const declCreate = await jf(`/shipments/${sidB}/declarations`, { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({ declarationNumber: LOT, scope: 'SINGLE' }) });
check('TC-SIL166-02 POST declaration mức lô', declCreate.status === 201, `status=${declCreate.status} ${declCreate.status >= 400 ? JSON.stringify(declCreate.body).slice(0, 160) : ''}`);
dB = await det(sidB);
check('TC-SIL166-02 cả 2 cont trống nhận số mức lô',
  dB.containers.length === 2 && dB.containers.every((c) => (c.declarationNumber ?? '') === LOT),
  `api=[${dB.containers.map((c) => c.declarationNumber ?? '<NULL>').join('|')}]`);
check('TC-SIL166-02 DB: cả 2 dòng mang số mức lô', declRows(sidB).every((v) => v === LOT),
  `db=[${declRows(sidB).join('|')}]`);

// TC-SIL166-03: cont #1 xóa số (local act) → cont #1 trống, #2 giữ LOT.
// Sửa số mức lô sang LOT2 THEN chỉ dòng TRỐNG (#1) nhận số mới; #2 (đã có
// số) không bị ghi đè. Version tăng đúng 1 lần cho fan-out (luật
// copyCusShipmentContainerDeclaration) + 1 lần cho line-save clear.
dB = await det(sidB);
await lineUpdate(sidB, dB.containers[0].id, { expectedShipmentVersion: dB.summary.version, declarationNumber: null });
dB = await det(sidB);
check('TC-SIL166-03 clear #1 là hành động local',
  (dB.containers[0].declarationNumber ?? '') === '' && (dB.containers[1].declarationNumber ?? '') === LOT,
  `api=[${dB.containers.map((c) => c.declarationNumber ?? '<NULL>').join('|')}]`);
const LOT2 = `TK166-LOT2-${stamp}`;
const declId = declCreate.body?.id;
const declUpdate = await jf(`/shipments/${sidB}/declarations/${declId}`, { method: 'PUT', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({ declarationNumber: LOT2, scope: 'SINGLE' }) });
check('TC-SIL166-03 PUT declaration số mới', declUpdate.status === 200, `status=${declUpdate.status} ${declUpdate.status >= 400 ? JSON.stringify(declUpdate.body).slice(0, 160) : ''}`);
dB = await det(sidB);
check('TC-SIL166-03 chỉ dòng trống nhận số mới — divergence giữ nguyên',
  (dB.containers[0].declarationNumber ?? '') === LOT2 && (dB.containers[1].declarationNumber ?? '') === LOT,
  `api=[${dB.containers.map((c) => c.declarationNumber ?? '<NULL>').join('|')}]`);
check('TC-SIL166-03 DB: [LOT2, LOT]', declRows(sidB).join('|') === `${LOT2}|${LOT}`,
  `db=[${declRows(sidB).join('|')}]`);
check('TC-SIL166-03 version tăng đúng (2 line/fan-out write + 1 fan-out)',
  dB.summary.version === versionBefore + 3, `before=${versionBefore} after=${dB.summary.version}`);

// ── TC-SIL166-04: FB-109 inline edit per-cont KHÔNG hồi quy ──
const R4 = `TK166-R4-${stamp}`;
dB = await det(sidB);
const r4 = await lineUpdate(sidB, dB.containers[0].id, { expectedShipmentVersion: dB.summary.version, declarationNumber: R4 });
check('TC-SIL166-04 inline edit #1: không sibling trống → không báo sync',
  r4.status === 200 && r4.body?.declarationSync === undefined,
  `status=${r4.status} sync=${JSON.stringify(r4.body?.declarationSync ?? null)}`);
check('TC-SIL166-04a DB: #1=R4, #2 giữ LOT (không ghi đè)', declRows(sidB).join('|') === `${R4}|${LOT}`,
  `db=[${declRows(sidB).join('|')}]`);
// clear #2 rồi inline edit #1 số KHÁC → #2 nhận qua fan-out 22/10 (lần edit
// sau phải khác giá trị hiện có — identical echo không ghi, đúng luật)
dB = await det(sidB);
await lineUpdate(sidB, dB.containers[1].id, { expectedShipmentVersion: dB.summary.version, declarationNumber: null });
dB = await det(sidB);
const R4B = `TK166-R4B-${stamp}`;
const r4b = await lineUpdate(sidB, dB.containers[0].id, { expectedShipmentVersion: dB.summary.version, declarationNumber: R4B });
check('TC-SIL166-04b FB-109 sync tới sibling trống', r4b.status === 200 && r4b.body?.declarationSync?.updatedContainerIds?.length === 1,
  `status=${r4b.status} sync=${JSON.stringify(r4b.body?.declarationSync ?? null)}`);
check('TC-SIL166-04b DB: cả 2 dòng nhận R4B (divergence gộp lại)', declRows(sidB).every((v) => v === R4B),
  `db=[${declRows(sidB).join('|')}]`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
