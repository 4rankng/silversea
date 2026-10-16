// Card 141026230720 (P3) INDEPENDENT QA-gate verify — wave fix/backlog-1016, r2.
// Verifies the OPS duplicate cost-entry warning on staging build 227a08b2:
//   C1 regression: OPS hoangnh saves a container cost via Khai chi phí — OK.
//   C2 same type + same cont re-entered → FE confirm panel (explicit confirm
//      required; Kiểm tra lại dismisses without saving; Tiếp tục lưu saves)
//      + API POST without duplicateConfirmed → 409 OPS_EXPENSE_DUPLICATE
//      (same author AND a second OPS account).
//   C3 lot-wide fee (no container) duplicated → same warning path.
//   C4 split payment: different amount, same type+cont, WITH confirm → saves.
//   C5 different cost type on the same cont → NO duplicate block.
// Fixtures: note 'QA 141026230720-r2 …' (purge-registry matchable), voided at
// the end by each author; residue swept by the sanctioned `make qapurge`.
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const QA = 'qa';
const TAG = '141026230720-r2';
const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const EXPECTED_BUILD = '227a08b2';
const NOTE = `QA ${TAG} — duplicate-warning verify, xóa ngay sau kiểm tra`;
const PREFIX = `${QA}/2026-10-16_${TAG}`;
mkdirSync(QA, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (s, o) => {
  const e = { at: new Date().toISOString(), step: s, ...o };
  appendFileSync(`${PREFIX}_ui-driver.log`, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};
const verdicts = {};
const mark = (caseId, pass, evidence) => {
  verdicts[caseId] = { pass, evidence };
  step('verdict', { caseId, pass, evidence });
};

// ── 0. build gate ─────────────────────────────────────────────────────────────
const health = await (await fetch(`${API}/health`)).json();
step('health', health);
if (health.buildHash !== EXPECTED_BUILD) {
  writeFileSync(`${PREFIX}_summary.json`, JSON.stringify({ card: TAG, verdict: 'BLOCKED', reason: `buildHash ${health.buildHash} ≠ ${EXPECTED_BUILD}` }, null, 2));
  throw new Error(`buildHash ${health.buildHash} ≠ expected ${EXPECTED_BUILD} — BLOCKED`);
}

// ── 1. logins: primary OPS (hoangnh) + second OPS (hungld) ────────────────────
async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  const body = await res.json();
  const token = body.token ?? body.accessToken ?? body?.data?.token;
  step('login', { identifier, status: res.status, gotToken: Boolean(token), role: body.user?.role ?? null });
  if (!token) throw new Error(`no token for ${identifier}`);
  return { token, user: body.user ?? null, auth: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}
const me = await login('hoangnh');
const other = await login('hungld');

// ── 2. catalog + target lot ───────────────────────────────────────────────────
const vnDate = (offset = 0) => new Date(Date.now() + 7 * 3600 * 1000 + offset * 86400 * 1000).toISOString().slice(0, 10);
const typesRes = await fetch(`${API}/ops/expense-types`, { headers: me.auth });
const typesJson = await typesRes.json();
const catalog = typesJson.items ?? [];
step('catalog', { status: typesRes.status, count: catalog.length, sample: catalog.slice(0, 6).map((t) => ({ code: t.code, name: t.name, requiresInvoice: t.requiresInvoice })) });
if (catalog.length < 3) throw new Error('need >= 3 active expense types on staging');

async function createExpense(account, { shipmentId, shipmentContainerId = null, expenseTypeCode, amount, note = NOTE }) {
  const res = await fetch(`${API}/ops/expenses`, {
    method: 'POST',
    headers: { ...account.auth, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ shipmentId, shipmentContainerId, expenseTypeCode, amount, paidAt: vnDate(), note }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
async function voidExpense(account, id, reason) {
  const res = await fetch(`${API}/ops/expenses/${id}`, {
    method: 'DELETE',
    headers: { ...account.auth, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ reason }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// Lot scan: first container-bearing lot in the last 7 VN days.
let target = null;
const scanned = [];
for (let offset = 0; offset >= -6 && !target; offset--) {
  const date = vnDate(offset);
  const res = await fetch(`${API}/ops/orders?date=${date}`, { headers: me.auth });
  if (!res.ok) continue;
  const items = (await res.json()).items ?? [];
  const withConts = items.filter((i) => i.containerCount > 0 && i.containerIds?.length > 0);
  scanned.push({ date, total: items.length, withConts: withConts.length });
  if (withConts.length) target = { date, order: withConts[0] };
}
step('orders-scan', { scanned, chosen: target ? { date: target.date, id: target.order.id, billRef: target.order.billRef, conts: target.order.containerNumbers } : null });
if (!target) throw new Error('no container-bearing lot found on staging');
const LOT = target.order.id;

// Establish clean pairs via API probes. A 409 probe writes NOTHING (the
// duplicate check runs before the insert inside the caller's tx); a 201 probe
// creates a fixture row that is voided immediately, leaving a tombstone.
const tombstones = { me: [], other: [] }; // author-scoped cleanup
async function findCleanType(candidateCodes, containerId) {
  for (const type of candidateCodes) {
    const probe = await createExpense(me, { shipmentId: LOT, shipmentContainerId: containerId, expenseTypeCode: type.code, amount: '1000' });
    if (probe.status === 201) {
      tombstones.me.push(probe.body.id);
      const del = await voidExpense(me, probe.body.id, `QA ${TAG} — probe fixture void`);
      step('probe-clean', { type: type.code, containerId, createdId: probe.body.id, voided: del.status });
      return type;
    }
    step('probe-dirty', { type: type.code, containerId, status: probe.status, code: probe.body?.code ?? probe.body?.error?.code ?? null });
    if (probe.status !== 409) throw new Error(`probe for ${type.code} returned ${probe.status}: ${JSON.stringify(probe.body).slice(0, 300)}`);
  }
  return null;
}
const noInvoiceFirst = [...catalog].sort((a, b) => (a.requiresInvoice === true ? 1 : 0) - (b.requiresInvoice === true ? 1 : 0));
const C1 = target.order.containerIds[0];
const C1_NO = target.order.containerNumbers[0];
const T1 = await findCleanType(noInvoiceFirst, C1);                       // cont-scope main type
const T3 = await findCleanType(noInvoiceFirst.filter((t) => t.code !== T1?.code), null); // lot-wide type
const T2 = await findCleanType(noInvoiceFirst.filter((t) => t.code !== T1?.code), C1);   // different-type-on-C1
step('fixture-plan', { lot: LOT, C1, C1_NO, T1: T1?.code, T2: T2?.code, T3: T3?.code });
if (!T1 || !T2 || !T3) throw new Error('could not establish clean type/cont pairs on staging');

// ── 3. UI drive ───────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const apiLog = []; // every /api/ops/expenses POST response the SPA exchanges
const walletRows = async (account, status = 'RECORDED') => {
  const res = await fetch(`${API}/ops/wallet/expenses?status=${status}&limit=100`, { headers: account.auth });
  const body = await res.json();
  return (body.items ?? []).filter((r) => (r.note ?? '').includes(TAG) && r.shipmentId === LOT);
};
try {
  const page = await browser.newPage();
  page.on('response', async (res) => {
    if (res.url().includes('/api/ops/expenses') && ['POST', 'PATCH', 'DELETE'].includes(res.request().method())) {
      const body = await res.json().catch(() => null);
      apiLog.push({ at: new Date().toISOString(), method: res.request().method(), status: res.status(), body });
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), me.token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/ops/orders?date=${target.date}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let rows = 0;
  for (let i = 0; i < 24 && !rows; i++) { await sleep(2500); rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
  step('page', { url: page.url(), rows });
  if (!rows) throw new Error('orders table did not render');

  const realClick = async (predicateSource) => {
    const handle = await page.evaluateHandle(`(${predicateSource})()`);
    const el = handle.asElement();
    if (!el) { await handle.dispose(); return false; }
    await el.click();
    await handle.dispose();
    return true;
  };

  // Open the Khai chi phí modal on the target lot's row.
  async function openModal() {
    const opened = await page.evaluate((billRef) => {
      const trs = [...document.querySelectorAll('tbody tr')];
      const row = trs.find((r) => billRef && r.innerText.includes(billRef));
      const btn = (row ?? trs.find((r) => r.querySelector('button.ops-orders__expense')))?.querySelector('button.ops-orders__expense');
      if (!btn) return null;
      btn.click();
      return row?.innerText.replace(/\s+/g, ' ').slice(0, 120) ?? null;
    }, target.order.billRef ?? '');
    for (let i = 0; i < 12; i++) { await sleep(1000); if (await page.evaluate(() => Boolean(document.querySelector('.ops-modal')))) break; }
    const state = await page.evaluate(() => ({
      open: Boolean(document.querySelector('.ops-modal')),
      title: document.querySelector('.ops-modal__head h2')?.textContent ?? null,
      contChoice: null,
    }));
    step('modal-open', { clickedRow: opened, ...state });
    if (!state.open) throw new Error('Khai báo chi phí modal did not open');
    return state;
  }

  // UuiSelectField drive: trigger by label (React Aria button, or combobox
  // input when the catalog exceeds the search threshold), then click the
  // matching portalled [role=option]. 'Phí chung lô' = lot-wide choice.
  async function pickSelect(label, optionText, isCombobox) {
    const triggerShown = () => page.evaluate((lbl) => {
      const own = (el) => {
        const a = el.getAttribute('aria-label') ?? '';
        if (a.includes(lbl)) return true;
        const labelled = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
        return labelled.includes(lbl);
      };
      const btn = [...document.querySelectorAll('.ops-modal button')].find(own);
      if (btn) return btn.textContent?.trim() ?? null;
      const input = [...document.querySelectorAll('.ops-modal input[role="combobox"]')].find(own);
      return input?.value?.trim() ?? null;
    }, label);
    for (let attempt = 0; attempt < 3; attempt++) {
      const trig = await realClick(`() => {
        const want = ${JSON.stringify(label)};
        const byName = (n) => {
          const own = n.getAttribute('aria-label') ?? '';
          if (own.includes(want)) return true;
          const labelled = (n.getAttribute('aria-labelledby') ?? '').split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
          return labelled.includes(want);
        };
        return [...document.querySelectorAll('.ops-modal button, .ops-modal input')].find((n) => n.matches('input') ? (n.getAttribute('role') === 'combobox' && byName(n)) : byName(n)) ?? null;
      }`);
      await sleep(900);
      if (isCombobox) {
        // select-all then type: retries must REPLACE the previous query, not append
        await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await sleep(300);
        await page.keyboard.type(optionText.slice(0, 8), { delay: 45 });
        await sleep(900);
      }
      let picked = false;
      for (let i = 0; i < 8 && !picked; i++) {
        picked = await realClick(`() => [...document.querySelectorAll('[role="option"]')].filter((o) => !o.getAttribute('aria-disabled')).find((o) => o.textContent?.trim() === ${JSON.stringify(optionText)}) ?? null`);
        if (!picked) await sleep(700);
      }
      await sleep(500);
      const shown = await triggerShown();
      const committed = shown === optionText;
      step('select-pick', { label, optionText, triggerClicked: trig, picked, shown, committed, attempt });
      if (committed) return;
    }
    throw new Error(`could not pick "${optionText}" in ${label}`);
  }

  async function fillAmount(text) {
    const ok = await realClick(`() => [...document.querySelectorAll('.ops-modal input')].find((i) => /Thực chi/i.test(i.getAttribute('aria-label') ?? '') || /Thực chi/i.test(i.closest('label')?.textContent ?? i.parentElement?.textContent ?? '')) ?? null`);
    await page.keyboard.type(text, { delay: 30 });
    await sleep(300);
    if (!ok) throw new Error('Thực chi input not found');
  }
  async function fillNote(text) {
    const ok = await realClick(`() => document.querySelector('.ops-modal textarea') ?? null`);
    await page.keyboard.type(text, { delay: 4 });
    await sleep(200);
    if (!ok) throw new Error('note textarea not found');
  }
  async function clickSave() {
    const apiLogLen = apiLog.length;
    const clicked = await page.evaluate(() => {
      const save = document.querySelector('.ops-modal button[type="submit"]');
      if (!save || save.disabled) return { clicked: false, disabled: save?.disabled ?? null };
      save.click();
      return { clicked: true, disabled: false };
    });
    step('save-click', clicked);
    return apiLogLen;
  }
  const modalOpen = () => page.evaluate(() => Boolean(document.querySelector('.ops-modal')));
  const panel = () => page.evaluate(() => {
    const p = document.querySelector('.ops-modal .ops-modal__duplicate');
    if (!p) return null;
    return { text: p.textContent?.replace(/\s+/g, ' ').trim(), buttons: [...p.querySelectorAll('button')].map((b) => b.textContent?.trim()) };
  });
  async function waitFor(pred, timeoutMs, everyMs = 800) {
    for (let i = 0; i * everyMs < timeoutMs; i++) {
      const v = await pred();
      if (v) return v;
      await sleep(everyMs);
    }
    return null;
  }
  async function toastAfterSave() {
    return waitFor(() => page.evaluate(() => {
      const modalGone = !document.querySelector('.ops-modal');
      const toasts = [...document.querySelectorAll('[role="status"], .toast, [class*="toast"]')].map((n) => n.textContent?.trim()).filter((t) => t && t.length < 200);
      return modalGone ? (toasts.at(-1) ?? 'modal-closed') : (toasts.find((t) => t.includes('khoản chi')) ?? null);
    }), 15000);
  }

  const shot = (name) => page.screenshot({ path: `${PREFIX}_${name}.png`, fullPage: true });

  // ── CASE 1 — regression: container cost saves (unique Idempotency-Key) ────
  await openModal();
  await shot('case1_dialog-open');
  await pickSelect('Số Cont', C1_NO, false);
  await pickSelect('Loại phí', T1.name, true);
  await fillAmount('150000');
  await fillNote(NOTE);
  const c1LogStart = await clickSave();
  const c1Toast = await toastAfterSave();
  await shot('case1_after-save');
  const c1Api = apiLog.slice(c1LogStart);
  const c1Wallet = await waitFor(async () => (await walletRows(me)).find((r) => r.amount === '150000') ?? null, 12000);
  step('case1-result', { toast: c1Toast, api: c1Api.map((e) => ({ status: e.status })), walletRow: c1Wallet ? { id: c1Wallet.id, amount: c1Wallet.amount, type: c1Wallet.expenseTypeCode, cont: c1Wallet.containerNumber } : null });
  const rowA = c1Wallet;
  mark('C1', Boolean(rowA) && c1Api.some((e) => e.status === 201),
    `UI save 201; wallet row ${rowA ? `id=${rowA.id} 150.000đ ${rowA.expenseTypeCode} @${rowA.containerNumber}` : 'MISSING'}; shot case1_after-save.png`);

  // ── CASE 2 — same type + same cont: panel, explicit confirm, 409 ──────────
  await openModal();
  await pickSelect('Số Cont', C1_NO, false);   // claimants heads-up may also appear (old warning — record it)
  const headsUp = await page.evaluate(() => document.querySelector('.ops-modal .ops-modal__warning:not(.ops-modal__duplicate)')?.textContent?.trim() ?? null);
  await pickSelect('Loại phí', T1.name, true);
  await fillAmount('180000');
  await fillNote(NOTE);
  const c2LogStart = await clickSave();
  const seenPanel = await waitFor(panel, 12000);
  step('case2-panel', { panel: seenPanel, stillOpen: await modalOpen(), headsUpBeforeSave: headsUp });
  await shot('case2_confirm-panel');
  const c2NewApi = apiLog.slice(c2LogStart);
  const walletCountBeforeConfirm = (await walletRows(me)).length;

  // Explicit-confirm requirement: dismiss via Kiểm tra lại → no save.
  let dismissOk = false;
  if (seenPanel) {
    await realClick(`() => [...document.querySelectorAll('.ops-modal button')].find((b) => b.textContent?.trim() === 'Kiểm tra lại') ?? null`);
    await sleep(1200);
    const afterDismiss = { panelGone: (await panel()) === null, modalStillOpen: await modalOpen() };
    dismissOk = afterDismiss.panelGone && afterDismiss.modalStillOpen;
    step('case2-dismiss', { ...afterDismiss, walletCountUnchanged: (await walletRows(me)).length === walletCountBeforeConfirm });
    await shot('case2_kiemtra-dismissed');
    // Lưu again → panel must return; then explicit confirm.
    const c2bLogStart = await clickSave();
    const panelAgain = await waitFor(panel, 12000);
    step('case2-panel-again', { panel: panelAgain ? panelAgain.text?.slice(0, 120) : null });
    await realClick(`() => [...document.querySelectorAll('.ops-modal button')].find((b) => b.textContent?.trim() === 'Tiếp tục lưu') ?? null`);
    const c2Toast = await toastAfterSave();
    await shot('case2_after-confirm-save');
    const rowB = await waitFor(async () => (await walletRows(me)).find((r) => r.amount === '180000') ?? null, 12000);
    step('case2-confirm-result', { toast: c2Toast, rowB: rowB ? { id: rowB.id, amount: rowB.amount } : null, api: apiLog.slice(c2bLogStart).map((e) => ({ status: e.status })) });
    mark('C2-ui', Boolean(rowB) && Boolean(panelAgain) && dismissOk,
      `panel required; Kiểm tra lại dismissed w/o save; Tiếp tục lưu saved row ${rowB ? rowB.id : 'MISSING'} (180.000đ)`);
  } else {
    mark('C2-ui', false, 'duplicate confirm panel never appeared after Lưu');
  }
  const panelApi409 = c2NewApi.some((e) => e.status === 409);

  // ── CASE 2b — API contract: 409 OPS_EXPENSE_DUPLICATE without confirm ─────
  const api409same = await createExpense(me, { shipmentId: LOT, shipmentContainerId: C1, expenseTypeCode: T1.code, amount: '190000' });
  const otherOrders = await fetch(`${API}/ops/orders?date=${target.date}`, { headers: other.auth });
  const otherOrdersJson = await otherOrders.json().catch(() => ({ items: [] }));
  const otherSeesLot = (otherOrdersJson.items ?? []).some((i) => i.id === LOT);
  const api409other = await createExpense(other, { shipmentId: LOT, shipmentContainerId: C1, expenseTypeCode: T1.code, amount: '190000' });
  const otherConfirmed = await createExpense(other, { shipmentId: LOT, shipmentContainerId: C1, expenseTypeCode: T1.code, amount: '195000', note: `${NOTE} (second-account confirmed)` });
  if (otherConfirmed.status === 201) tombstones.other.push(otherConfirmed.body.id);
  step('case2-api', {
    sameAuthor: { status: api409same.status, code: api409same.body?.code ?? api409same.body?.error?.code ?? null, duplicates: api409same.body?.duplicates ?? api409same.body?.error?.duplicates ?? null },
    secondAccount: { status: api409other.status, code: api409other.body?.code ?? api409other.body?.error?.code ?? null, seesLotInOrders: otherSeesLot },
    secondConfirmedSave: { status: otherConfirmed.status, id: otherConfirmed.body?.id ?? null },
  });
  mark('C2-api', api409same.status === 409 && (api409same.body?.code ?? api409same.body?.error?.code) === 'OPS_EXPENSE_DUPLICATE' && api409other.status === 409,
    `no-confirm POST → 409 OPS_EXPENSE_DUPLICATE (same author) + 409 (second account hungld); confirmed override → ${otherConfirmed.status}`);
  writeFileSync(`${PREFIX}_api-409-bodies.json`, JSON.stringify({ sameAuthor: api409same, secondAccount: api409other, secondConfirmed: otherConfirmed }, null, 2));

  // ── CASE 3 — lot-wide fee duplicated → same warning path ──────────────────
  await openModal();
  // containerChoice defaults to 'Phí chung lô' (LOT) — leave untouched.
  const lotChoice = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ops-modal button')].find((b) => {
      const labelled = (b.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      return (b.getAttribute('aria-label') ?? '').includes('Số Cont') || labelled.includes('Số Cont');
    });
    return btn?.textContent?.trim() ?? null;
  });
  step('case3-default-choice', { contTriggerLabel: lotChoice });
  await pickSelect('Loại phí', T3.name, true);
  await fillAmount('100000');
  await fillNote(NOTE);
  const c3LogStart = await clickSave();
  const c3Toast = await toastAfterSave();
  await shot('case3_lotwide-after-first-save');
  const rowD = await waitFor(async () => (await walletRows(me)).find((r) => r.amount === '100000') ?? null, 12000);
  step('case3-first-save', { toast: c3Toast, rowD: rowD ? { id: rowD.id } : null });
  // Re-enter the same lot-wide pair → panel → confirm.
  await openModal();
  await pickSelect('Loại phí', T3.name, true);
  await fillAmount('110000');
  await fillNote(NOTE);
  const c3bLogStart = await clickSave();
  const c3Panel = await waitFor(panel, 12000);
  step('case3-panel', { panel: c3Panel?.text?.slice(0, 160) ?? null, scopeNote: c3Panel?.text?.includes('phí chung lô') ?? null });
  await shot('case3_lotwide_confirm-panel');
  let rowE = null;
  if (c3Panel) {
    await realClick(`() => [...document.querySelectorAll('.ops-modal button')].find((b) => b.textContent?.trim() === 'Tiếp tục lưu') ?? null`);
    await toastAfterSave();
    await shot('case3_lotwide-after-confirm-save');
    rowE = await waitFor(async () => (await walletRows(me)).find((r) => r.amount === '110000') ?? null, 12000);
  }
  step('case3-confirm-result', { rowE: rowE ? { id: rowE.id } : null });
  const api409lotwide = await createExpense(me, { shipmentId: LOT, shipmentContainerId: null, expenseTypeCode: T3.code, amount: '120000' });
  step('case3-api', { status: api409lotwide.status, code: api409lotwide.body?.code ?? api409lotwide.body?.error?.code ?? null });
  mark('C3', Boolean(rowD) && Boolean(c3Panel) && Boolean(rowE) && api409lotwide.status === 409,
    `lot-wide save OK (row ${rowD?.id ?? 'MISSING'}); re-entry → panel → confirm saved row ${rowE?.id ?? 'MISSING'}; API no-confirm → ${api409lotwide.status}`);

  // ── CASE 4 — split payment: different amount, same type+cont, confirmed ───
  const splitRows = (await walletRows(me)).filter((r) => r.expenseTypeCode === T1.code && r.containerNumber === C1_NO);
  step('case4-split-rows', { rows: splitRows.map((r) => ({ id: r.id, amount: r.amount, status: r.approvalStatus })) });
  const amounts = new Set(splitRows.map((r) => r.amount));
  mark('C4', splitRows.length >= 2 && amounts.size >= 2,
    `${splitRows.length} live rows on (${T1.code}, ${C1_NO}) with distinct amounts ${[...amounts].join(' + ')}đ — confirmed split persisted, not silently blocked/merged`);

  // ── CASE 5 — different type on the same cont: NO duplicate block ──────────
  await openModal();
  await pickSelect('Số Cont', C1_NO, false);
  await pickSelect('Loại phí', T2.name, true);
  await fillAmount('130000');
  await fillNote(NOTE);
  const c5LogStart = await clickSave();
  // Watch briefly: a duplicate panel here would be a WRONG block.
  let wrongPanel = null;
  for (let i = 0; i < 6; i++) { wrongPanel = await panel(); if (wrongPanel) break; await sleep(700); }
  const c5Toast = await toastAfterSave();
  await shot('case5_no-block-after-save');
  const rowF = await waitFor(async () => (await walletRows(me)).find((r) => r.amount === '130000') ?? null, 12000);
  const c5No409 = !apiLog.slice(c5LogStart).some((e) => e.status === 409);
  step('case5-result', { wrongPanelAppeared: Boolean(wrongPanel), toast: c5Toast, rowF: rowF ? { id: rowF.id, type: rowF.expenseTypeCode } : null, no409: c5No409 });
  mark('C5', Boolean(rowF) && !wrongPanel && c5No409,
    `(${T2.code} ≠ ${T1.code}) on ${C1_NO} saved directly — no panel, no 409; row ${rowF?.id ?? 'MISSING'}`);

  // Persist the SPA-exchanged API evidence.
  writeFileSync(`${PREFIX}_spa-api-exchanges.json`, JSON.stringify(apiLog, null, 2));
} catch (e) {
  step('DRIVER-FAIL', { error: String(e && e.message ? e.message : e) });
  for (const [caseId, v] of Object.entries(verdicts)) if (v.pass == null) verdicts[caseId] = { pass: false, evidence: 'driver aborted before this case' };
  try { await browser.close(); } catch {}
  writeFileSync(`${PREFIX}_summary.json`, JSON.stringify({ card: TAG, build: health.buildHash, date: new Date().toISOString(), verdicts, note: 'DRIVER-FAILED — rows may remain, qapurge still required' }, null, 2));
  process.exitCode = 1;
  // fall through to cleanup below via a fresh browser-less path
}

// ── 4. cleanup: every author voids its own fixtures ───────────────────────────
const voided = [];
for (const id of tombstones.me) voided.push({ id, by: 'hoangnh', ...await voidExpense(me, id, `QA ${TAG} — verify fixture`) });
for (const r of await walletRows(me)) voided.push({ id: r.id, by: 'hoangnh', ...await voidExpense(me, r.id, `QA ${TAG} — verify fixture`) });
for (const id of tombstones.other) voided.push({ id, by: 'hungld', ...await voidExpense(other, id, `QA ${TAG} — verify fixture`) });
for (const r of await walletRows(other)) voided.push({ id: r.id, by: 'hungld', ...await voidExpense(other, r.id, `QA ${TAG} — verify fixture`) });
const voidedList = (await Promise.all([
  fetch(`${API}/ops/wallet/expenses?status=VOIDED&limit=100`, { headers: me.auth }).then((r) => r.json()),
  fetch(`${API}/ops/wallet/expenses?status=VOIDED&limit=100`, { headers: other.auth }).then((r) => r.json()),
])).flatMap((b) => b.items ?? []).filter((r) => (r.note ?? '').includes(TAG));
step('cleanup', { attempted: voided.map((v) => ({ id: v.id, status: v.status })), verifiedVoided: voidedList.map((r) => r.id) });
await browser.close().catch(() => {});

const allPass = Object.values(verdicts).length >= 5 && Object.values(verdicts).every((v) => v.pass);
writeFileSync(`${PREFIX}_summary.json`, JSON.stringify({ card: TAG, build: health.buildHash, date: new Date().toISOString(), lot: LOT, verdicts, cleanup: { attempted: voided.length, verifiedVoided: voidedList.length }, verdict: allPass ? 'PASS' : 'FAIL' }, null, 2));
console.log(`141026230720-r2 STAGING VERIFY: ${allPass ? 'PASS' : 'FAIL'} — ${JSON.stringify(verdicts)}`);
if (!allPass) process.exitCode = 1;
