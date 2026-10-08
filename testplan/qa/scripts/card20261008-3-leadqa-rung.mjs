// Card 20261008_3 — lead staging QA. Detailed-plan filter chips 'Chưa gán xe'
// / 'Đã gán xe' carry counts equal to the rows each chip reveals (union of
// the fulfillment + planning branches, full-set). Cross-checks chip numbers
// against the plan-rows API and a real chip tap.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card20261008-3-leadqa';
const EXPECT = 'dc599a82';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

// API truth over the union (all pages): assigned vs unassigned rows.
let assigned = 0, unassigned = 0;
for (let p = 1; p <= 3; p++) {
  const r = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&page=${p}`, { headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json()).catch(() => null);
  for (const it of (r?.items ?? [])) {
    if (it?.dispatch?.assignedPlate) assigned++; else unassigned++;
  }
}
log('api-truth', { assigned, unassigned });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
  let rows = 0;
  for (let i = 0; i < 15 && !rows; i++) { await sleep(3000); rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
  log('grid', { rows });

  const chips = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('button,[role="tab"],label')].filter((e) => e.offsetParent !== null);
    const pick = (rx) => {
      const el = cands.find((x) => rx.test((x.textContent || '').replace(/\s+/g, ' ').trim()));
      if (!el) return null;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const r = el.getBoundingClientRect();
      return { text: t, count: Number((t.match(/(\d+)\s*$/) || [])[1] ?? NaN), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    };
    return { unassigned: pick(/^Chưa gán xe/), assigned: pick(/^Đã gán xe/) };
  });
  log('chips', chips);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-chips.png` });
  if (!chips.unassigned || !chips.assigned) { log('FAIL-chips-not-found', { chips }); process.exit(1); }

  // real tap on 'Chưa gán xe' → the grid reveals exactly that many rows
  await page.mouse.click(chips.unassigned.x, chips.unassigned.y);
  await sleep(3500);
  const revealed = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
  log('tap-unassigned', { chipCount: chips.unassigned.count, revealedRows: revealed });

  const checks = [
    { what: 'chip Chưa gán xe = API unassigned', ok: chips.unassigned.count === unassigned, got: chips.unassigned.count, want: unassigned },
    { what: 'chip Đã gán xe = API assigned', ok: chips.assigned.count === assigned, got: chips.assigned.count, want: assigned },
    { what: 'tap Chưa gán xe reveals its count', ok: revealed === chips.unassigned.count, got: revealed, want: chips.unassigned.count },
  ];
  log('checks', checks);
  if (checks.every((c) => c.ok)) log('PASS-chip-counts-union-true', { assigned, unassigned, revealed });
  else { log('FAIL', { checks }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
