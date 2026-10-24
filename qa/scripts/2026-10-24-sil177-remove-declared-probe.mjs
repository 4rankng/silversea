// SIL-177 — QA integration probe (LOCAL ONLY, worktree BE :3092 + ss-prod-db).
// "Xóa container" phải bị CHẶN khi dòng đang mang số tờ khai (QA R42: xóa
// MSKU1234586 mang Q1-DECL-177 thành công là lỗi) — mọi role, kèm lý do rõ.
// Run: API=http://localhost:3092/api node qa/scripts/2026-10-24-sil177-remove-declared-probe.mjs
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

async function login(identifier) {
  for (let i = 0; i < 3; i++) {
    const r = await jf('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
    if (r.body?.token) return r.body.token;
    await sleep(1000);
  }
  return null;
}
const T = await login('cus');
if (!T) { console.log('LOGIN FAILED (cus)'); process.exit(1); }
const key = () => crypto.randomUUID();

const boot = (await jf('/catalogs/bootstrap', { headers: auth(T) })).body;
const customers = (await jf('/customers?limit=5', { headers: auth(T) })).body;
const cust = (customers.items ?? customers.rows ?? customers)[0];
const ct = (boot.containerTypes ?? [])[0];
const stamp = Date.now().toString().slice(-6);

const det = (sid) => jf(`/shipments/cus-workspace/${sid}`, { headers: auth(T) }).then((r) => r.body);
const removeContainer = (sid, cid, version, tok = T) => jf(`/shipments/cus-workspace/${sid}/containers/${cid}/remove`, { method: 'POST', headers: auth(tok, { 'Idempotency-Key': key() }), body: JSON.stringify({ expectedShipmentVersion: version }) });
const contRows = (sid) => psql(`select id || '=' || coalesce(declaration_number,'<NULL>') from shipment_containers where shipment_id=${sid} order by id`).split('\n').filter(Boolean);
const lineUpdate = (sid, cid, body) => jf(`/shipments/cus-workspace/${sid}/containers/${cid}`, { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify(body) });

const quickLot = async (suffix) => (await jf('/shipments/quick', { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({
  customerId: cust.id, tradeDirection: 'IMPORT', blNumber: `SIL177${suffix}${stamp}`, shippingLineName: 'MAERSK',
  containers: [
    { containerNumber: '', containerTypeId: ct.id },
    { containerNumber: '', containerTypeId: ct.id },
  ],
}) })).body?.id;

// ── FIXTURE: lô 2 cont, cont#1 gắn tờ khai Q-177, cont#2 được CLEAR (thường) ─
// Lưu ý: set tờ khai cont#1 sẽ fan-out điền cont#2 (FB-109 fill-trống) — để có
// cont KHÔNG tờ khai phải clear cont#2 sau đó (clear luôn local theo luật).
const sid = await quickLot('A');
check('FIXTURE lô Q-177 tạo', sid != null, `id=${sid}`);
let d = await det(sid);
const [c1, c2] = d.containers;
const DECL = `Q-DECL-177-${stamp}`;
const setDecl = await lineUpdate(sid, c1.id, { expectedShipmentVersion: d.summary.version, declarationNumber: DECL });
check('FIXTURE gắn tờ khai cont#1', setDecl.status === 200, `status=${setDecl.status}`);
d = await det(sid);
const clearC2 = await lineUpdate(sid, c2.id, { expectedShipmentVersion: d.summary.version, declarationNumber: null });
check('FIXTURE clear cont#2 (trở thành cont thường)', clearC2.status === 200, `status=${clearC2.status}`);
check('FIXTURE DB: #1 mang tờ khai, #2 trống', contRows(sid).some((row) => row.startsWith(`${c1.id}=${DECL}`)) && contRows(sid).some((row) => row.startsWith(`${c2.id}=<NULL>`)), `[${contRows(sid).join(' | ')}]`);

// ── TC-SIL177-R2: CUS xóa cont CÓ tờ khai → 409 + dòng còn nguyên ────────────
d = await det(sid);
const rmDecl = await removeContainer(sid, c1.id, d.summary.version);
check('TC-SIL177-R2 remove cont có tờ khai → 409', rmDecl.status === 409, `status=${rmDecl.status} body=${JSON.stringify(rmDecl.body).slice(0, 200)}`);
check('TC-SIL177-R2 message nêu đúng số tờ khai + chỉ dẫn gỡ', typeof (rmDecl.body?.error ?? rmDecl.body?.message) === 'string' && (rmDecl.body?.error ?? rmDecl.body?.message).includes(DECL) && (rmDecl.body?.error ?? rmDecl.body?.message).includes('gỡ tờ khai trước'), `message="${rmDecl.body?.error ?? rmDecl.body?.message ?? '<none>'}"`);
check('TC-SIL177-R2 DB: dòng vẫn còn nguyên', contRows(sid).some((row) => row.startsWith(`${c1.id}=${DECL}`)), `[${contRows(sid).join(' | ')}]`);

// ── TC-SIL177-R4: ADMIN cũng bị chặn (không ngoại lệ theo spec) ──────────────
const TA = await login('admin');
if (TA) {
  const rmAdmin = await removeContainer(sid, c1.id, d.summary.version, TA);
  check('TC-SIL177-R4 ADMIN xóa cont có tờ khai → 409', rmAdmin.status === 409, `status=${rmAdmin.status}`);
} else {
  check('TC-SIL177-R4 ADMIN login', false, 'không đăng nhập được admin — kiểm tra seed');
}

// ── TC-SIL177-R1: cont KHÔNG tờ khai, chưa điều xe → xóa thành công ──────────
d = await det(sid);
const rmPlain = await removeContainer(sid, c2.id, d.summary.version);
check('TC-SIL177-R1 remove cont thường → 200', rmPlain.status === 200, `status=${rmPlain.status} body=${JSON.stringify(rmPlain.body).slice(0, 120)}`);
check('TC-SIL177-R1 DB: cont thường biến mất, cont tờ khai còn', !contRows(sid).some((row) => row.startsWith(`${c2.id}=`)) && contRows(sid).some((row) => row.startsWith(`${c1.id}=${DECL}`)), `[${contRows(sid).join(' | ')}]`);

const failed = results.filter((r) => !r.ok);
console.log(`\nSIL-177 probe: ${results.length - failed.length}/${results.length} PASS${failed.length ? ` — FAIL: ${failed.map((f) => f.id).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
