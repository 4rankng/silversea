// Card 20261006_391 — LOCAL UI rung (AC3): the /fleet/productivity monthly
// "Xuất Excel" button downloads the fleet-productivity xlsx and now reports
// success via toast (the failure path already renders the API reason verbatim
// and stays pinned by the existing tests). Read-only rung: export mutates
// nothing — the trips-table identity is captured unchanged around the driver
// by the invoking shell.
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const LOG = [];
const log = (step, obj) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { status: health.status, buildHash: health.buildHash, note: 'dev = live source, not a deployed cut' });

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login admin failed: ${login.status}`);
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
log('login', { user: 'admin', role: 'ADMIN (local demo, officeStaffOnly route)', gotToken: Boolean(token) });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  await page.setRequestInterception(true);
  const exportResponses = [];
  page.on('request', (req) => { void req.continue(); });
  page.on('response', async (res) => {
    if (res.url().includes('/fleet/productivity/monthly')) {
      exportResponses.push({ url: res.url().replace(BASE, ''), status: res.status() });
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/fleet/productivity`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // The page defaults to the DAILY tab; the monthly view (the card's surface)
  // mounts only after switching to "Từng xe trong 1 tháng".
  await page.waitForSelector('.fleet-productivity-tab-btn', { timeout: 30000 });
  const tabs = await page.$$('.fleet-productivity-tab-btn');
  let monthlyTab = null;
  for (const t of tabs) {
    const label = await t.evaluate((el) => (el.textContent || '').trim());
    if (label.includes('Từng xe trong 1 tháng')) { monthlyTab = t; break; }
  }
  if (!monthlyTab) throw new Error('monthly tab not found');
  await monthlyTab.click();
  log('monthly-tab-clicked');

  // Data must be on screen before the export button enables.
  await page.waitForFunction(
    () => [...document.querySelectorAll('.fleet-kpi-card__label')].some((el) => el.textContent?.includes('Tổng chuyến trong tháng')),
    { timeout: 30000 },
  );
  const buttons = await page.$$('button');
  let exportBtn = null;
  for (const b of buttons) {
    const t = await b.evaluate((el) => (el.textContent || '').trim());
    if (t.includes('Xuất Excel')) { exportBtn = b; break; }
  }
  if (!exportBtn) throw new Error('productivity export button not found');
  const before = await exportBtn.evaluate((el) => ({ text: (el.textContent || '').trim(), disabled: el.disabled }));
  log('button-before', before);
  if (before.disabled) throw new Error('export button is disabled — no monthly data');

  await exportBtn.click();
  await page.waitForFunction(
    () => (document.querySelector('.toast--success')?.textContent || '').includes('Đã xuất báo cáo năng suất xe ra tệp Excel.'),
    { timeout: 15000 },
  );
  const toastText = await page.evaluate(() => (document.querySelector('.toast--success')?.textContent || '').trim());
  log('toast-assert', { toastText, matchesExpected: toastText.includes('Đã xuất báo cáo năng suất xe ra tệp Excel.') });
  await page.screenshot({ path: `${QA}/2026-10-06_card20261006391_ui-productivity-toast.png` });
  log('screenshot', { path: 'qa/2026-10-06_card20261006391_ui-productivity-toast.png' });

  log('api-identity', {
    exportResponses,
    note: 'read-only export — no persisted mutation expected; trips table captured unchanged by the invoking shell',
  });
} finally {
  await browser.close();
}

mkdirSync(QA, { recursive: true });
writeFileSync(`${QA}/2026-10-06_card20261006391_ui-productivity-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
console.log('DRIVER OK');
