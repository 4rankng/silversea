// Wave 7 UI drive — DriverCostBreakdownSection on the real driver app
// (frontend :7176 → backend :3102, the fix/sil-wave7-economics build).
// Drives at 390×844 (driver phone): completed leg A (VETC carrying leg),
// completed leg B (phụ phí leg), and a non-completed trip (section absent).
// Evidence: qa/2026-11-04-wave7-economics/ui-*.png + ui-driver.log
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FE = 'http://localhost:7176';
const API = 'http://localhost:3102/api';
const OUT = path.resolve('qa/2026-11-04-wave7-economics');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (l) => { console.log(l); fs.appendFileSync(LOG, l + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (res.status !== 200) throw new Error(`login ${identifier} -> ${res.status}`);
  const body = await res.json();
  return body.token ?? body.accessToken;
}

const COMPLETED_A = process.argv[2] ?? '1321';
const COMPLETED_B = process.argv[3] ?? '1322';

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 390, height: 844 } });
try {
  const token = await login('laixe');
  log(`login laixe ok (token len ${token.length})`);
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  // ── Completed leg A: the VETC-carrying leg ──────────────────────────────
  await page.goto(`${FE}/my-trips/${COMPLETED_A}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);
  const sectionA = await page.evaluate(() => {
    const head = [...document.querySelectorAll('[data-testid^="task-section-toggle-"], .driver-task-section__toggle')]
      .map((b) => b.textContent ?? '');
    const grid = document.querySelector('#driver-task-cost-grid');
    const rows = grid ? [...grid.querySelectorAll('.driver-task-fact')].map((r) => {
      const label = r.querySelector('.driver-task-fact__label')?.textContent ?? '';
      const value = r.querySelector('.driver-task-fact__value')?.textContent ?? '';
      return `${label}=${value}`;
    }) : [];
    return { head: head.find((t) => t.includes('Chi phí chuyến')) ?? null, rows };
  });
  log('leg A section head:', sectionA.head ?? 'NOT FOUND');
  for (const row of sectionA.rows) log(`  leg A row ${row}`);
  check('leg A: Chi phí chuyến section visible', Boolean(sectionA.head), `trip ${COMPLETED_A}`);
  check('leg A: VETC row shows 110.000 ₫', sectionA.rows.some((r) => r.startsWith('Phí cầu đường VETC=') && r.includes('110.000')), sectionA.rows.find((r) => r.includes('VETC')) ?? '');
  check('leg A: Lương chuyến shows 192.308 ₫', sectionA.rows.some((r) => r.startsWith('Lương chuyến=') && r.includes('192.308')), '');
  check('leg A: Phụ phí Kẹp shows 0 ₫ (leg 1 carries no surcharge)', sectionA.rows.some((r) => r.startsWith('Phụ phí Kẹp=') && r.trim().endsWith('0 ₫')), '');
  await page.screenshot({ path: path.join(OUT, `ui-390-legA-cost-breakdown.png`), fullPage: true });
  log(`screenshot ui-390-legA-cost-breakdown.png saved`);

  // ── Completed leg B: the phụ phí leg ────────────────────────────────────
  await page.goto(`${FE}/my-trips/${COMPLETED_B}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);
  const sectionB = await page.evaluate(() => {
    const grid = document.querySelector('#driver-task-cost-grid');
    const rows = grid ? [...grid.querySelectorAll('.driver-task-fact')].map((r) => {
      const label = r.querySelector('.driver-task-fact__label')?.textContent ?? '';
      const value = r.querySelector('.driver-task-fact__value')?.textContent ?? '';
      return `${label}=${value}`;
    }) : [];
    return rows;
  });
  for (const row of sectionB) log(`  leg B row ${row}`);
  check('leg B: VETC row shows honest 0 ₫', sectionB.some((r) => r.startsWith('Phí cầu đường VETC=') && r.trim().endsWith('0 ₫')), '');
  check('leg B: Phụ phí Kẹp shows 200.000 ₫', sectionB.some((r) => r.startsWith('Phụ phí Kẹp=') && r.includes('200.000')), '');
  check('leg B: Lương chuyến shows 200.000 ₫ (pair wage law)', sectionB.some((r) => r.startsWith('Lương chuyến=') && r.includes('200.000')), '');
  await page.screenshot({ path: path.join(OUT, `ui-390-legB-cost-breakdown.png`), fullPage: true });
  log(`screenshot ui-390-legB-cost-breakdown.png saved`);

  // ── Non-completed trip: section must be absent ──────────────────────────
  const incomplete = await fetch(`${API}/driver/me/trips`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const openTrip = (incomplete.trips ?? incomplete ?? []).find?.((t) => t.status && t.status !== 'COMPLETED' && t.status !== 'CANCELED');
  if (openTrip?.id) {
    await page.goto(`${FE}/my-trips/${openTrip.id}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(800);
    const absent = await page.evaluate(() => document.querySelector('#driver-task-cost-grid') === null);
    check(`non-completed trip ${openTrip.id} (${openTrip.status}): section absent`, absent, '');
  } else {
    log(`SKIP non-completed check — no open trip for laixe right now`);
  }

  check('no console errors during drive', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  log(`UI DRIVE FAILURES: ${failures}`);
  process.exit(failures ? 1 : 0);
} finally {
  await browser.close();
}
