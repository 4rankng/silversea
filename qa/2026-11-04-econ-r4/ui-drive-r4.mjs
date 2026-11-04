// r4 UI drive — DriverCostBreakdownSection on the real driver app
// (frontend :7179 → backend :3103, the fix/econ-r4-vetc-salary build).
// 390×844 (driver phone):
//   staging leg A  (1330): VETC row carries the owner warning next to 0 ₫
//   configured leg A (1336): VETC 110.000 ₫, lương per wage law, NO warning
//   configured leg B (1337): phụ phí 200.000 ₫, honest 0 ₫ VETC
// Evidence: qa/2026-11-04-econ-r4/ui-390-*.png + ui-driver-r4.log
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FE = 'http://localhost:7179';
const API = 'http://localhost:3103/api';
const OUT = path.resolve('qa/2026-11-04-econ-r4');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver-r4.log');
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

const STAGING_A = process.argv[2] ?? '1330';
const CONFIG_A = process.argv[3] ?? '1336';
const CONFIG_B = process.argv[4] ?? '1337';
const WARNING = 'Route chưa cấu hình trạm thu VETC — cần nhập để tính';

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 390, height: 844 } });
try {
  const token = await login('laixe');
  log(`login laixe ok (token len ${token.length})`);
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('t', t), token);
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  const readSection = () => page.evaluate(() => {
    const head = [...document.querySelectorAll('.driver-task-section__toggle')].map((b) => b.textContent ?? '');
    const summary = [...document.querySelectorAll('.driver-task-section__summary')].map((s) => s.textContent ?? '').find((t) => /₫/.test(t)) ?? null;
    const counter = document.querySelector('[data-testid="progress-costs"]')?.textContent ?? null;
    const grid = document.querySelector('#driver-task-cost-grid');
    const rows = grid ? [...grid.querySelectorAll('.driver-task-fact')].map((r) => {
      const label = r.querySelector('.driver-task-fact__label')?.textContent ?? '';
      const value = r.querySelector('.driver-task-fact__value')?.textContent ?? '';
      return `${label}=${value}`;
    }) : [];
    return { head: head.find((t) => t.includes('Chi phí chuyến')) ?? null, summary, counter, rows };
  });

  // ── Staging-shape leg A: the unconfigured-route warning ─────────────────
  await page.goto(`${FE}/my-trips/${STAGING_A}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1400);
  const stg = await readSection();
  log('staging leg A head:', stg.head ?? 'NOT FOUND', '| progress counter:', stg.counter ?? 'n/a');
  for (const row of stg.rows) log(`  staging leg A row ${row}`);
  check('staging leg A: Chi phí chuyến section visible', Boolean(stg.head), `trip ${STAGING_A}`);
  check('staging leg A: VETC row shows 0 ₫ + owner warning', stg.rows.some((r) => r.startsWith('Phí cầu đường VETC=') && r.includes(WARNING)), stg.rows.find((r) => r.includes('VETC')) ?? '');
  check('staging leg A: Lương chuyến shows explicit 0 ₫ (never hidden)', stg.rows.some((r) => r.startsWith('Lương chuyến=') && r.trim().endsWith('0 ₫')), '');
  check('staging leg A: warning text is on the page', (await page.evaluate((w) => document.body.innerText.includes(w), WARNING)), '');
  await page.screenshot({ path: path.join(OUT, 'ui-390-staging-legA-warning.png'), fullPage: true });
  log('screenshot ui-390-staging-legA-warning.png saved');

  // ── Configured leg A: real amounts, no warning ──────────────────────────
  await page.goto(`${FE}/my-trips/${CONFIG_A}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1400);
  const cfgA = await readSection();
  log('configured leg A head:', cfgA.head ?? 'NOT FOUND', '| progress counter:', cfgA.counter ?? 'n/a');
  for (const row of cfgA.rows) log(`  configured leg A row ${row}`);
  check('configured leg A: Chi phí chuyến section visible', Boolean(cfgA.head), `trip ${CONFIG_A}`);
  check('configured leg A: VETC row shows 110.000 ₫ without warning', cfgA.rows.some((r) => r.startsWith('Phí cầu đường VETC=') && r.includes('110.000') && !r.includes('cần nhập')), cfgA.rows.find((r) => r.includes('VETC')) ?? '');
  check('configured leg A: Lương chuyến shows 384.615 ₫ (wage law 2 days)', cfgA.rows.some((r) => r.startsWith('Lương chuyến=') && r.includes('384.615')), '');
  // The head summary renders only when collapsed — collapse, read, reopen.
  await page.click('[data-testid="task-section-toggle-driver-task-cost-grid"]');
  await sleep(300);
  const summaryNode = await page.evaluate(() => document.querySelector('[data-testid="task-section-summary-driver-task-cost-grid"]')?.textContent ?? null);
  check('configured leg A: header total (summary) non-zero', summaryNode != null && summaryNode !== '0 ₫', `summary=${summaryNode ?? 'null'}`);
  await page.click('[data-testid="task-section-toggle-driver-task-cost-grid"]');
  await sleep(300);
  check('configured leg A: no warning text on the page', !(await page.evaluate((w) => document.body.innerText.includes(w), WARNING)), '');
  await page.screenshot({ path: path.join(OUT, 'ui-390-configured-legA.png'), fullPage: true });
  log('screenshot ui-390-configured-legA.png saved');

  // ── Configured leg B: phụ phí leg ────────────────────────────────────────
  await page.goto(`${FE}/my-trips/${CONFIG_B}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1400);
  const cfgB = await readSection();
  for (const row of cfgB.rows) log(`  configured leg B row ${row}`);
  check('configured leg B: Phụ phí Kẹp shows 200.000 ₫', cfgB.rows.some((r) => r.startsWith('Phụ phí Kẹp=') && r.includes('200.000')), '');
  check('configured leg B: VETC honest 0 ₫ without warning', cfgB.rows.some((r) => r.startsWith('Phí cầu đường VETC=') && r.trim().endsWith('0 ₫')), '');
  check('configured leg B: Lương chuyến shows 200.000 ₫ (pair wage law)', cfgB.rows.some((r) => r.startsWith('Lương chuyến=') && r.includes('200.000')), '');
  await page.screenshot({ path: path.join(OUT, 'ui-390-configured-legB.png'), fullPage: true });
  log('screenshot ui-390-configured-legB.png saved');

  check('no console errors during drive', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  log(`UI DRIVE FAILURES: ${failures}`);
  process.exit(failures ? 1 : 0);
} finally {
  await browser.close();
}
