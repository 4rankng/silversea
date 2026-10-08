// Card 375 — UI rung on the LOCAL stack (HEAD): verify the four deposit-tracker
// spec points against seeded fixtures. Mutation surface: NONE — create rows via
// API (fixture-marked), backdate one via psql; in the browser only a date modal
// is OPENED and closed via Hủy (no save tap).
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { launch, shot, setViewport, logEvidence, sleep, tapAt } from './qa-20261005-lib.mjs';

const API = 'http://localhost:3002/api';
const BASE = 'http://localhost:7175';
const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-05_card375-deposit-tracker-audit';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) throw new Error('local login failed');
const post = (path, body) => fetch(`${API}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

// ── seed fixtures ───────────────────────────────────────────────────────────
const mk = (bill, customer, deposit, extra = {}) => post('/accounting/deposits', {
  billNumber: bill, customerName: customer, carrierName: 'Hãng tàu QA', depositAmount: deposit,
  note: '[fixture card375]', ...extra,
});
const a = await mk('BILL-375-A', 'Khách Cược A', 4000000);
const b = await mk('BILL-375-B', 'Khách Cược B', 2500000, { cvSubmittedDate: '2026-10-01' });
const c = await mk('BILL-375-C', 'Khách Cược C', 1000000);
log('seed', { a: a.status, b: b.status, c: c.status });
if (a.status !== 201 || b.status !== 201 || c.status !== 201) throw new Error(`seed failed: ${JSON.stringify({ a, b, c }).slice(0, 300)}`);
const idA = a.body.id, idB = b.body.id, idC = c.body.id;
const refundC = await post(`/accounting/deposits/${idC}/refund`, {});
log('refundC', { status: refundC.status, status2: refundC.body?.status ?? refundC.body?.row?.status });

// Backdate A to the spec's worked example (deposit 21/09, no CV date by 28/09).
execSync(`docker exec ss-prod-db psql -U postgres -d silversea -c "UPDATE deposit_refund_trackers SET created_at = '2026-09-21T00:00:00Z'::timestamptz WHERE id = ${idA};"`, { stdio: 'pipe' });
log('backdateA', { id: idA, createdAt: '2026-09-21' });

// ── browser rung ────────────────────────────────────────────────────────────
const { browser, page } = await launch({ width: 1440, height: 1000 });
try {
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/accounting/deposit-tracker`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3500);

  const readState = () => page.evaluate(() => {
    const text = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
    return {
      h1: text(document.querySelector('h1')),
      warnings: text(document.querySelector('.deposit-tracker-warnings')),
      rows: [...document.querySelectorAll('tbody tr')].map((tr) => ({
        bill: (tr.innerText.match(/BILL-375-[ABC]/) || [''])[0],
        cells: [...tr.querySelectorAll('td')].slice(0, 8).map(text).map((t) => t.slice(0, 30)),
      })),
      totalLine: text(document.querySelector('[class*="total" i]')) || '',
      filterFrom: document.querySelector('input[aria-label*="Từ"]')?.value ?? '',
      filterTo: document.querySelector('input[aria-label*="Đến"]')?.value ?? '',
    };
  });
  const state = await readState();
  log('state', state);

  for (const width of [1280, 1440, 1920, 2560]) {
    await setViewport(page, width, 1000);
    await shot(page, `${EV}/375-deposit-tracker-${width}-full.png`, { full: true });
    log('shot', { width });
  }

  // Row B date modal: open read-only, read the +14 default, close via Hủy.
  const btn = await page.evaluate((bill) => {
    const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(bill));
    if (!tr) return null;
    const el = [...tr.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.title || x.innerText).includes('Ngày')) ?? tr.querySelector('button');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: el.getAttribute('aria-label') || el.innerText };
  }, 'BILL-375-B');
  if (!btn) throw new Error('row B date button not found');
  await tapAt(page, btn.x, btn.y, { label: 'open-date-modal-B', settle: 900 });
  const modal = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return { open: false };
    const text = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
    return {
      open: true,
      heading: text(dlg.querySelector('h2, h3, [class*="title" i]')),
      inputs: [...dlg.querySelectorAll('input')].map((i) => ({ aria: i.getAttribute('aria-label'), value: i.value })),
      buttons: [...dlg.querySelectorAll('button')].map((x) => text(x)).filter(Boolean),
      hintText: text(dlg.querySelector('[class*="hint" i], p')),
    };
  });
  log('dateModalB', modal);
  await shot(page, `${EV}/375-date-modal-B-1440.png`, { full: false });
  const cancel = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return null;
    const b = [...dlg.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Hủy');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (cancel) await tapAt(page, cancel.x, cancel.y, { label: 'close-modal-Hủy', settle: 600 });
  const afterClose = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')));
  log('modalClosed', { closed: !afterClose });

  logEvidence(EV, 'driver-375.json', { seeded: { idA, idB, idC }, state, modal, log: LOG });
  console.log(`DONE rows=${state.rows.length} warnings="${state.warnings.slice(0, 90)}"`);
} finally {
  await browser.close();
}
