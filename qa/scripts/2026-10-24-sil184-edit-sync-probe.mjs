// SIL-184 — QA integration probe (LOCAL ONLY, worktree BE :3092 + ss-prod-db).
// Sửa tờ khai inline tại chỗ phải ĐỒNG BỘ CẢ LÔ (CUS-05, QA R42: sửa cont A
// mà cont B giữ số cũ = lỗi): sibling đang giữ CHÍNH SỐ CŨ đi theo bản sửa;
// sibling có số KHÁC (divergence chủ đích) không bị đụng; clear vẫn local.
// Run: API=http://localhost:3092/api node qa/scripts/2026-10-24-sil184-edit-sync-probe.mjs
import { execSync } from 'node:child_process';

const API = process.env.API ?? 'http://localhost:3092/api';
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

const quickLot = async (suffix) => (await jf('/shipments/quick', { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({
  customerId: cust.id, tradeDirection: 'IMPORT', blNumber: `SIL184${suffix}${stamp}`, shippingLineName: 'MAERSK',
  containers: [
    { containerNumber: '', containerTypeId: ct.id },
    { containerNumber: '', containerTypeId: ct.id },
    { containerNumber: '', containerTypeId: ct.id },
  ],
}) })).body?.id;

// ── FIXTURE: lô Q-184 3 cont; cont#1 = X (fan-out điền #2 #3 trống) ──────────
const sid = await quickLot('A');
check('FIXTURE lô Q-184 tạo', sid != null, `id=${sid}`);
let d = await det(sid);
const [c1, c2, c3] = d.containers;
const X = `Q-DECL-184-X-${stamp}`;
const setX = await lineUpdate(sid, c1.id, { expectedShipmentVersion: d.summary.version, declarationNumber: X });
check('FIXTURE cont#1 = X (fan-out điền trống)', setX.status === 200 && declRows(sid).every((v) => v === X), `status=${setX.status} db=[${declRows(sid).join('|')}]`);

// ── TC-SIL184-R1: SỬA cont#1 X→Y — cont#2 #3 (đang giữ X) phải theo ──────────
d = await det(sid);
const Y = `Q-DECL-184-Y-${stamp}`;
const editY = await lineUpdate(sid, c1.id, { expectedShipmentVersion: d.summary.version, declarationNumber: Y });
const syncedIds = editY.body?.declarationSync?.updatedContainerIds ?? [];
check('TC-SIL184-R1 sửa X→Y status 200', editY.status === 200, `status=${editY.status}`);
check('TC-SIL184-R1 declarationSync báo đúng 2 sibling', [c2.id, c3.id].every((id) => syncedIds.includes(id)) && syncedIds.length === 2, `synced=[${syncedIds.join(',')}] expect=[${c2.id},${c3.id}]`);
const reloaded = await det(sid);
const afterY = reloaded.containers.map((c) => c.declarationNumber ?? '<NULL>');
check('TC-SIL184-R1 RELOAD: cả lô mang Y (QA repro đã đóng)', afterY.every((v) => v === Y), `db=[${afterY.join('|')}]`);

// ── TC-SIL184-R3: divergence chủ đích — đường hợp lệ là clear-then-set ───────
// (Sửa trực tiếp Y→Z sẽ kéo sibling in-sync theo — đúng luật mới; muốn tách
// số riêng cho 1 cont phải CLEAR cont đó trước — clear luôn local — rồi mới
// đặt số mới, fan-out lúc đó chỉ fill ô trống.)
const Z = `Q-DECL-184-Z-${stamp}`;
d = await det(sid);
const clear3 = await lineUpdate(sid, c3.id, { expectedShipmentVersion: d.summary.version, declarationNumber: null });
check('FIXTURE clear cont#3 (local)', clear3.status === 200, `status=${clear3.status}`);
d = await det(sid);
const setZ = await lineUpdate(sid, c3.id, { expectedShipmentVersion: d.summary.version, declarationNumber: Z });
check('FIXTURE cont#3 = Z (divergence)', setZ.status === 200, `status=${setZ.status} synced=[${(setZ.body?.declarationSync?.updatedContainerIds ?? []).join(',')}]`);
const divergenceState = await det(sid);
const divMap = new Map(divergenceState.containers.map((c) => [c.id, c.declarationNumber ?? '<NULL>']));
check('FIXTURE trạng thái divergence: #1 #2 = Y, #3 = Z', divMap.get(c1.id) === Y && divMap.get(c2.id) === Y && divMap.get(c3.id) === Z, `[${[divMap.get(c1.id), divMap.get(c2.id), divMap.get(c3.id)].join('|')}]`);
d = await det(sid);
const W = `Q-DECL-184-W-${stamp}`;
const editW = await lineUpdate(sid, c1.id, { expectedShipmentVersion: d.summary.version, declarationNumber: W });
const reloaded2 = await det(sid);
const byId = new Map(reloaded2.containers.map((c) => [c.id, c.declarationNumber ?? '<NULL>']));
check('TC-SIL184-R3 sibling giữ số cũ (Y) đi theo W', byId.get(c2.id) === W, `cont#2=${byId.get(c2.id)}`);
check('TC-SIL184-R3 divergence Z KHÔNG bị ghi đè', byId.get(c3.id) === Z, `cont#3=${byId.get(c3.id)}`);
check('TC-SIL184-R3 declarationSync chỉ gồm cont#2', JSON.stringify((editW.body?.declarationSync?.updatedContainerIds ?? []).sort()) === JSON.stringify([c2.id].sort()), `synced=[${(editW.body?.declarationSync?.updatedContainerIds ?? []).join(',')}]`);

// ── TC-SIL184-R4: XÓA số trên cont#1 → chỉ #1 trống, #2 giữ W ────────────────
d = await det(sid);
const clear1 = await lineUpdate(sid, c1.id, { expectedShipmentVersion: d.summary.version, declarationNumber: null });
const reloaded3 = await det(sid);
const byId3 = new Map(reloaded3.containers.map((c) => [c.id, c.declarationNumber ?? '<NULL>']));
check('TC-SIL184-R4 clear status 200 + không fan-out', clear1.status === 200 && (clear1.body?.declarationSync?.updatedContainerIds ?? []).length === 0, `status=${clear1.status} synced=[${(clear1.body?.declarationSync?.updatedContainerIds ?? []).join(',')}]`);
check('TC-SIL184-R4 DB: #1 trống, #2 vẫn W', byId3.get(c1.id) === '<NULL>' && byId3.get(c2.id) === W, `[${[...byId3.values()].join('|')}]`);

const failed = results.filter((r) => !r.ok);
console.log(`\nSIL-184 probe: ${results.length - failed.length}/${results.length} PASS${failed.length ? ` — FAIL: ${failed.map((f) => f.id).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
