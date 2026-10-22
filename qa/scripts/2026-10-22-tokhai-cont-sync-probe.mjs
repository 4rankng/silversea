// Card 261022095235a/b — QA integration probe (LOCAL ONLY).
// Pins the CUS-05 sync law end-to-end over the real API the shared ledger
// rides, plus the container add/remove/change flows on a lot whose first
// row was seeded DIRTY (wrong container number — the customer's flow).
// Run: node qa/scripts/2026-10-22-tokhai-cont-sync-probe.mjs
//      (API env overrides; default http://localhost:3005/api — worktree stack)
import { execSync } from 'node:child_process';

const API = process.env.API ?? 'http://localhost:3005/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function jf(path, opts) {
  const res = await fetch(`${API}${path}`, opts);
  let body = null; try { body = await res.json(); } catch { body = `<non-json ${res.status}>`; }
  return { status: res.status, body };
}
const auth = (t, e = {}) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...e });
const psql = (sql) => execSync(`docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c ${JSON.stringify(sql)}`).toString().trim();

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

// ── Fixture: lô NHẬP 3 cont — #1 số bẩn (khách nhập sai), #2 #3 trống số ──
const boot = (await jf('/catalogs/bootstrap', { headers: auth(T) })).body;
const customers = (await jf('/customers?limit=5', { headers: auth(T) })).body;
const cust = (customers.items ?? customers.rows ?? customers)[0];
const ct = (boot.containerTypes ?? [])[0];
const stamp = Date.now().toString().slice(-5);
const created = await jf('/shipments/quick', { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({
  customerId: cust.id, tradeDirection: 'IMPORT', blNumber: `HAGHTB299${stamp}`, shippingLineName: 'MAERSK',
  containers: [
    { containerNumber: '', containerTypeId: ct.id },
    { containerNumber: '', containerTypeId: ct.id },
    { containerNumber: '', containerTypeId: ct.id },
  ],
}) });
check('FIXTURE create 3-cont lot', created.status === 201, `status=${created.status} id=${created.body?.id}`);
const sid = created.body.id;
// Gây bẩn dòng #1 đúng dạng khách: số cont sai check digit (tạo trước era gate).
const cids = psql(`select id from shipment_containers where shipment_id=${sid} order by id`).split('\n').filter(Boolean);
psql(`update shipment_containers set container_number='MSKU1234560' where id=${cids[0]}`);
console.log(`fixture: lot=${sid} rows=${cids.join(',')} — row#1 seeded dirty MSKU1234560 (bad check digit)`);

const det = () => jf(`/shipments/cus-workspace/${sid}`, { headers: auth(T) }).then((r) => r.body);
const lineUpdate = (cid, body) => jf(`/shipments/cus-workspace/${sid}/containers/${cid}`, { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify(body) });

// TOKHAI-R2: sửa tờ khai cont #1 (đang có số cont bẩn) → #2 #3 trống nhận cùng số
let d = await det();
const r2 = await lineUpdate(cids[0], { expectedShipmentVersion: d.summary.version, declarationNumber: `HAGHTB29700-${stamp}` });
check('TOKHAI-R2 sync fan-out reported', r2.status === 200 && r2.body?.declarationSync?.updatedContainerIds?.length === 2,
  `status=${r2.status} sync=${JSON.stringify(r2.body?.declarationSync?.updatedContainerIds ?? null)}`);
d = await det();
check('TOKHAI-R2 persisted siblings', d.containers.every((c) => (c.declarationNumber ?? '') === `HAGHTB29700-${stamp}`),
  d.containers.map((c) => c.declarationNumber).join('|'));

// TOKHAI-R3: #2 đặt số KHÁC → sửa lại #1 không ghi đè #2 (divergence)
d = await det();
const r3set = await lineUpdate(cids[1], { expectedShipmentVersion: d.summary.version, declarationNumber: `TK-RIENG-${stamp}` });
check('TOKHAI-R3 set #2 own number', r3set.status === 200, `status=${r3set.status}`);
d = await det();
const r3again = await lineUpdate(cids[0], { expectedShipmentVersion: d.summary.version, declarationNumber: `HAGHTB29700-${stamp}-NEW` });
check('TOKHAI-R3 #1 update ok', r3again.status === 200, `status=${r3again.status} sync=${r3again.body?.declarationSync?.updatedContainerIds?.length ?? 0}`);
d = await det();
check('TOKHAI-R3 divergence preserved', (d.containers[1].declarationNumber ?? '') === `TK-RIENG-${stamp}`,
  d.containers.map((c) => c.declarationNumber).join('|'));

// TOKHAI-R2b: clear #3 rồi nhập lại → copy chỉ tới ô trống
d = await det();
await lineUpdate(cids[2], { expectedShipmentVersion: d.summary.version, declarationNumber: null });
d = await det();
check('TOKHAI-R2b clear #3 local', (d.containers[2].declarationNumber ?? '') === '' && (d.containers[1].declarationNumber ?? '') === `TK-RIENG-${stamp}`,
  d.containers.map((c) => c.declarationNumber ?? '').join('|'));

// Card B: đổi số cont bẩn #1 → số hợp lệ (đúng flow khách sửa)
d = await det();
const fix = await lineUpdate(cids[0], { expectedShipmentVersion: d.summary.version, containerNumber: 'MSKU1234565' });
check('CARDB fix dirty cont number', fix.status === 200, `status=${fix.status} ${fix.status >= 400 ? JSON.stringify(fix.body).slice(0, 160) : 'new=' + fix.body?.line?.raw?.containerNumber}`);

// Card B: THÊM cont mới trên lô (tờ khai kế thừa lot default — A.1+A.6)
d = await det();
const add = await jf(`/shipments/cus-workspace/${sid}/containers`, { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({ expectedShipmentVersion: d.summary.version, containerNumber: 'CSQU3054383' }) });
check('CARDB add container', add.status === 201, `status=${add.status}`);
d = await det();
check('CARDB added row inherits declaration', (d.containers[3]?.declarationNumber ?? 'MISSING') === `HAGHTB29700-${stamp}-NEW`,
  `added decl=${d.containers[3]?.declarationNumber}`);

// Card B: XÓA cont vừa thêm
d = await det();
const addedId = d.containers[3]?.id;
const rm = await jf(`/shipments/cus-workspace/${sid}/containers/${addedId}/remove`, { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({ expectedShipmentVersion: d.summary.version }) });
check('CARDB remove container', rm.status === 200, `status=${rm.status}`);

// Cross-lot uniqueness: số tờ khai thuộc lô khác bị từ chối
const other = await jf('/shipments/quick', { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({
  customerId: cust.id, tradeDirection: 'IMPORT', blNumber: `HAGHTB299${stamp}B`,
  containers: [{ containerNumber: 'CSQU3054383', containerTypeId: ct.id }],
}) });
check('FIXTURE other lot', other.status === 201, `status=${other.status} ${other.status >= 400 ? JSON.stringify(other.body).slice(0, 160) : ''}`);
const otherId = other.body.id;
const otherDetail = () => jf(`/shipments/cus-workspace/${otherId}`, { headers: auth(T) }).then((r) => r.body);
const otherLineUpdate = (cid, body) => jf(`/shipments/cus-workspace/${otherId}/containers/${cid}`, { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify(body) });
let od = await otherDetail();
await otherLineUpdate(od.containers[0].id, { expectedShipmentVersion: od.summary.version, declarationNumber: 'OTHERLOT-TK' });
d = await det();
const steal2 = await lineUpdate(cids[2], { expectedShipmentVersion: d.summary.version, declarationNumber: 'OTHERLOT-TK' });
check('TOKHAI cross-lot duplicate rejected', steal2.status === 409, `status=${steal2.status} ${steal2.body?.error ?? ''}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
