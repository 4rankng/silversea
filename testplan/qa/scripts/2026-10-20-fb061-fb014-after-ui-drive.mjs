// Cards 201026112400/112500 — RUNG-3 AFTER drive on the LOCAL FIXED build
// (backend tsx :3002 + vite :7175, dev DB :5441). Read-only UI sweep of the
// dispatch-detail quick assignment tabs after the FB-014 fix:
//   "Chưa gán xe" lists only rows with no plate AND no live trip;
//   "Đã gán xe" lists the complement (incl. pending-plate external dispatches).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const OUT = process.env.OUT_DIR || path.resolve(import.meta.dirname, '../../../qa/2026-10-20-fb061-fb014');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await (await fetch(`${API}/health`)).json();
log('build_gate', { buildHash: health.buildHash });

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }),
});
const { token, user } = await login.json();
log('login', { user: user?.username, role: user?.role });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForSelector('[role="tab"]', { timeout: 90000 });
await sleep(2500);

const clickTab = async (label) => {
  const ok = await page.evaluate((want) => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => (t.textContent || '').trim().startsWith(want));
    if (!tab) return false;
    tab.click();
    return true;
  }, label);
  await sleep(2500);
  return ok;
};

const readGrid = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('tbody tr')];
  // The dispatch cell is the one carrying carrier/plate/order state; count
  // rows whose dispatch cell shows NO carrier, NO plate and NO phát-lệnh chip
  // is impossible structurally, so we lift each row's dispatch-cell text.
  return rows.map((tr) => {
    const cells = [...tr.querySelectorAll('td')].map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim());
    return cells;
  });
});

// --- Chưa gán xe ---
if (await clickTab('Chưa gán xe')) {
  await page.screenshot({ path: path.join(OUT, '201026112500_after_ui-01-chua-gan-xe.png') });
  const rows = await readGrid();
  // A row still needing assignment shows "Chưa phân nhà xe" or an empty
  // dispatch cell; an assigned-looking row shows a carrier name or the
  // phát-lệnh chip ("Đã phát lệnh") or "Phân xe lại".
  const assignedLooking = rows.filter((cells) => cells.some((c) => /Đã phát lệnh|Phân xe lại|Đã hoàn thành/.test(c)));
  log('after_unassigned_tab', {
    rowCount: rows.length,
    assignedLookingCount: assignedLooking.length,
    assignedLookingFirst: assignedLooking.slice(0, 4).map((c) => c.slice(0, 8)),
  });
  fs.writeFileSync(path.join(OUT, '201026112500_after_dom-chua-gan-xe.txt'), JSON.stringify(rows, null, 1));
}

// --- Đã gán xe ---
if (await clickTab('Đã gán xe')) {
  await page.screenshot({ path: path.join(OUT, '201026112500_after_ui-02-da-gan-xe.png') });
  const rows = await readGrid();
  const assignedLooking = rows.filter((cells) => cells.some((c) => /Đã phát lệnh|Phân xe lại|Đã hoàn thành|SilverSea|BIỂN XANH|Gaya/.test(c)));
  log('after_assigned_tab', {
    rowCount: rows.length,
    assignedLookingCount: assignedLooking.length,
    sampleFirst: rows.slice(0, 4).map((c) => c.slice(0, 8)),
  });
  fs.writeFileSync(path.join(OUT, '201026112500_after_dom-da-gan-xe.txt'), JSON.stringify(rows, null, 1));
}

log('console_errors', { count: errors.length, errors: errors.slice(0, 3) });
await browser.close();
fs.writeFileSync(path.join(OUT, '201026112500_after_ui-driver.log'), JSON.stringify(LOG, null, 2));
console.log('AFTER_UI_DRIVE_DONE');
