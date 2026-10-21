// QA R30 follow-up — Hoàn ứng SỐ ÂM (chi phí vượt tạm ứng) — LOCAL E2E probe.
//
// Business question: Ops chi tiêu VƯỢT số tạm ứng đã duyệt → phiếu hoàn ứng
// với "Tiền hoàn lại" ÂM có được ghi nhận + hiển thị + kế toán DUYỆT đúng không?
// Expected chain (FB-100, card 141026230770):
//   tạm ứng 100.000 duyệt (= giải ngân) → chi phí gắn chuyến 150.000
//   (OPS_ADVANCE, auto-offset phải BỎ QUA vì tạm ứng không bọc đủ chi phí)
//   → phiếu hoàn ứng refundAmount = −50.000 (cân đối) → kế toán duyệt OK.
//
//   node testplan/qa/scripts/2026-10-21-hoanung-am-e2e.mjs
//
// Env overrides: API_PORT (3002), FRONT_PORT (7175), ACCOUNTANT (ketoan),
// ADMIN (admin), OPS_USER (hoanungqa), SHIPMENT_ID (311836), TRIP_ID (193772),
// SKIP_UI=1 (API-only rerun). Data is created fresh each run (unique tag) on
// the LOCAL dev stack only — never point this at staging.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7175}`;
const ACCOUNTANT = process.env.ACCOUNTANT ?? 'ketoan';
const ADMIN = process.env.ADMIN ?? 'admin';
const OPS_USER = process.env.OPS_USER ?? 'hoanungqa';
const SHIPMENT_ID = Number(process.env.SHIPMENT_ID ?? 311836);
const TRIP_ID = Number(process.env.TRIP_ID ?? 193772);
const SKIP_UI = process.env.SKIP_UI === '1';
const PASSWORD = 'Abc123';

const TAG = `HUAM-${new Date().toISOString().replace(/[-:T]/g, '').slice(2, 14)}`;
const ADVANCE_AMOUNT = 100000;
const EXPENSE_AMOUNT = 150000;
const REFUND_NEGATIVE = -50000; // 100.000 − 150.000 — phiếu CÂN ĐỐI với số ÂM

const OUT = path.resolve('qa/2026-10-21-hoanung-am');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'e2e-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `ui-${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return { token: body.token, user: body.user };
}

const api = (token, method, p, body, extraHeaders = {}) =>
  fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `${TAG}-${method}-${p.replace(/[^a-z0-9]+/gi, '-')}-${Math.random().toString(36).slice(2, 8)}`,
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => {
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 400); }
    return { status: res.status, body: parsed };
  });

fs.writeFileSync(LOG, `hoanung-am E2E ${new Date().toISOString()} api=${API} front=${FRONT} tag=${TAG}\n`);

// ── 0. Health ────────────────────────────────────────────────────────────────
const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

// ── 1. Actors ────────────────────────────────────────────────────────────────
const kt = await login(ACCOUNTANT);
check('accountant login', Boolean(kt), ACCOUNTANT);
if (!kt) process.exit(2);

let ops = await login(OPS_USER);
if (!ops) {
  // Fresh local wallet: create the OPS user linked to the QA shipment.
  const admin = await login(ADMIN);
  if (!admin) { log('ABORT: cannot create OPS user — admin login failed'); process.exit(2); }
  const created = await api(admin.token, 'POST', '/auth/users', {
    username: OPS_USER,
    fullName: 'QA Hoàn Ứng Âm',
    password: PASSWORD,
    role: 'OPS',
    shipmentIds: [SHIPMENT_ID],
  });
  check('create QA OPS user', created.status === 201 || created.status === 200, `HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
  ops = await login(OPS_USER);
}
check('ops login', Boolean(ops), OPS_USER);
if (!ops) process.exit(2);
const opsId = ops.user?.id;
log(`ACTORS ops#${opsId} (${OPS_USER}) accountant#${kt.user?.id} (${ACCOUNTANT}) shipment=${SHIPMENT_ID} trip=${TRIP_ID}`);

// ── 2. Tạm ứng 100.000: Ops gửi → kế toán duyệt (= giải ngân) ────────────────
const advRes = await api(ops.token, 'POST', '/forwarder/me/advance-requests', {
  amount: ADVANCE_AMOUNT,
  reason: `QA R30 hoàn ứng âm ${TAG}`,
});
const advance = advRes.body?.id ? advRes.body : advRes.body?.items?.[0] ?? advRes.body?.request;
check('advance request created (PENDING)', advRes.status === 201 && Boolean(advance?.id), `HTTP ${advRes.status} ${JSON.stringify(advRes.body).slice(0, 200)}`);
if (!advance?.id) process.exit(2);

const apprRes = await api(kt.token, 'POST', `/advance-requests/${advance.id}/approve`, { expectedVersion: advance.version ?? 1 });
check('advance approved = giải ngân (RECORDED + funding)', apprRes.status === 200 && apprRes.body?.status === 'RECORDED' && Boolean(apprRes.body?.funding?.treasuryMovementId),
  `HTTP ${apprRes.status} status=${apprRes.body?.status} funding=${JSON.stringify(apprRes.body?.funding ?? null).slice(0, 120)}`);

// ── 3. Chi phí gắn chuyến 150.000 VƯỢT tạm ứng ──────────────────────────────
const expRes = await api(ops.token, 'POST', '/forwarder/me/expenses', {
  tripId: TRIP_ID,
  expenseType: 'WAREHOUSE_LABOR',
  buyAmount: EXPENSE_AMOUNT,
  sellAmount: 0,
  settlementMethod: 'OPS_ADVANCE',
  forwarderId: opsId,
  invoiceNumber: `${TAG}-INV`,
  invoiceDate: new Date().toISOString().slice(0, 10),
  note: `QA R30 chi vượt tạm ứng ${TAG}`,
});
const expense = expRes.body?.id ? expRes.body : expRes.body?.expense ?? expRes.body?.item;
check('trip expense created 150.000 (OPS_ADVANCE)', (expRes.status === 201 || expRes.status === 200) && Boolean(expense?.id), `HTTP ${expRes.status} ${JSON.stringify(expRes.body).slice(0, 240)}`);
if (!expense?.id) process.exit(2);

// AUTO-OFFSET GUARD: tạm ứng 100k < chi phí 150k → hệ thống KHÔNG được tự đối
// trừ (không overdraw) — khoản chi phải còn "chưa thanh toán" chờ quyết toán tay.
const unlinked = await api(ops.token, 'GET', '/forwarder/me/unlinked-expenses');
const stillUnlinked = (unlinked.body?.items ?? unlinked.body ?? []).some((e) => e.id === expense.id);
check('auto-offset skipped (expense still unlinked — no overdraw)', stillUnlinked, `HTTP ${unlinked.status} found=${stillUnlinked}`);

// ── 4. Ops xác nhận kê xong (completion) để chi phí đủ điều kiện phiếu ───────
const compRes = await api(ops.token, 'PUT', `/forwarder/me/trips/${TRIP_ID}/expense-completion`, { tripContainerId: null, completed: true });
check('expense completion set (COMPLETED)', compRes.status === 200, `HTTP ${compRes.status} ${JSON.stringify(compRes.body).slice(0, 160)}`);

// ── 5. NEGATIVE CONTROL: phiếu LỆCH (refund +50k) phải bị chặn ───────────────
const badRes = await api(ops.token, 'POST', '/forwarder/me/advance-settlements', {
  totalExpenseAmount: EXPENSE_AMOUNT,
  refundAmount: 50000,
  advanceRequestIds: [advance.id],
  tripExpenseIds: [expense.id],
  note: `QA unbalanced control ${TAG}`,
});
check('unbalanced phiếu rejected (400 cân đối)', badRes.status === 400 && /cân đối/i.test(String(badRes.body?.error ?? badRes.body?.message ?? '')),
  `HTTP ${badRes.status} ${JSON.stringify(badRes.body).slice(0, 160)}`);

// ── 6. Phiếu hoàn ứng SỐ ÂM: refundAmount = −50.000 ─────────────────────────
const setRes = await api(ops.token, 'POST', '/forwarder/me/advance-settlements', {
  totalExpenseAmount: EXPENSE_AMOUNT,
  refundAmount: REFUND_NEGATIVE,
  advanceRequestIds: [advance.id],
  tripExpenseIds: [expense.id],
  note: `QA R30 hoàn ứng âm ${TAG}`,
});
const settlement = setRes.body?.id ? setRes.body : setRes.body?.settlement;
check('phiếu hoàn ứng created refundAmount=−50.000', (setRes.status === 201 || setRes.status === 200) && Number(settlement?.refundAmount) === REFUND_NEGATIVE,
  `HTTP ${setRes.status} refund=${settlement?.refundAmount} code=${settlement?.code}`);
if (!settlement?.id) process.exit(2);
const sid = settlement.id;

const detail0 = await api(ops.token, 'GET', `/forwarder/me/advance-settlements/${sid}`);
check('detail: RECORDED, chưa KT duyệt, số âm giữ nguyên', detail0.status === 200
  && detail0.body?.status === 'RECORDED'
  && Number(detail0.body?.refundAmount) === REFUND_NEGATIVE
  && detail0.body?.checkedBy == null,
  `HTTP ${detail0.status} status=${detail0.body?.status} refund=${detail0.body?.refundAmount} checkedBy=${detail0.body?.checkedBy}`);

// ── 7. Kế toán DUYỆT phiếu hoàn ứng (UI drive) + double-duyệt guard ──────────
let browser = null;
if (!SKIP_UI) {
  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, kt.token);
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(`${FRONT}/advances?view=settlements`, { waitUntil: 'networkidle2' });
  try {
    await page.waitForFunction((code) => document.body.innerText.includes(code), { timeout: 25000 }, settlement.code);
  } catch {
    await shot(page, '07-settlements-notfound');
    check('admin settlements page shows the phiếu', false, `code ${settlement.code} not rendered`);
  }

  {
    // Display: summary strip của ĐÚNG phiếu này phải nêu "Hoàn lại −50.000 ₫".
    const display = await page.evaluate((code) => {
      const summaries = [...document.querySelectorAll('.as-settlement-summary')];
      const mine = summaries.find((el) => el.textContent?.includes(code));
      if (!mine) return { found: false };
      const refundRow = [...mine.querySelectorAll(':scope > div')].find((el) => el.textContent?.includes('Hoàn lại'));
      return { found: true, refundText: refundRow?.textContent?.replace(/\s+/g, ' ').trim() ?? null, full: mine.textContent?.replace(/\s+/g, ' ').trim() };
    }, settlement.code);
    check('UI hiển thị Hoàn lại −50.000 ₫ (admin summary strip)', display.found && /Hoàn lại/.test(display.refundText ?? '') && /-50\.000\s*₫/.test(display.refundText ?? ''),
      JSON.stringify(display.refundText ?? display).slice(0, 160));
    await shot(page, '07-admin-summary-am');

    // Duyệt: click DUYỆT PHIẾU HOÀN ỨNG trên dòng phiếu này.
    const row = await page.evaluate((code) => {
      const rows = [...document.querySelectorAll('.as-grid-row')];
      return rows.some((r) => r.textContent?.includes(code));
    }, settlement.code);
    check('admin row for the phiếu present', row, settlement.code);

    const btnFound = await page.evaluate((code) => {
      const rows = [...document.querySelectorAll('.as-grid-row')];
      const mine = rows.find((r) => r.textContent?.includes(code));
      const btn = mine && [...mine.querySelectorAll('button')].find((b) => /DUYỆT PHIẾU HOÀN ỨNG/.test(b.textContent ?? ''));
      if (!btn) return false;
      btn.click();
      return true;
    }, settlement.code);
    check('DUYỆT PHIẾU HOÀN ỨNG button clicked', btnFound, btnFound ? '' : 'button not found on row');

    let approvedShown = false;
    try {
      await page.waitForFunction((code) => {
        // The code sits in BOTH the summary strip (amounts) and the detail row
        // (as-record__forwarder); the duyệt state text lives only in the detail
        // row — so scan every element naming the code, not just the first.
        const els = [...document.querySelectorAll('.as-grid-row, .as-settlement-summary')]
          .filter((r) => r.textContent?.includes(code));
        return els.some((r) => /Đã duyệt \(KT\)/.test(r.textContent ?? ''));
      }, { timeout: 15000 }, settlement.code);
      approvedShown = true;
    } catch { /* captured below */ }
    await sleep(400);
    await shot(page, '08-after-duyet');
    check('UI after duyệt shows Đã duyệt (KT)', approvedShown, approvedShown ? '' : 'state text not found after click');
    check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');
  }
  await browser.close();
}

// API re-read: checked_by phải là kế toán vừa duyệt.
const detail1 = await api(kt.token, 'GET', `/advance-settlements/${sid}`);
check('DB/API: checkedBy = kế toán sau duyệt', detail1.status === 200
  && Number(detail1.body?.checkedBy) === Number(kt.user?.id)
  && Boolean(detail1.body?.checkedAt)
  && Number(detail1.body?.refundAmount) === REFUND_NEGATIVE,
  `HTTP ${detail1.status} checkedBy=${detail1.body?.checkedBy} checkedAt=${detail1.body?.checkedAt ?? 'null'} refund=${detail1.body?.refundAmount}`);

const again = await api(kt.token, 'POST', `/advance-settlements/${sid}/check`, { expectedVersion: detail1.body?.version ?? 2 });
check('double-duyệt guard (409)', again.status === 409, `HTTP ${again.status} ${JSON.stringify(again.body).slice(0, 140)}`);

// ── 8. DB money proof (local dev container) ──────────────────────────────────
const PSQL = (sql) => {
  try {
    return execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-At', '-c', sql], { encoding: 'utf8', timeout: 15000 });
  } catch (err) {
    return `PSQL FAIL: ${String(err).slice(0, 200)}`;
  }
};
const dbProof = [
  `-- settlement ${sid} (${settlement.code})`,
  PSQL(`SELECT id, code, status, total_expense_amount, refund_amount, checked_by, checked_at FROM advance_settlements WHERE id = ${sid};`),
  '-- linked advance allocation',
  PSQL(`SELECT advance_request_id, allocated_amount FROM advance_settlement_requests WHERE settlement_id = ${sid};`),
  '-- linked expense',
  PSQL(`SELECT trip_expense_id, original_buy_amount, adjusted_buy_amount FROM settlement_expenses WHERE settlement_id = ${sid};`),
  '-- ledger: OPS_ADVANCE credit (cấp 100k) + OPS_SETTLEMENT debit (quyết toán = 150k − 50k = 100k)',
  PSQL(`SELECT id, txn_type, txn_id, entity_id, debit, credit, note FROM ledger WHERE (txn_type = 'OPS_ADVANCE' AND txn_id = ${advance.id}) OR (txn_type = 'OPS_SETTLEMENT' AND txn_id = ${sid}) ORDER BY id;`),
  '-- treasury disbursement OUT',
  PSQL(`SELECT id, direction, amount, status FROM treasury_movements WHERE ledger_entry_id = ${apprRes.body?.funding?.ledgerEntryId ?? 0};`),
].join('\n');
fs.writeFileSync(path.join(OUT, 'db-proof.txt'), dbProof + '\n');
log('DB proof written qa/2026-10-21-hoanung-am/db-proof.txt');
const checkedByDb = PSQL(`SELECT COALESCE(checked_by::text, 'NULL') FROM advance_settlements WHERE id = ${sid};`).trim();
const refundDb = PSQL(`SELECT refund_amount FROM advance_settlements WHERE id = ${sid};`).trim();
check('DB row: refund_amount −50000 + checked_by = kế toán', refundDb === '-50000' && checkedByDb === String(kt.user?.id), `refund=${refundDb} checked_by=${checkedByDb}`);
const settleDebit = PSQL(`SELECT debit FROM ledger WHERE txn_type = 'OPS_SETTLEMENT' AND txn_id = ${sid};`).trim();
check('ledger OPS_SETTLEMENT debit = 100.000 (chi 150k + hoàn −50k → hội tụ về tạm ứng)', settleDebit === '100000', settleDebit);

// ── Summary ──────────────────────────────────────────────────────────────────
const summary = {
  tag: TAG, settlementId: sid, code: settlement.code, refundAmount: settlement.refundAmount,
  advanceId: advance.id, expenseId: expense.id, accountantId: kt.user?.id, opsUserId: opsId,
  failures,
};
fs.writeFileSync(path.join(OUT, 'probe-result.json'), JSON.stringify(summary, null, 2) + '\n');
log(`DONE failures=${failures} settlement=${settlement.code} (#${sid}) refund=${settlement.refundAmount}`);
process.exit(failures === 0 ? 0 : 1);
