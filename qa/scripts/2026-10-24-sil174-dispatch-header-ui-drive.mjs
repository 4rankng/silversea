// SIL-174 — rung-3 UI drive (LOCAL ONLY): /dispatch-detail header của cột CHỌN
// khi bật [📦 Gộp hàng]. Trước fix: text-content ô header đọc "Chọn lô Chọn"
// ("CHỌN LÔ CHỌN" khi uppercase). Sau fix: "Chọn lô" — đồng bộ /dispatch.
// PHASE env: before | after (the shell stashes/restores the grid file between
// the two runs; the script only captures + asserts its phase).
// Run: PHASE=before node qa/scripts/2026-10-24-sil174-dispatch-header-ui-drive.mjs
// Env: FRONT_PORT (7185), API_PORT (3012).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const PHASE = process.env.PHASE ?? 'after';
const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7185}`;
const API = `http://localhost:${process.env.API_PORT ?? 3012}/api`;
const OUT = path.resolve('qa/2026-10-24_sil174_chon-lo');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `ui-driver-${PHASE}.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT} phase=${PHASE}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

// ĐV (dispatcher) owns /dispatch-detail. dev-seed identifiers per
// testplan/testaccounts.txt (dungnv NV015 — dieuvan is the stgdb name).
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
if (!loginRes.ok) { log(`ABORT: login failed (${loginRes.status})`); process.exit(2); }
const { token } = await loginRes.json();
log('LOGIN ok role=dungnv (DISPATCHER)');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, token);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(`${FRONT}/dispatch-detail`, { waitUntil: 'networkidle2' });

// Bật chế độ gộp hàng → cột CHỌN xuất hiện (spec 23/10 §2: on-demand).
const mergeBtn = await page.waitForSelector('button[title*="gộp hàng"], button[title*="Gộp hàng"]', { timeout: 30000 }).catch(() => null);
if (!mergeBtn) {
  const bodyText = await page.evaluate(() => document.body.textContent?.slice(0, 400));
  log(`ABORT: không thấy nút Gộp hàng — body=${bodyText?.replace(/\s+/g, ' ')}`);
  await browser.close(); process.exit(2);
}
await mergeBtn.click();
const th = await page.waitForSelector('.detailed-plan-grid__th--select', { timeout: 15000 });
await sleep(500);

// DOM assertion: header text-content (đúng cái QA đọc — sr-only kèm theo).
const headerFacts = await page.evaluate((el) => ({
  textContent: (el.textContent ?? '').trim(),
  visibleText: [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent?.trim()).filter(Boolean).join(''),
  computedTransform: getComputedStyle(el).textTransform,
}), th);
log(`HEADER textContent="${headerFacts.textContent}" visible="${headerFacts.visibleText}" text-transform=${headerFacts.computedTransform}`);

if (PHASE === 'before') {
  check('BEFORE header đọc "Chọn lôChọn" → hiển thị "CHỌN LÔ CHỌN" (bug tái hiện trên DOM thật)',
    headerFacts.textContent.replace(/\s+/g, ' ').trim() === 'Chọn lôChọn',
    JSON.stringify(headerFacts));
  // Clip về vùng header bảng cho screenshot dễ đọc.
  await page.$eval('.detailed-plan-grid', (el) => el.scrollIntoView({ block: 'start' }));
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'ui-before-chon-lo-chon.png'), fullPage: false });
} else {
  check('AFTER header đọc đúng "Chọn lô" — đồng bộ /dispatch',
    headerFacts.textContent.replace(/\s+/g, ' ').trim() === 'Chọn lô',
    JSON.stringify(headerFacts));
  check('AFTER visible text vẫn là "Chọn" (sr-only không hiện trên màn)',
    headerFacts.visibleText === 'Chọn', `visible="${headerFacts.visibleText}"`);
  await page.$eval('.detailed-plan-grid', (el) => el.scrollIntoView({ block: 'start' }));
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'ui-after-chon-lo.png'), fullPage: false });
  // Parity: /dispatch header cùng đọc "Chọn lô".
  await page.goto(`${FRONT}/dispatch`, { waitUntil: 'networkidle2' });
  const masterBtn = await page.waitForSelector('button[title*="gộp hàng"], button[title*="Gộp hàng"]', { timeout: 30000 }).catch(() => null);
  if (masterBtn) {
    await masterBtn.click();
    const masterTh = await page.waitForSelector('.master-plan-grid__select-head', { timeout: 15000 });
    const masterText = await page.evaluate((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim(), masterTh);
    check('PARITY /dispatch header cũng đọc "Chọn lô"', masterText === 'Chọn lô', `"${masterText}"`);
    await page.$eval('.master-plan-grid', (el) => el.scrollIntoView({ block: 'start' }));
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, 'ui-parity-dispatch-chon-lo.png'), fullPage: false });
  } else {
    check('PARITY /dispatch mở được nút Gộp hàng', false, 'nút không tìm thấy');
  }
}

check('Console không có lỗi mới', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');

await browser.close();
log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} — artifacts in ${OUT}`);
process.exit(failures === 0 ? 0 : 1);
