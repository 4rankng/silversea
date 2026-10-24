// SIL-173 — QA integration probe (LOCAL ONLY, make dev stack + worktree BE).
// "Thêm container" trên lô có tờ khai CẤP LÔ: số tờ khai phải copy vào MỌI dòng
// container trống của lô — kể cả dòng thêm sau — đúng luật fan-out CUS-05 của
// SIL-166 (da2eb512), và không bao giờ ghi đè dòng đã có số riêng (FB-109).
// Run: API=http://localhost:3012/api node qa/scripts/2026-10-24-sil173-add-container-tokhai-probe.mjs
import { execSync } from 'node:child_process';

const API = process.env.API ?? 'http://localhost:3012/api';
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
const addContainer = (sid, body) => jf(`/shipments/cus-workspace/${sid}/containers`, { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify(body) });
// ISO 6346 check digit — the add API validates it, so the probe computes
// valid numbers instead of hand-typing wrong ones.
const checkDigit = (ownerCodeAndSerial) => {
  const LETTER_VALUES = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };
  const digits = [...ownerCodeAndSerial].map((ch) => (/[0-9]/.test(ch) ? Number(ch) : LETTER_VALUES[ch]));
  let sum = 0;
  digits.forEach((value, index) => { sum += value * (2 ** index); });
  return sum % 11 % 10;
};
const contNo = (base10) => `${base10}${checkDigit(base10)}`;
const quickLot = async (suffix, containers) => (await jf('/shipments/quick', { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({
  customerId: cust.id, tradeDirection: 'IMPORT', blNumber: `SIL173${suffix}${stamp}`, shippingLineName: 'MAERSK',
  containers,
}) })).body?.id;

// ── TC-SIL173-01: lô FCL có tờ khai CẤP LÔ → "Thêm container" nhận số lô ────
const TK1 = `TK173-${stamp}`;
const sidA = await quickLot('A', [
  { containerNumber: '', containerTypeId: ct.id },
  { containerNumber: '', containerTypeId: ct.id },
]);
check('FIXTURE lot A', sidA != null, `id=${sidA}`);
const declA = await jf(`/shipments/${sidA}/declarations`, { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({ declarationNumber: TK1, scope: 'SINGLE' }) });
check('FIXTURE lot A tờ khai mức lô', declA.status === 201, `status=${declA.status}`);
let dA = await det(sidA);
const addA = await addContainer(sidA, { expectedShipmentVersion: dA.summary.version, containerNumber: 'CSQU3054383' });
check('TC-SIL173-01 add status 201', addA.status === 201, `status=${addA.status} ${addA.status >= 400 ? JSON.stringify(addA.body).slice(0, 160) : ''}`);
check('TC-SIL173-01 dòng MỚI mang số tờ khai cấp lô ngay trong response',
  addA.body?.line?.declarationNumber === TK1,
  `line.declarationNumber=${addA.body?.line?.declarationNumber ?? '<NULL>'}`);
check('TC-SIL173-01 DB: cả 3 dòng mang số lô', declRows(sidA).every((v) => v === TK1),
  `db=[${declRows(sidA).join('|')}]`);

// ── TC-SIL173-02: dòng CŨ còn trống cũng được fan-out điền (MỌI dòng trống) ──
const TK2 = `TK173B-${stamp}`;
const sidB = await quickLot('B', [
  { containerNumber: '', containerTypeId: ct.id },
  { containerNumber: '', containerTypeId: ct.id },
]);
await jf(`/shipments/${sidB}/declarations`, { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({ declarationNumber: TK2, scope: 'SINGLE' }) });
let dB = await det(sidB);
// Xóa số dòng #1 (local act) → lô có 1 dòng cũ trống trước khi thêm dòng mới.
await lineUpdate(sidB, dB.containers[0].id, { expectedShipmentVersion: dB.summary.version, declarationNumber: null });
dB = await det(sidB);
const addB = await addContainer(sidB, { expectedShipmentVersion: dB.summary.version, containerNumber: contNo('MSKU412001') });
check('TC-SIL173-02 add status 201', addB.status === 201, `status=${addB.status}`);
const syncB = addB.body?.declarationSync?.updatedContainerIds ?? [];
check('TC-SIL173-02 fan-out điền dòng cũ trống (dòng mới đã nhận số qua sibling-inherit)',
  syncB.length === 1,
  `sync=${JSON.stringify(syncB)} db=[${declRows(sidB).join('|')}]`);
check('TC-SIL173-02 DB: mọi dòng (cũ + mới) mang số lô', declRows(sidB).every((v) => v === TK2),
  `db=[${declRows(sidB).join('|')}]`);

// ── TC-SIL173-03: dòng có số RIÊNG không bị ghi đè (FB-109 never-overwrite) ──
const sidC = await quickLot('C', [
  { containerNumber: '', containerTypeId: ct.id },
  { containerNumber: '', containerTypeId: ct.id },
]);
const TK3 = `TK173C-${stamp}`;
const OWN = `TK173-OWN-${stamp}`;
await jf(`/shipments/${sidC}/declarations`, { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({ declarationNumber: TK3, scope: 'SINGLE' }) });
let dC = await det(sidC);
await lineUpdate(sidC, dC.containers[1].id, { expectedShipmentVersion: dC.summary.version, declarationNumber: OWN });
const addC = await addContainer(sidC, { expectedShipmentVersion: (await det(sidC)).summary.version, containerNumber: contNo('TGHU987654') });
check('TC-SIL173-03 add status 201', addC.status === 201, `status=${addC.status}`);
const dbC = declRows(sidC);
check('TC-SIL173-03 dòng số riêng KHÔNG bị ghi đè; dòng mới nhận số lô',
  dbC[1] === OWN && dbC[2] === TK3,
  `db=[${dbC.join('|')}]`);

// ── TC-SIL173-04: KHÔNG có tờ khai cấp lô → sibling-inherit per-cont giữ nguyên ──
const sidD = await quickLot('D', [
  { containerNumber: '', containerTypeId: ct.id },
  { containerNumber: '', containerTypeId: ct.id },
]);
let dD = await det(sidD);
const SIB = `TK173-SIB-${stamp}`;
await lineUpdate(sidD, dD.containers[0].id, { expectedShipmentVersion: dD.summary.version, declarationNumber: SIB });
dD = await det(sidD);
const addD = await addContainer(sidD, { expectedShipmentVersion: dD.summary.version, containerNumber: contNo('MSCU661234') });
check('TC-SIL173-04 không có decl lô: dòng mới inherit sibling (card 181026185900)',
  addD.status === 201 && addD.body?.line?.declarationNumber === SIB,
  `status=${addD.status} line.declarationNumber=${addD.body?.line?.declarationNumber ?? '<NULL>'}`);
check('TC-SIL173-04 không fan-out giả (declarationSync vắng mặt khi không có decl lô)',
  addD.body?.declarationSync === undefined,
  `sync=${JSON.stringify(addD.body?.declarationSync ?? null)}`);

// ── TC-SIL173-02b: hình QA gốc — TẤT CẢ dòng cũ trống (chỉ decl lô có số) ──
// Sibling-inherit không có gì để lấy → fan-out phải tự điền CẢ dòng cũ lẫn
// dòng mới, và sync báo đủ mọi dòng nó ghi.
const TK2B = `TK173D-${stamp}`;
const sidB2 = await quickLot('E', [
  { containerNumber: '', containerTypeId: ct.id },
  { containerNumber: '', containerTypeId: ct.id },
]);
await jf(`/shipments/${sidB2}/declarations`, { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({ declarationNumber: TK2B, scope: 'SINGLE' }) });
let dB2 = await det(sidB2);
for (const row of dB2.containers) {
  await lineUpdate(sidB2, row.id, { expectedShipmentVersion: (await det(sidB2)).summary.version, declarationNumber: null });
}
dB2 = await det(sidB2);
const rowsBefore = declRows(sidB2);
const addB2 = await addContainer(sidB2, { expectedShipmentVersion: dB2.summary.version, containerNumber: contNo('CSQU305439') });
check('TC-SIL173-02b add status 201', addB2.status === 201, `status=${addB2.status}`);
const syncB2 = addB2.body?.declarationSync?.updatedContainerIds ?? [];
check('TC-SIL173-02b fan-out tự điền MỌI dòng trống (2 cũ + 1 mới = 3 ids)',
  syncB2.length === rowsBefore.length + 1,
  `before=[${rowsBefore.join('|')}] sync=${JSON.stringify(syncB2)}`);
check('TC-SIL173-02b dòng mới mang số lô', addB2.body?.line?.declarationNumber === TK2B,
  `line.declarationNumber=${addB2.body?.line?.declarationNumber ?? '<NULL>'}`);
check('TC-SIL173-02b DB: cả 3 dòng mang số lô', declRows(sidB2).every((v) => v === TK2B),
  `db=[${declRows(sidB2).join('|')}]`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
