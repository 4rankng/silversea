// Card 071026210510 — the Khai chi phí dialog must refuse BEFORE input for an
// unassigned OPS. Real UI: login giaonhan (local OPS), find a lot the grant
// probe marks unwritable, open its dialog, assert the refusal banner + Lưu
// disabled. Positive/negative legs backed by pins + route tests.
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const CARD = 'card071026210510';
const BASE = 'http://localhost:7175';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${QA}/2026-10-08_${CARD}_ui-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'giaonhan', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token), role: session.user?.role ?? null });
// The orders page windows on the Vietnam-local day — match it, or the UI
// table and the API discovery disagree by one date.
const vnToday = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
// Scan a few Vietnam-local days — the fixture lot's plan date need not be today.
let target = null;
const verdicts = [];
let today = vnToday;
for (let offset = 0; offset >= -4 && !target; offset--) {
  today = new Date(Date.now() + 7 * 3600 * 1000 + offset * 86400 * 1000).toISOString().slice(0, 10);
  const ordersRes = await fetch(`http://localhost:3002/api/ops/orders?date=${today}`, { headers: { Authorization: `Bearer ${token}` } });
  const orders = await ordersRes.json();
  const items = orders.items ?? orders.data?.items ?? [];
  step('orders', { date: today, count: items.length, ids: items.map((o) => o.id).slice(0, 8) });
  for (const item of items.slice(0, 10)) {
    const r = await fetch(`http://localhost:3002/api/ops/expenses/write-scope?shipmentId=${item.id}`, { headers: { Authorization: `Bearer ${token}` } });
    const verdict = await r.json();
    verdicts.push({ date: today, id: item.id, ...verdict });
    if (!verdict.writable) { target = { ...item, index: items.indexOf(item) }; break; }
  }
}
step('scope-verdicts', { verdicts, chosen: target ? { id: target.id, billRef: target.billRef } : null });
if (!target) throw new Error('every sampled lot is writable for giaonhan — refusal leg needs a fixture lot');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/ops/orders`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Point the page's own date field at the discovery date — the page windows
  // on the local day and defaults to today, the fixture lot may not.
  // The date field is a SEGMENTED input (day/month/year segments with shared
  // aria-labels "… — Ngày giao dự kiến"); set the day segment only.
  let dateInputReady = false;
  for (let i = 0; i < 10 && !dateInputReady; i++) { await sleep(2000); dateInputReady = await page.evaluate(() => Boolean(document.querySelector('input[aria-label*="Ngày giao dự kiến"]'))); }
  if (!dateInputReady) throw new Error('date field did not render');
  await page.evaluate((d) => {
    const monthInput = document.querySelector('input[aria-label*="Ngày giao dự kiến"]');
    const wrapper = monthInput?.closest('[data-input-wrapper]') ?? monthInput?.parentElement?.parentElement;
    const segments = wrapper ? [...wrapper.querySelectorAll('input')].filter((i) => i.type === 'text') : [];
    const day = segments.find((i) => { const a = i.getAttribute('aria-label') ?? ''; return !a.includes('Tháng') && !a.includes('Năm'); }) ?? segments[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(day, d.slice(8, 10));
    day.dispatchEvent(new Event('input', { bubbles: true }));
    day.dispatchEvent(new Event('change', { bubbles: true }));
    day.dispatchEvent(new Event('blur', { bubbles: true }));
  }, today);
  let rows = 0;
  for (let i = 0; i < 15 && !rows; i++) { await sleep(3000); rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
  step('page', { dateSetTo: today, rows });
  if (!rows) throw new Error('orders table did not render');
  const clicked = await page.evaluate((idx) => {
    const row = document.querySelectorAll('tbody tr')[idx];
    const btn = row?.querySelector('button.ops-orders__expense');
    if (!btn) return null;
    btn.click();
    return row.innerText.replace(/\s+/g, ' ').slice(0, 120);
  }, target.index);
  step('dialog-open', { clicked });
  if (!clicked) throw new Error('Khai chi phí button not found on the target row');
  await sleep(2000);
  const verdict = await page.evaluate(() => {
    const modal = document.querySelector('.ops-modal');
    const alert = modal?.querySelector('[role="alert"]');
    const save = [...(modal?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === 'Lưu');
    const fieldset = modal?.querySelector('fieldset');
    return {
      modalOpen: Boolean(modal),
      refusalText: alert?.textContent?.trim() ?? null,
      saveDisabled: save?.disabled ?? null,
      formDisabled: fieldset?.disabled ?? null,
    };
  });
  step('dialog-verdict', verdict);
  await page.screenshot({ path: `${QA}/2026-10-08_${CARD}_ui-expense-refusal.png` });
  if (!verdict.modalOpen) throw new Error('modal did not open');
  if (!verdict.refusalText?.includes('không thuộc xe bạn phụ trách')) throw new Error('refusal banner missing or wrong: ' + JSON.stringify(verdict));
  if (!verdict.saveDisabled) throw new Error('Lưu not disabled under refusal');
  console.log('RUNG EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
