// SIL-172 — QA integration probe (LOCAL ONLY, make dev stack + worktree BE).
// QA repro (SIL-172 / FB-141 đuôi): lô LCL khóa chi phí, BKS báo khách
// "88Q-99999" → xuất Debit Note → XÓA BKS → xuất LẠI. File mới phải đọc GIÁ TRỊ
// HIỆN TẠI của lô (trống / BKS thực fallback / giá trị mới) — không còn BKS đã
// xóa. File XLSX được mở bằng exceljs và quét TOÀN BỘ ô (không scan bytes thô).
// Run: API=http://localhost:3012/api node qa/scripts/2026-10-24-sil172-export-bks-probe.mjs
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve exceljs from the BACKEND workspace (pnpm hoists per-package), not
// from the repo root where it is not a direct dependency.
const require = createRequire(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '../../backend/package.json')));
const ExcelJS = require('exceljs');

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

const customers = (await jf('/customers?limit=5', { headers: auth(T) })).body;
const cust = (customers.items ?? customers.rows ?? customers)[0];
const stamp = Date.now().toString().slice(-6);
const PLATE = '88Q-99999';

// Mọi text của workbook (mọi sheet, mọi ô) — đủ để khẳng định một chuỗi có
// hay không xuất hiện trong file, bất kể renderer GBN hay Long Minh.
async function workbookTexts(res) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const texts = [];
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value != null) texts.push(String(cell.value instanceof Object ? (cell.value.result ?? cell.value.text ?? cell.value.richText?.map((t) => t.text).join('') ?? JSON.stringify(cell.value)) : cell.value));
      });
    });
  }
  return texts;
}

// ── Fixture: lô LCL, giá cước thu khách nhập tay 1.500.000đ, BKS ảo 88Q-99999 ──
const lot = await jf('/shipments/quick', { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({
  customerId: cust.id, cargoMode: 'LCL', tradeDirection: 'IMPORT',
  blNumber: `SIL172A${stamp}`, shippingLineName: 'MAERSK', containers: [],
}) });
check('FIXTURE tạo lô LCL', lot.status === 201, `status=${lot.status}`);
const sid = lot.body.id;

const rev = await jf('/shipments/lcl/rev-class', { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({ shipmentId: sid, freightRevenue: 1500000 }) });
check('FIXTURE giá cước thu khách 1.500.000đ nhập tay', rev.status === 200, `status=${rev.status} ${rev.status >= 400 ? JSON.stringify(rev.body).slice(0, 200) : ''}`);

const truckSet = await jf('/shipments/lcl/truck', { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({ shipmentId: sid, billingTruckNo: PLATE }) });
check('FIXTURE BKS báo khách (ảo) = 88Q-99999', truckSet.status === 200, `status=${truckSet.status}`);
check('FIXTURE DB billing_truck_no', psql(`select billing_truck_no from shipments where id=${sid}`) === PLATE,
  `db=${psql(`select coalesce(billing_truck_no,'<NULL>') from shipments where id=${sid}`)}`);

const lock = await jf(`/shipments/${sid}/lock`, { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({ lockNote: 'SIL-172 probe' }) });
check('FIXTURE khóa lô', lock.status === 201, `status=${lock.status} ${lock.status >= 400 ? JSON.stringify(lock.body).slice(0, 200) : ''}`);

const issue = await jf(`/shipments/${sid}/debit-note`, { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({}) });
check('FIXTURE xuất Debit Note lần 1', issue.status === 201, `status=${issue.status} ${issue.status >= 400 ? JSON.stringify(issue.body).slice(0, 200) : ''}`);
const docId = issue.body?.id;

// ── TC-SIL172-1: file ĐẦU chứa đúng BKS ảo đang có (giá trị hiện tại lúc đó) ──
const ex1 = await fetch(`${API}/shipments/${sid}/debit-note/export?documentId=${docId}`, { headers: auth(T) });
const texts1 = ex1.status === 200 ? await workbookTexts(ex1) : [];
check('TC-SIL172-1 export 1 status 200', ex1.status === 200, `status=${ex1.status}`);
check('TC-SIL172-1 file ĐẦU chứa 88Q-99999 (đúng — giá trị hiện tại)',
  texts1.some((t) => t.includes(PLATE)),
  `match=${texts1.filter((t) => t.includes(PLATE)).length}`);

// ── TC-SIL172-2: XÓA BKS → export lại → file mới KHÔNG chứa BKS đã xóa ──────
const clear = await jf('/shipments/lcl/truck', { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({ shipmentId: sid, billingTruckNo: null }) });
check('TC-SIL172-2 xóa BKS báo khách (null — FB-141)', clear.status === 200, `status=${clear.status}`);
check('TC-SIL172-2 DB billing_truck_no = NULL', psql(`select coalesce(billing_truck_no,'<NULL>') from shipments where id=${sid}`) === '<NULL>',
  `db=${psql(`select coalesce(billing_truck_no,'<NULL>') from shipments where id=${sid}`)}`);
const ex2 = await fetch(`${API}/shipments/${sid}/debit-note/export?documentId=${docId}`, { headers: auth(T) });
const texts2 = ex2.status === 200 ? await workbookTexts(ex2) : [];
check('TC-SIL172-2 export 2 status 200', ex2.status === 200, `status=${ex2.status}`);
check('TC-SIL172-2 file MỚI KHÔNG chứa 88Q-99999 ở bất kỳ ô nào',
  !texts2.some((t) => t.includes(PLATE)),
  `matches=${texts2.filter((t) => t.includes(PLATE)).length}`);
check('TC-SIL172-2 tiền vẫn đóng băng đúng 1.500.000 (BKS không phải tiền — không đụng)',
  texts2.some((t) => String(t).includes('1500000')) || texts2.some((t) => /^1500000(\.0+)?$/.test(String(t))),
  `amount-cells=${texts2.filter((t) => String(t).includes('1500000')).length}`);

// ── TC-SIL172-3: lô có BKS thực (LCL) → fallback in BKS thực ────────────────
const actual = `29H-${stamp.slice(-3)}.77`;
await jf('/shipments/lcl/truck', { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({ shipmentId: sid, actualTruckNo: actual }) });
const ex3 = await fetch(`${API}/shipments/${sid}/debit-note/export?documentId=${docId}`, { headers: auth(T) });
const texts3 = ex3.status === 200 ? await workbookTexts(ex3) : [];
check('TC-SIL172-3 file sau có BKS THỰC (fallback LCL), vẫn không có BKS ảo cũ',
  texts3.some((t) => t.includes(actual)) && !texts3.some((t) => t.includes(PLATE)),
  `actual=${texts3.filter((t) => t.includes(actual)).length} old=${texts3.filter((t) => t.includes(PLATE)).length}`);

// ── TC-SIL172-4: đổi BKS ảo sang giá trị MỚI → file in giá trị mới ──────────
const newPlate = `88Q-${stamp.slice(-5)}`;
await jf('/shipments/lcl/truck', { method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }), body: JSON.stringify({ shipmentId: sid, billingTruckNo: newPlate }) });
const ex4 = await fetch(`${API}/shipments/${sid}/debit-note/export?documentId=${docId}`, { headers: auth(T) });
const texts4 = ex4.status === 200 ? await workbookTexts(ex4) : [];
check('TC-SIL172-4 file in BKS MỚI (đọc hiện tại), không in giá trị cũ',
  texts4.some((t) => t.includes(newPlate)) && !texts4.some((t) => t.includes(PLATE)) && !texts4.some((t) => t.includes(actual)),
  `new=${texts4.filter((t) => t.includes(newPlate)).length} old=${texts4.filter((t) => t.includes(PLATE) || t.includes(actual)).length}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
