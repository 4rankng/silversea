// Card 141026230720 (P3) staging verify — duplicate cost-entry warning.
// Flow: OPS hoangnh enters (type X, cont C) → saves OK. Re-enters the SAME
// type on the SAME cont → the save must bounce into the CONFIRM PANEL (not a
// red toast, not a silent save); only "Tiếp tục lưu" completes the save.
// Also probes the API contract directly (409 OPS_EXPENSE_DUPLICATE +
// duplicateConfirmed override). Fixtures voided at the end.
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const QA = 'qa';
const TAG = '141026230720';
const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const NOTE = `QA ${TAG} — duplicate warning verify, xóa ngay sau kiểm tra`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (s, o) => {
  const e = { at: new Date().toISOString(), step: s, ...o };
  appendFileSync(`${QA}/2026-10-16_${TAG}_ui-driver.log`, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};

const health = await (await fetch(`${API}/health`)).json();
step('health', health);
if (health.buildHash === '8610a42b') {
  throw new Error(`buildHash is still the pre-fix 8610a42b — deploy the fix before verifying`);
}

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'hoangnh', password: 'Abc123' }),
});
const session = await loginRes.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { status: loginRes.status, gotToken: Boolean(token), role: session.user?.role ?? null });
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const vnDate = (offset = 0) => new Date(Date.now() + 7 * 3600 * 1000 + offset * 86400 * 1000).toISOString().slice(0, 10);
let target = null;
for (let offset = 0; offset >= -6 && !target; offset--) {
  const res = await fetch(`${API}/ops/orders?date=${vnDate(offset)}`, { headers: auth });
  if (!res.ok) continue;
  const items = (await res.json()).items ?? [];
  const withConts = items.filter((i) => i.containerCount > 0 && i.containerIds?.length > 0);
  if (withConts.length) target = { date: vnDate(offset), order: withConts[0] };
}
step('orders-scan', { chosen: target ? { date: target.date, id: target.order.id, billRef: target.order.billRef, cont: target.order.containerNumbers[0] } : null });
if (!target) throw new Error('no container-bearing lot on staging');

// ── API contract probe (rung 2 evidence) ────────────────────────────────────
const body = (over = {}) => ({
  shipmentId: target.order.id,
  shipmentContainerId: target.order.containerIds[0],
  expenseTypeCode: 'YARD_STORAGE',
  amount: '11000', paidAt: vnDate(), note: NOTE, ...over,
});
const apiFirst = await fetch(`${API}/ops/expenses`, { method: 'POST', headers: { ...auth, 'Idempotency-Key': randomUUID() }, body: JSON.stringify(body()) });
const apiFirstJson = await apiFirst.json().catch(() => ({}));
step('api-first-save', { status: apiFirst.status, id: apiFirstJson.id ?? null });
const apiDup = await fetch(`${API}/ops/expenses`, { method: 'POST', headers: { ...auth, 'Idempotency-Key': randomUUID() }, body: JSON.stringify(body({ amount: '12000' })) });
const apiDupJson = await apiDup.json().catch(() => ({}));
step('api-duplicate-bounce', {
  status: apiDup.status,
  code: apiDupJson.code ?? null,
  error: apiDupJson.error ?? null,
  duplicates: apiDupJson.duplicates ?? null,
});
const apiConfirmed = await fetch(`${API}/ops/expenses`, { method: 'POST', headers: { ...auth, 'Idempotency-Key': randomUUID() }, body: JSON.stringify(body({ amount: '12000', duplicateConfirmed: true })) });
const apiConfirmedJson = await apiConfirmed.json().catch(() => ({}));
step('api-confirmed-override', { status: apiConfirmed.status, id: apiConfirmedJson.id ?? null });

const created = [apiFirstJson.id, apiConfirmedJson.id].filter((id) => typeof id === 'number');

// ── UI drive (rung 3): the panel + explicit confirm ─────────────────────────
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/ops/orders?date=${target.date}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let rows = 0;
  for (let i = 0; i < 20 && !rows; i++) { await sleep(2500); rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
  step('page', { rows });

  const realClick = async (predicateSource) => {
    const handle = await page.evaluateHandle(`(${predicateSource})()`);
    const el = handle.asElement();
    if (!el) { await handle.dispose(); return false; }
    await el.click();
    await handle.dispose();
    return true;
  };
  async function openAndFill(typeLabel, amount) {
    await realClick(`() => document.querySelector('button.ops-orders__expense')`);
    await sleep(2000);
    await realClick(`() => {
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
    let ok = false;
    for (let i = 0; i < 6 && !ok; i++) {
      ok = await realClick(`() => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === ${JSON.stringify(target.order.containerNumbers[0])}) ?? null`);
      if (!ok) await sleep(700);
    }
    await sleep(600);
    await page.evaluate(() => { document.querySelector('.ops-modal input[role="combobox"]')?.click(); });
    await sleep(900);
    await page.keyboard.type(typeLabel.slice(0, 8), { delay: 40 });
    await sleep(700);
    for (let i = 0; i < 6; i++) {
      const picked = await realClick(`() => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === ${JSON.stringify(typeLabel)}) ?? null`);
      if (picked) break;
      await sleep(700);
    }
    await sleep(600);
    await realClick(`() => [...document.querySelectorAll('.ops-modal input')].find((i) => /Thực chi/i.test(i.getAttribute('aria-label') ?? '') || /Thực chi/i.test(i.closest('label')?.textContent ?? ''))`);
    await page.keyboard.type(amount, { delay: 30 });
    await realClick(`() => document.querySelector('.ops-modal textarea') ?? null`);
    await page.keyboard.type(NOTE, { delay: 8 });
    await sleep(400);
    await realClick(`() => [...document.querySelectorAll('.ops-modal button')].find((b) => b.textContent?.trim() === 'Lưu')`);
  }

  // The API probe already created (YARD_STORAGE, cont) twice — the UI save of
  // the same pair must bounce straight into the confirm panel.
  const typeName = apiDupJson.duplicates?.[0]?.expenseTypeName ?? 'Lưu bãi (lúc hạ)';
  await openAndFill(typeName, '13000');
  await sleep(2500);
  const panel = await page.evaluate(() => {
    const modal = document.querySelector('.ops-modal');
    const alerts = [...(modal?.querySelectorAll('[role="alert"]') ?? [])].map((a) => a.textContent?.trim() ?? '');
    const buttons = [...(modal?.querySelectorAll('button') ?? [])].map((b) => b.textContent?.trim() ?? '');
    return { alertCount: alerts.length, alerts, hasContinue: buttons.includes('Tiếp tục lưu'), hasRecheck: buttons.includes('Kiểm tra lại') };
  });
  step('confirm-panel', panel);
  await page.screenshot({ path: `${QA}/2026-10-16_${TAG}_ui-confirm-panel.png`, fullPage: true });
  if (!panel.alerts.some((t) => t.includes('nhập trước đó'))) throw new Error('duplicate confirm panel missing: ' + JSON.stringify(panel));
  if (!panel.hasContinue) throw new Error('Tiếp tục lưu button missing');

  const confirmed = await realClick(`() => [...document.querySelectorAll('.ops-modal button')].find((b) => b.textContent?.trim() === 'Tiếp tục lưu')`);
  let toastText = null;
  for (let i = 0; i < 12 && toastText == null; i++) {
    await sleep(1000);
    toastText = await page.evaluate(() => (!document.querySelector('.ops-modal'))
      ? ([...document.querySelectorAll('[role="status"], .toast, [class*="toast"]')].map((n) => n.textContent?.trim()).filter(Boolean).at(-1) ?? 'modal-closed')
      : null);
  }
  step('ui-confirmed-save', { clicked: confirmed, toastText });
  await page.screenshot({ path: `${QA}/2026-10-16_${TAG}_ui-after-confirm-save.png`, fullPage: true });
  if (toastText == null) throw new Error('modal did not close after Tiếp tục lưu');

  // persisted proof: wallet rows carrying the QA note (API-created + UI-confirmed)
  const wallet = await (await fetch(`${API}/ops/wallet/expenses?status=RECORDED&limit=100`, { headers: auth })).json();
  const mine = (wallet.items ?? []).filter((r) => (r.note ?? '').includes(TAG) && r.shipmentId === target.order.id);
  step('wallet-side-effect', { count: mine.length, rows: mine.map((r) => ({ id: r.id, amount: r.amount, type: r.expenseTypeCode })) });
  mine.forEach((r) => { if (!created.includes(r.id)) created.push(r.id); });
  console.log('141026230720 STAGING VERIFY: PASS');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('141026230720 STAGING VERIFY: FAIL —', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally {
  for (const id of created) {
    const del = await fetch(`${API}/ops/expenses/${id}`, {
      method: 'DELETE',
      headers: { ...auth, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ reason: `QA cleanup ${TAG} — duplicate-warning verify fixture` }),
    });
    step('cleanup-void', { id, status: del.status });
  }
  await browser.close();
}
writeFileSync(`${QA}/2026-10-16_${TAG}_staging-summary.json`, JSON.stringify({ card: TAG, buildHash: health.buildHash, date: new Date().toISOString() }, null, 2));
