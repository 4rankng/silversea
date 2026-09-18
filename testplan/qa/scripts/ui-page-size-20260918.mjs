// TC-PAGESIZE driver (local dev, 2026-09-18): the CUS workboards must offer a
// rows-per-page choice up to 200, drive the fetch, and keep the choice in the
// URL. Read-only: it only changes the page size, never lot data.
//
// Usage: node testplan/qa/scripts/ui-page-size-20260918.mjs
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = process.env.BASE_URL || 'http://localhost:7174';
const API = process.env.API_URL || 'http://localhost:3001/api';
const DIR = process.env.OUT_DIR || 'qa/2026-09-18-page-size';
mkdirSync(DIR, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOGFILE = `${DIR}/ui-driver.log`;
const lines = [];
const log = (s, extra) => {
  const line = extra === undefined ? s : `${s} ${JSON.stringify(extra)}`;
  console.log(line);
  lines.push(line);
  writeFileSync(LOGFILE, lines.join('\n') + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login thanhdc @ ${BASE}`);

const seen = [];
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let failed = null;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/shipments/cus-workspace')) seen.push(url.replace(/^.*\/api/, ''));
  });

  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 40000 });
  await page.waitForSelector('table.cus-dashboard-table tbody tr', { timeout: 25000 });
  await sleep(600);
  const before = await page.evaluate(() => ({
    rows: document.querySelectorAll('table.cus-dashboard-table tbody tr').length,
    summary: document.querySelector('.ds-pagination__summary')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    selector: document.querySelector('.ds-pagination__size select')?.value ?? null,
    href: location.pathname + location.search,
  }));
  log('TC-PAGESIZE-01 before', before);
  await page.screenshot({ path: `${DIR}/${STAMP}_01-default-20.png` });

  // Choose 200 through the real control.
  await page.select('.ds-pagination__size select', '200');
  await page.waitForFunction(
    () => /1–\d+ trên \d+/.test(document.querySelector('.ds-pagination__summary')?.textContent?.replace(/\s+/g, ' ') ?? '')
      && document.querySelector('.ds-pagination__size select')?.value === '200',
    { timeout: 20000 },
  );
  await sleep(900);
  const after = await page.evaluate(() => ({
    rows: document.querySelectorAll('table.cus-dashboard-table tbody tr').length,
    summary: document.querySelector('.ds-pagination__summary')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    selector: document.querySelector('.ds-pagination__size select')?.value ?? null,
    pageButtons: document.querySelectorAll('.ds-pagination__page').length,
    href: location.pathname + location.search,
  }));
  log('TC-PAGESIZE-01 after choosing 200', after);
  log('TC-PAGESIZE-01 api calls', seen.slice(-3));
  await page.screenshot({ path: `${DIR}/${STAMP}_02-rows-200.png` });

  if (after.selector !== '200') failed = `selector reads ${after.selector}`;
  else if (!after.href.includes('limit=200')) failed = `URL not updated: ${after.href}`;
  else if (!seen.some((url) => url.includes('limit=200'))) failed = `no API call carried limit=200: ${JSON.stringify(seen.slice(-3))}`;
  else if (after.rows <= before.rows) failed = `row count did not grow: ${before.rows} -> ${after.rows}`;
  else if (!/^Hiển thị 1–\d+ trên \d+$/.test(after.summary ?? '')) failed = `summary reads "${after.summary}"`;

  // TC-PAGESIZE-02: an unsupported size in the URL falls back to 20.
  await page.goto(`${BASE}/shipments?limit=37`, { waitUntil: 'networkidle2', timeout: 40000 });
  await page.waitForSelector('table.cus-dashboard-table tbody tr', { timeout: 25000 });
  await sleep(700);
  const fallback = await page.evaluate(() => ({
    selector: document.querySelector('.ds-pagination__size select')?.value ?? null,
    rows: document.querySelectorAll('table.cus-dashboard-table tbody tr').length,
  }));
  log('TC-PAGESIZE-02 unsupported size', fallback);
  if (fallback.selector !== '20' || fallback.rows > 20) {
    failed = `unsupported size did not fall back to 20: ${JSON.stringify(fallback)}`;
  }

  // TC-PAGESIZE-04: the container workboard offers the same choice.
  await page.goto(`${BASE}/shipments-detail?dateScope=all`, { waitUntil: 'networkidle2', timeout: 40000 });
  await page.waitForSelector('.shipment-container-ledger tbody tr', { timeout: 25000 });
  const detailSelector = await page.evaluate(() => {
    const select = document.querySelector('.shipment-container-ledger .ds-pagination__size select');
    return select ? { value: select.value, options: Array.from(select.options).map((option) => option.value) } : null;
  });
  log('TC-PAGESIZE-04 container workboard selector', detailSelector);
  if (!detailSelector) failed = 'container workboard has no rows-per-page selector';
  else {
    await page.select('.shipment-container-ledger .ds-pagination__size select', '200');
    await page.waitForFunction(
      () => document.querySelector('.shipment-container-ledger .ds-pagination__size select')?.value === '200',
      { timeout: 20000 },
    );
    await sleep(900);
    const detailAfter = await page.evaluate(() => ({
      rows: document.querySelectorAll('.shipment-container-ledger tbody tr').length,
      href: location.pathname + location.search,
    }));
    log('TC-PAGESIZE-04 after choosing 200', detailAfter);
    await page.screenshot({ path: `${DIR}/${STAMP}_03-container-rows-200.png` });
    if (!detailAfter.href.includes('limit=200')) failed = `container workboard URL not updated: ${detailAfter.href}`;
  }
} finally {
  await browser.close();
}

if (failed) {
  log(`FAIL ${failed}`);
  process.exitCode = 1;
} else {
  log('PASS — rows-per-page is choosable up to 200 on both workboards and lives in the URL');
}
log(`artifact driver log: ${LOGFILE}`);
