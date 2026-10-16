// Card 141026230710 (P1) re-check — "Ops không khai được chi phí lô hàng".
// Reported 2026-10-14 on staging: OPS hoangnh could not enter lot costs at all
// (per-vehicle refusal "Lô này không thuộc xe bạn phụ trách" + disabled Lưu).
// W4b/W4b-merges (acf3f950, e717d2cb) shipped cost-permission work after the
// report; this driver re-drives the SAME scenario on staging as OPS:
//   login hoangnh → /ops/orders → "Khai chi phí" on a lot with a container →
//   fill form → Lưu → assert success + API side-effect → void fixture row.
// PASS criteria: modal opens with NO permission refusal, save succeeds,
// row appears in the wallet list, fixture cleaned (VOIDED).
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const QA = 'qa';
const TAG = '141026230710';
const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const EXPECTED_BUILD = '8610a42b';
const NOTE = `QA ${TAG} — recheck quyền khai chi phí Ops, xóa ngay sau kiểm tra`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const step = (s, o) => {
  const e = { at: new Date().toISOString(), step: s, ...o };
  appendFileSync(`${QA}/2026-10-16_${TAG}_ui-driver.log`, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};

// ── 0. build gate ───────────────────────────────────────────────────────────
const health = await (await fetch(`${API}/health`)).json();
step('health', health);
if (health.buildHash !== EXPECTED_BUILD) {
  throw new Error(`buildHash ${health.buildHash} ≠ expected ${EXPECTED_BUILD} — abort, scenario would not be the reported one`);
}

// ── 1. login as the exact account from the card ────────────────────────────
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'hoangnh', password: 'Abc123' }),
});
const session = await loginRes.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { status: loginRes.status, gotToken: Boolean(token), user: session.user?.username ?? null, role: session.user?.role ?? null });
if (!token) throw new Error('no token for hoangnh');

// ── 2. informational: the card's step-2 repro (/shipments 403) — FB-033
// status quo, expected to STILL 403 by owner ruling; NOT a pass criterion. ──
const shipmentsRes = await fetch(`${API}/shipments`, { headers: { Authorization: `Bearer ${token}` } });
step('shipments-probe', { status: shipmentsRes.status, expected: 403, note: 'FB-033 owner ruling: OPS has no /api/shipments policy row — by design' });

// ── 3. find a target lot: container-bearing, accounting unlocked (by trial) ─
const vnDate = (offset = 0) => new Date(Date.now() + 7 * 3600 * 1000 + offset * 86400 * 1000).toISOString().slice(0, 10);
async function fetchOrders(date) {
  const res = await fetch(`${API}/ops/orders?date=${date}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const body = await res.json();
  return body.items ?? body.data?.items ?? null;
}
let target = null;
const scanned = [];
for (let offset = 0; offset >= -6 && !target; offset--) {
  const date = vnDate(offset);
  const items = await fetchOrders(date);
  if (!items) continue;
  const withConts = items.filter((i) => i.containerCount > 0 && i.containerIds?.length > 0);
  scanned.push({ date, count: items.length, withConts: withConts.length });
  if (withConts.length) target = { date, order: withConts[0], index: items.indexOf(withConts[0]) };
}
step('orders-scan', { scanned, chosen: target ? { date: target.date, id: target.order.id, billRef: target.order.billRef, containerNumbers: target.order.containerNumbers, rowIndex: target.index } : null });
if (!target) throw new Error('no container-bearing lot found in the last 7 VN days on staging');

// pre-existing claimants on the chosen lot (informational — the P1 verdict
// does not depend on it; a claimed cont merely shows the shipped warning)
const claimantsBefore = await (await fetch(`${API}/ops/expenses/cont-claimants?shipmentId=${target.order.id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
step('claimants-before', { claimants: claimantsBefore });

// ── 4. drive the real UI ────────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let savedExpenseId = null;
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/ops/orders?date=${target.date}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  let rows = 0;
  for (let i = 0; i < 20 && !rows; i++) { await sleep(2500); rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
  step('page', { url: page.url(), rows });
  if (!rows) throw new Error('orders table did not render (login redirect? check screenshot)');

  // helper: resolve an element via in-page predicate → real CDP click (React
  // Aria press events need genuine pointer input, not DOM .click()).
  const realClick = async (predicateSource) => {
    const handle = await page.evaluateHandle(`(${predicateSource})()`);
    const el = handle.asElement();
    if (!el) { await handle.dispose(); return false; }
    await el.click();
    await handle.dispose();
    return true;
  };

  // Open the dialog on the target row (first container-bearing row we picked).
  const opened = await page.evaluate((billRef) => {
    const trs = [...document.querySelectorAll('tbody tr')];
    const row = trs.find((r) => r.innerText.includes(billRef)) ?? trs[0];
    const btn = row?.querySelector('button.ops-orders__expense');
    if (!btn) return null;
    btn.click();
    return row.innerText.replace(/\s+/g, ' ').slice(0, 160);
  }, target.order.billRef ?? '');
  await sleep(2500);
  const dialogState = await page.evaluate(() => {
    const modal = document.querySelector('.ops-modal');
    const text = modal?.textContent ?? '';
    return {
      modalOpen: Boolean(modal),
      perVehicleRefusal: text.includes('không thuộc xe bạn phụ trách'),
      permissionRefusal: text.includes('không có quyền'),
      anyAlert: modal?.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
    };
  });
  step('dialog-open', { clickedRow: opened, ...dialogState });
  await page.screenshot({ path: `${QA}/2026-10-16_${TAG}_ui-dialog-open.png`, fullPage: true });
  if (!dialogState.modalOpen) throw new Error('Khai chi phí modal did not open');
  if (dialogState.perVehicleRefusal || dialogState.permissionRefusal) throw new Error(`permission refusal still present: ${JSON.stringify(dialogState)}`);

  // Số Cont: React Aria listbox — trigger button carries the label via
  // aria-labelledby; click with real pointer, options portal to <body>.
  const contTriggerClicked = await realClick(`() => {
    const buttons = [...document.querySelectorAll('.ops-modal button')];
    const byLabel = (b) => {
      const label = b.getAttribute('aria-label') ?? '';
      if (/Số Cont/i.test(label)) return true;
      const labelled = (b.getAttribute('aria-labelledby') ?? '').split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      return /Số Cont/i.test(labelled);
    };
    return buttons.find(byLabel) ?? null;
  }`);
  await sleep(900);
  let contChosen = false;
  for (let i = 0; i < 6 && !contChosen; i++) {
    contChosen = await realClick(`() => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === ${JSON.stringify(target.order.containerNumbers[0])}) ?? null`);
    if (!contChosen) await sleep(700);
  }
  await sleep(600);
  step('cont-choice', { contNumber: target.order.containerNumbers[0], triggerClicked: contTriggerClicked, chosen: contChosen });
  if (!contChosen) throw new Error('could not pick the container in the Số Cont select');

  // Loại phí: type-to-search combobox — click, type a fragment of the first
  // real (non-header) catalog entry discovered from the option list itself.
  const typeChosen = await page.evaluate(() => {
    const combo = document.querySelector('.ops-modal input[role="combobox"]');
    if (!combo) return null;
    combo.focus();
    combo.click();
    return true;
  });
  await sleep(900);
  const firstTypeName = await page.evaluate(() => {
    const options = [...document.querySelectorAll('[role="option"]')].filter((o) => !o.getAttribute('aria-disabled') && o.textContent && !o.textContent.startsWith('—') && !/Chọn loại phí/.test(o.textContent ?? ''));
    return options[0]?.textContent?.trim() ?? null;
  });
  if (firstTypeName) {
    await page.keyboard.type(firstTypeName.slice(0, 8), { delay: 40 });
    await sleep(700);
  }
  let typePicked = false;
  for (let i = 0; i < 6 && !typePicked; i++) {
    typePicked = await realClick(`() => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === ${JSON.stringify(firstTypeName)}) ?? null`);
    if (!typePicked) await sleep(700);
  }
  await sleep(600);
  step('type-choice', { comboFocused: typeChosen, chosen: typePicked ? firstTypeName : null });
  if (!typePicked) throw new Error('could not pick a cost type');

  // Thực chi (VND) — real keys into the NumberField.
  const amountClicked = await realClick(`() => [...document.querySelectorAll('.ops-modal input')].find((i) => {
    const own = i.getAttribute('aria-label') ?? '';
    if (/Thực chi/i.test(own)) return true;
    const lbl = i.closest('label')?.textContent ?? i.parentElement?.textContent ?? '';
    return /Thực chi/i.test(lbl);
  }) ?? null`);
  await page.keyboard.type('15000', { delay: 30 });
  // Ghi chú
  await realClick(`() => document.querySelector('.ops-modal textarea') ?? null`);
  await page.keyboard.type(NOTE, { delay: 8 });
  await sleep(400);
  step('form-filled', { amountClicked });

  // Save state before the click — Lưu must be enabled (the P1 symptom was a
  // disabled Lưu under a refusal banner).
  const preSave = await page.evaluate(() => {
    const save = [...document.querySelectorAll('.ops-modal button')].find((b) => b.textContent?.trim() === 'Lưu');
    return { savePresent: Boolean(save), saveDisabled: save?.disabled ?? null };
  });
  step('pre-save', preSave);
  if (preSave.saveDisabled) throw new Error('Lưu is disabled — reported symptom may persist');

  const saveClicked = await page.evaluate(() => {
    const save = [...document.querySelectorAll('.ops-modal button')].find((b) => b.textContent?.trim() === 'Lưu');
    if (!save || save.disabled) return false;
    save.click();
    return true;
  });
  step('save-clicked', { clicked: saveClicked });

  // Watch the POST /api/ops/expenses response (network capture via CDP bind is
  // overkill — the toast + wallet API below prove the side effect).
  let toastText = null;
  for (let i = 0; i < 12 && toastText == null; i++) {
    await sleep(1000);
    toastText = await page.evaluate(() => {
      const modalGone = !document.querySelector('.ops-modal');
      const toasts = [...document.querySelectorAll('[role="status"], .toast, [class*="toast"]')].map((n) => n.textContent?.trim()).filter(Boolean);
      return modalGone ? (toasts.at(-1) ?? 'modal-closed') : (toasts.at(-1) ?? null);
    });
  }
  step('post-save', { toastText, modalClosed: toastText != null });
  await page.screenshot({ path: `${QA}/2026-10-16_${TAG}_ui-after-save.png`, fullPage: true });

  // ── 5. API side-effect proof ──────────────────────────────────────────────
  const walletRes = await fetch(`${API}/ops/wallet/expenses?status=RECORDED&limit=100`, { headers: { Authorization: `Bearer ${token}` } });
  const wallet = await walletRes.json();
  const row = (wallet.items ?? []).find((r) => (r.note ?? '').includes(TAG) && r.shipmentId === target.order.id);
  step('wallet-side-effect', { status: walletRes.status, found: row ? { id: row.id, expenseTypeCode: row.expenseTypeCode, amount: row.amount, containerNumber: row.containerNumber, paidByName: row.paidByName } : null });
  if (!row) throw new Error('saved expense not found in /ops/wallet/expenses — UI save did not persist');
  savedExpenseId = row.id;

  const claimantsAfter = await (await fetch(`${API}/ops/expenses/cont-claimants?shipmentId=${target.order.id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const mine = (claimantsAfter ?? []).find((c) => c.containerNumber === row.containerNumber);
  step('claimants-after', { claimants: claimantsAfter, myClaim: mine ?? null });

  log.push({ verdict: 'PASS', expenseId: row.id });
  console.log('P1 RECHECK: PASS — OPS can declare lot-container costs on staging');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('P1 RECHECK: FAIL —', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally {
  // ── 6. fixture cleanup: void the QA row (explicit confirm of the write) ──
  if (savedExpenseId != null) {
    const del = await fetch(`${API}/ops/expenses/${savedExpenseId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ reason: `QA cleanup ${TAG} — recheck fixture` }),
    });
    const delBody = await del.json().catch(() => ({}));
    step('cleanup-void', { expenseId: savedExpenseId, status: del.status, body: delBody });
    const voidedList = await (await fetch(`${API}/ops/wallet/expenses?status=VOIDED&limit=100`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const voidedRow = (voidedList.items ?? []).find((r) => r.id === savedExpenseId);
    step('cleanup-verify', { voided: Boolean(voidedRow), approvalStatus: voidedRow?.approvalStatus ?? null });
  }
  await browser.close();
}
writeFileSync(`${QA}/2026-10-16_${TAG}_recheck-summary.json`, JSON.stringify({ card: TAG, buildHash: health.buildHash, date: new Date().toISOString(), log }, null, 2));
