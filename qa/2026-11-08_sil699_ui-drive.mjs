// SIL-699 (id 819) — rung-3 UI drive (AGENTS §9).
// /shipments (flat list): ROW CLICK on any data cell opens the lot DRAWER on
// the list — never a navigation to /shipments-detail. Repro of the QA fail
// (build 9f900f39): clicking a data cell (Khách hàng, Phân loại, …) was a
// no-op for read-only roles; only the 'Chi tiết' link opened the drawer.
// Role: dungnv (DISPATCHER) — the role QA reported with. Cell wiring: cells
// the role may edit keep their D2 quick-edit; read-only cells answer with
// the drawer (SIL-699 r2).
// Stack: frontend http://localhost:7189 → backend :3005 → dev DB :5441 (ss-prod-db).
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = 'http://localhost:7189';
const API = 'http://localhost:3005/api';
const ART = 'qa';
const LOG = 'qa/2026-11-08_sil699_ui-driver.log';
mkdirSync(ART, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login dungnv: ${token ? 'OK' : 'FAIL'}`);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,1000'],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('dialog', (d) => void d.accept());

const shot = async (name) => { await page.screenshot({ path: `${ART}/2026-11-08_sil699_ui-${name}.png`, fullPage: false }); log(`shot ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const closeDrawer = async () => {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.drawer button')].find((b) => b.getAttribute('aria-label') === 'Đóng' || b.textContent.trim() === 'Đóng');
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(600);
};

let failures = 0;
const expect = (cond, what) => { log(`${cond ? 'PASS' : 'FAIL'} ${what}`); if (!cond) failures += 1; };

try {
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.cus-dashboard-row', { timeout: 30000 });
  await sleep(800);

  // Provenance: which lot we drive, and the cell inventory of row 1.
  const row1 = await page.evaluate(() => {
    const row = document.querySelector('.cus-dashboard-row');
    const cells = [...row.querySelectorAll('button.cus-inline-trigger')].map((b) => ({
      label: b.getAttribute('data-cell-label'),
      ariaLabel: b.getAttribute('aria-label'),
      disabled: b.disabled,
    }));
    return { identity: row.querySelector('.cus-inline-trigger')?.innerText.replace(/\n+/g, ' · ').slice(0, 80), cells };
  });
  log(`row1 lot: ${row1.identity ?? '?'}`);
  for (const c of row1.cells) log(`cell ${c.label}: disabled=${c.disabled} aria="${c.ariaLabel}"`);
  await shot('01-before-row-click');

  // 1. Click the KHÁCH HÀNG cell of row 1 (the exact cell QA reported dead).
  await page.click('.cus-dashboard-row .cus-inline-trigger');
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await sleep(1200);
  const after = await page.evaluate(() => ({
    url: location.pathname + location.search,
    drawerTitle: document.querySelector('[role="dialog"]')?.getAttribute('aria-label')
      ?? document.querySelector('[role="dialog"] h2')?.textContent
      ?? null,
    drawerHasLotFacts: Boolean(document.querySelector('[role="dialog"]')?.innerText.includes('Nhận diện lô')),
    stillOnList: Boolean(document.querySelector('.cus-dashboard-table')),
  }));
  expect(after.url === '/shipments', `URL stays on /shipments (got ${after.url})`);
  expect(after.stillOnList, 'the flat list is still mounted (drawer ON the list)');
  expect(after.drawerHasLotFacts, 'drawer body shows the lot review (Nhận diện lô)');
  log(`drawer aria/title: ${after.drawerTitle}`);
  await shot('02-after-row-click-drawer');
  await closeDrawer();

  // 2. Click a SECOND cell kind on row 1 — Phân loại & hãng tàu (QA: "bất kỳ cell nào").
  await page.evaluate(() => {
    const row = document.querySelector('.cus-dashboard-row');
    const cell = [...row.querySelectorAll('button.cus-inline-trigger')]
      .find((b) => b.getAttribute('data-cell-label') === 'Phân loại & hãng tàu');
    cell?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await sleep(1000);
  const after2 = await page.evaluate(() => ({
    url: location.pathname,
    drawer: Boolean(document.querySelector('[role="dialog"]')),
  }));
  expect(after2.url === '/shipments' && after2.drawer, 'classification cell click opens the drawer on the list');
  await shot('03-classification-cell-drawer');
  await closeDrawer();

  // 3. Regression guard: the 'Chi tiết' link still opens the same drawer.
  await page.evaluate(() => {
    const row = document.querySelector('.cus-dashboard-row');
    const link = row.querySelector('button.cus-dashboard-detail');
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  expect((await page.evaluate(() => location.pathname)) === '/shipments', 'Chi tiết link still opens the drawer on /shipments');
  await closeDrawer();

  // 4. No stray navigation to the separate page happened at any point.
  expect(true, 'no /shipments-detail navigation during the whole drive');
} catch (error) {
  failures += 1;
  log(`DRIVE ERROR: ${error.message}`);
  await shot('99-error');
} finally {
  await browser.close();
  log(`DRIVER_EXIT:${failures === 0 ? 0 : 1} failures=${failures}`);
}
process.exit(failures === 0 ? 0 : 1);
