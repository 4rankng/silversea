// FIX CHI PHÍ lần 2 — advances chain driver (items 1, 7, 8, 9).
// Chain (spec §c per PRD lines 107/109/113 + QA brief):
//   1. Ops tạm ứng 100.000 → ketoan PHÊ DUYỆT (giải ngân)          [item 7]
//   2. Sổ quỹ TK OPS outstanding == "Còn phải hoàn ứng" report     [item 7]
//   3. Ops khai chi phí 150.000 KHÔNG ảnh → phải được ghi nhận     [item 1]
//      (không được báo "thiếu chứng từ")
//   4. Ketoan thấy chi phí Ops (bảng tạm ứng/báo cáo hoàn ứng)     [item 9]
//   5. Phiếu hoàn ứng hoàn lại −50.000 → ketoan DUYỆT               [item 7/8]
//   6. Báo cáo hoàn ứng: dòng ÂM hiện cảnh báo thu lại              [item 8]
// LOCAL dev only — FE :7185 / BE :3012 of this worktree.
//
//   node qa/scripts/2026-10-21-accounting-fix2-advances.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = 'http://localhost:3012/api';
const FE = 'http://localhost:7185';
const OUT = path.resolve('qa/2026-10-21-accounting-fix2');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'advances-chain-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const OPS_USER = process.env.OPS_USER ?? `af2qa-${Date.now().toString(36)}`;
const SHIPMENT_ID = Number(process.env.SHIPMENT_ID ?? 311836);
const TRIP_ID = Number(process.env.TRIP_ID ?? 193772);
const TAG = `AF2-${new Date().toISOString().replace(/[-:T]/g, '').slice(2, 14)}`;

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) return null;
  return (await res.json()).token;
}
const api = (token, method, p, body, headers = {}) =>
  fetch(`${API}${p}`, {
    method, headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
      'Idempotency-Key': `${TAG}-${method}-${p.replace(/[^a-z0-9]+/gi, '-')}-${Math.random().toString(36).slice(2, 8)}`,
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const kt = await login('ketoan');
const admin = await login('admin');
let ops = await login(OPS_USER);
if (!ops) {
  log(`creating fresh OPS user ${OPS_USER} (empty wallet — no auto-offset) linked to shipment ${SHIPMENT_ID}`);
  const created = await api(admin, 'POST', '/auth/users', {
    username: OPS_USER, email: `${OPS_USER}@silversea.vn`, password: 'Abc123',
    fullName: `QA AF2 ${OPS_USER}`, role: 'OPS', shipmentIds: [SHIPMENT_ID],
  });
  log(`create: HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);
  ops = await login(OPS_USER);
}
check('setup: ketoan + ops tokens', Boolean(kt && ops));

// ── 1. Ops tạm ứng 100.000 → PENDING → ketoan PHÊ DUYỆT ────────────────────
const advRes = await api(ops, 'POST', '/forwarder/me/advance-requests', {
  amount: 100000, reason: `${TAG} tạm ứng QA fix2`,
});
const advance = advRes.body?.id ? advRes.body : advRes.body?.request ?? advRes.body?.item;
check('item7: Ops tạo tạm ứng 100.000 (PENDING)', advRes.status === 201 && Boolean(advance?.id), `HTTP ${advRes.status} ${JSON.stringify(advRes.body).slice(0, 200)}`);
if (!advance?.id) process.exit(2);

const apprRes = await api(kt, 'POST', `/advance-requests/${advance.id}/approve`, { expectedVersion: advance.version ?? 1 });
check('item7: ketoan PHÊ DUYỆT TẠM ỨNG (duyệt = giải ngân)', apprRes.status === 200 || apprRes.status === 201, `HTTP ${apprRes.status} ${JSON.stringify(apprRes.body).slice(0, 200)}`);

// ── 2. Sổ quỹ TK OPS outstanding == "Còn phải hoàn ứng" ────────────────────
const today = new Date().toISOString().slice(0, 10);
const bookOf = async (source) => api(kt, 'GET', `/expense-accounting/fund-book?source=${source}&from=${today}&to=${today}`);
const [bookC, bookT] = await Promise.all([bookOf('COMPANY'), bookOf('TM')]);
const report = await api(kt, 'GET', `/expense-accounting/reconciliation-report?from=${today}&to=${today}`);
const bookOutstanding = bookC.body?.opsAdvance?.totalOutstanding ?? bookT.body?.opsAdvance?.totalOutstanding;
const reportRemaining = report.body?.totals?.remaining;
log(`fund-book opsAdvance.totalOutstanding=${bookOutstanding} (C:${bookC.body?.opsAdvance?.totalOutstanding} T:${bookT.body?.opsAdvance?.totalOutstanding}) · report totals.remaining=${reportRemaining}`);
check('item7: Sổ quỹ TK OPS khớp "Còn phải hoàn ứng" của báo cáo', Number(bookOutstanding) === Number(reportRemaining), `book=${bookOutstanding} report=${reportRemaining}`);

// ── 3. Ops khai chi phí 150.000 KHÔNG ảnh → không báo thiếu chứng từ ──────
const opsMe = await api(ops, 'GET', '/auth/me');
const opsId = opsMe.body?.user?.id ?? opsMe.body?.id;
const expRes = await api(ops, 'POST', '/forwarder/me/expenses', {
  tripId: TRIP_ID, expenseType: 'WAREHOUSE_LABOR', buyAmount: 150000, sellAmount: 0,
  settlementMethod: 'OPS_ADVANCE', forwarderId: opsId,
  expenseDate: new Date().toISOString().slice(0, 10),
  payeeName: 'Kho QC',
  noInvoiceEvidenceTypes: ['RECEIPT'], // giấy — photo is NOT required (spec 1.1)
  note: `${TAG} chi phí không ảnh (QA fix2 item 1)`,
});
const expense = expRes.body?.id ? expRes.body : expRes.body?.expense ?? expRes.body?.item;
const bodyText = JSON.stringify(expRes.body ?? {});
const rejectsOnMissingPhoto = /thiếu chứng từ|chứng từ là bắt buộc|photo.{0,20}required|ảnh.{0,20}bắt buộc/i.test(bodyText);
check('item1: Ops khai chi phí KHÔNG ảnh được ghi nhận (không lỗi thiếu chứng từ)', (expRes.status === 201 || expRes.status === 200) && Boolean(expense?.id) && !rejectsOnMissingPhoto, `HTTP ${expRes.status} id=${expense?.id} ${bodyText.slice(0, 160)}`);
if (!expense?.id) process.exit(2);

// Auto-offset guard — with an outstanding advance ≥ chi phí the wallet may
// auto-link it; for the âm phiếu we need it unlinked.
const unlinked = await api(ops, 'GET', '/forwarder/me/unlinked-expenses');
const stillUnlinked = (unlinked.body?.items ?? unlinked.body ?? []).some((e) => e.id === expense.id);
log(`expense ${expense.id} unlinked (auto-offset skipped): ${stillUnlinked}`);

// ── 4. Ketoan thấy chi phí Ops đã nhập ────────────────────────────────────
// Ops xác nhận kê xong trước — chi phí mới đủ điều kiện hiển thị đầy đủ.
const compRes = await api(ops, 'PUT', `/forwarder/me/trips/${TRIP_ID}/expense-completion`, { tripContainerId: null, completed: true });
check('setup: Ops xác nhận kê xong', compRes.status === 200, `HTTP ${compRes.status}`);

const ktReview = await api(kt, 'GET', `/expense-accounting/ops-review?from=${today}&to=${today}`);
const report2 = await api(kt, 'GET', `/expense-accounting/reconciliation-report?from=${today}&to=${today}`);
const qaRow = (report2.body?.rows ?? []).find((r) => (r.staffName ?? '').includes(OPS_USER));
log(`ops-review HTTP ${ktReview.status} (expense-register surface, khác id-namespace trip expense); QA row: ${JSON.stringify(qaRow)}`);
// The tạm-ứng-side surface for a TRIP expense is the phiếu hoàn ứng carrying
// it (Ảnh 8: "bảng để kiểm tra duyệt chi phí của Ops đã nhập") — asserted
// below after the phiếu is created; here the report row must already show
// the staff's advance movement.
check('item9 (báo cáo hoàn ứng): dòng nhân viên Ops hiện phía kế toán', Boolean(qaRow), `row=${JSON.stringify(qaRow)?.slice(0, 200)}`);

// ── 5. Phiếu hoàn ứng với hoàn lại −50.000 → ketoan DUYỆT ──────────────────
const setRes = await api(ops, 'POST', '/forwarder/me/advance-settlements', {
  totalExpenseAmount: 150000, refundAmount: -50000,
  advanceRequestIds: [advance.id], tripExpenseIds: [expense.id],
  note: `${TAG} phiếu hoàn ứng âm`,
});
const settlement = setRes.body?.id ? setRes.body : setRes.body?.settlement ?? setRes.body?.item;
check('item8-setup: phiếu hoàn ứng hoàn lại −50.000 được tạo', (setRes.status === 201 || setRes.status === 200) && Boolean(settlement?.id), `HTTP ${setRes.status} ${JSON.stringify(setRes.body).slice(0, 240)}`);
if (settlement?.id) {
  // Item 9's strongest form: the phiếu carrying the Ops expense is visible
  // on the accountant's settlement list, and its detail carries the exact
  // trip expense id Ops entered.
  const ktSettle = await api(kt, 'GET', '/advance-settlements?limit=25');
  const settleSeen = JSON.stringify(ktSettle.body ?? '').includes(String(settlement.id)) || JSON.stringify(ktSettle.body ?? '').includes(settlement.code ?? '___');
  const detail = await api(kt, 'GET', `/advance-settlements/${settlement.id}`);
  const detailText = JSON.stringify(detail.body ?? '');
  const carriesExpense = detailText.includes(String(expense.id));
  log(`ketoan /advance-settlements sees phiếu ${settlement.id}${settlement.code ? ` (${settlement.code})` : ''}: ${settleSeen}; detail carries trip expense ${expense.id}: ${carriesExpense}`);
  check('item9: phiếu hoàn ứng Ops hiện trên danh sách kế toán + mang đúng chi phí Ops nhập', settleSeen && carriesExpense, `HTTP ${ktSettle.status}/${detail.status}`);
  const chk = await api(kt, 'POST', `/advance-settlements/${settlement.id}/check`, { expectedVersion: settlement.version ?? 1 });
  check('item7: ketoan DUYỆT phiếu hoàn ứng', chk.status === 200, `HTTP ${chk.status} ${JSON.stringify(chk.body).slice(0, 200)}`);
}

// ── 6. Báo cáo hoàn ứng: dòng ÂM hiện cảnh báo thu lại ─────────────────────
const report3 = await api(kt, 'GET', `/expense-accounting/reconciliation-report?from=${today}&to=${today}`);
const rows3 = report3.body?.rows ?? [];
const negRows = rows3.filter((r) => Number(r.remainingSigned) < 0 || Number(r.outstandingSigned) < 0 || r.needsCollection);
log(`report3: ${rows3.length} rows, ${negRows.length} negative/collection rows; sample: ${JSON.stringify(negRows.slice(0, 3).map((r) => ({ n: r.staffName, rs: r.remainingSigned, nc: r.needsCollection })))}`);
check('item8: báo cáo hoàn ứng có dòng ÂM với needsCollection (cảnh báo thu lại)', negRows.some((r) => r.needsCollection === true), JSON.stringify(negRows.slice(0, 3).map((r) => ({ n: r.staffName, rs: r.remainingSigned, nc: r.needsCollection }))));

// Post-duyệt khớp số lần 2.
const bookC2 = await api(kt, 'GET', `/expense-accounting/fund-book?source=COMPANY&from=${today}&to=${today}`);
const bookT2 = await api(kt, 'GET', `/expense-accounting/fund-book?source=TM&from=${today}&to=${today}`);
const bookOutstanding2 = bookC2.body?.opsAdvance?.totalOutstanding ?? bookT2.body?.opsAdvance?.totalOutstanding;
check('item7 (sau duyệt phiếu): Sổ quỹ TK OPS vẫn khớp báo cáo', Number(bookOutstanding2) === Number(report3.body?.totals?.remaining), `book=${bookOutstanding2} report=${report3.body?.totals?.remaining}`);

// ── UI screens (ketoan + ops) ──────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new' });
async function shotPage(identifier, pathname, name, probe) {
  const token = await login(identifier);
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${FE}${pathname}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3500);
  if (probe) await probe(page);
  await page.screenshot({ path: path.join(OUT, `ui-${name}.png`), fullPage: true });
  await page.close();
  return true;
}

// Ketoan — bảng tạm ứng (PHÊ DUYỆT TẠM ỨNG visible on PENDING rows).
await shotPage('ketoan', '/advances', '07-advances-table', async (page) => {
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 3000));
  log(`/advances has PHÊ DUYỆT TẬM ỨNG: ${txt.includes('PHÊ DUYỆT TẠM ỨNG')} · Chờ duyệt tab: ${txt.includes('Chờ duyệt')}`);
});
// Ketoan — báo cáo hoàn ứng (âm warning).
await shotPage('ketoan', '/accounting/hoan-ung', '08-hoanung-report', async (page) => {
  const txt = await page.evaluate(() => document.body.innerText);
  const hasWarn = txt.includes('đề nghị thu lại tiền ứng');
  log(`/accounting/hoan-ung has 'đề nghị thu lại tiền ứng': ${hasWarn}`);
  check('item8 UI: /accounting/hoan-ung hiện cảnh báo thu lại tiền ứng', hasWarn);
});
// Ketoan — workspace chi phí thấy chi phí Ops (item 9).
await shotPage('ketoan', '/accounting/expenses', '09-kt-expense-workspace', async (page) => {
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 4000));
  log(`/accounting/expenses mentions QA tag: ${txt.includes(TAG)} (tag=${TAG})`);
});
await browser.close();

log(`DONE failures=${failures}`);
fs.appendFileSync(LOG, `TAG=${TAG}\nEXPENSE_ID=${expense?.id}\nSETTLEMENT_ID=${settlement?.id ?? 'n/a'}\nADVANCE_ID=${advance?.id}\n`);
process.exit(failures > 0 ? 1 : 0);
