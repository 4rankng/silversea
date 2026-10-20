// Ticket 201026090200 (card 191026202000) — UI rung-3 drive of the chốt-debit
// board's short names. Read-only: no DB writes from this script. Asserts the
// two NameCell cells (Thông tin lô hàng customer, Phân xe carrier labels) show
// the operational short name from the wire with the full name in the tooltip.
import puppeteer from 'puppeteer';
import http from 'node:http';

const BASE = process.env.BASE || 'http://localhost:7175';
const API = process.env.API || 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea/qa';

const post = (path, body) => new Promise((resolve, reject) => {
  const r = http.request(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
    let b = '';
    res.on('data', (c) => (b += c));
    res.on('end', () => { let j = b; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: j }); });
  });
  r.on('error', reject);
  r.write(JSON.stringify(body));
  r.end();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const login = await post('/auth/login', { identifier: 'admin', password: 'Abc123' });
  if (login.status !== 200) throw new Error(`login -> ${login.status}`);
  const token = login.body.token;

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`); });

  // Inject the token AND the column-visibility choice (empty hidden list =
  // explicit show-all, so Phân xe renders without driving the picker) BEFORE
  // the SPA loads.
  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem('token', t);
    localStorage.setItem('accounting-debit-hidden-cols', '[]');
  }, token);

  await page.goto(`${BASE}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 90000 });
  // Board fetch is a big query; wait for either the table or an empty state.
  await page.waitForSelector('.debit-board, [class*="empty"]', { timeout: 90000 });
  await sleep(1500);

  const customerCell = await page.evaluate(() => {
    const cell = [...document.querySelectorAll('.debit-col--lot .name-cell')]
      .find((el) => el.textContent.trim() === 'LONG MINH');
    if (!cell) return null;
    cell.scrollIntoView({ block: 'center' });
    return { text: cell.textContent, title: cell.getAttribute('title'), aria: cell.getAttribute('aria-label') };
  });
  if (!customerCell) throw new Error('customer short-name cell not found');
  await sleep(800);
  await page.screenshot({ path: `${QA}/2026-10-20_201026090200_ui-01-customer-shortname.png` });

  const carrierCell = await page.evaluate(() => {
    const cell = [...document.querySelectorAll('.debit-col--truck .name-cell')]
      .find((el) => el.textContent.trim() === 'B77');
    if (!cell) return null;
    cell.scrollIntoView({ block: 'center' });
    return { text: cell.textContent, title: cell.getAttribute('title'), aria: cell.getAttribute('aria-label') };
  });
  if (!carrierCell) throw new Error('carrier short-name cell (B77) not found');
  await sleep(800);
  await page.screenshot({ path: `${QA}/2026-10-20_201026090200_ui-02-phanxe-shortname.png` });

  await browser.close();

  const checks = [
    { name: 'customer cell shows short name', ok: customerCell.text === 'LONG MINH' },
    { name: 'customer tooltip keeps full name', ok: customerCell.title === 'LONG MINH' },
    { name: 'carrier label shows short name', ok: carrierCell.text === 'B77' },
    { name: 'carrier tooltip keeps full name', ok: carrierCell.title === 'B77' },
  ];
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} — ${c.name}`);
  console.log(`console/page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  if (failed.length > 0 || errors.length > 0) process.exit(1);
  console.log('RUNG3_DRIVE_PASS');
}

main().catch((e) => { console.error('DRIVER_ERROR', e.message); process.exit(1); });
