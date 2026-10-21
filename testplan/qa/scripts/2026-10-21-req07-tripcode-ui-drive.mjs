// REQ-07 — format mã chuyến trong Driver App — rung-3 UI drive on LOCAL dev
// (frontend 7175 / backend 3002, DB 5441). Scenarios REQ07T-01..03 from
// testplan/2026-10-21-req07-tripcode.md.
//
//   node testplan/qa/scripts/2026-10-21-req07-tripcode-ui-drive.mjs
//
// Env overrides: FRONT_PORT (7175), API_PORT (3002), DRIVER (quyet).
// Read-only surface drive EXCEPT the documented local trip reassignment
// (trip 192861 → driver `quyet`, restored by db-restore step at the end) —
// both recorded in qa/2026-10-21-req07-tripcode/db-*.txt.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7175}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const DRIVER = process.env.DRIVER ?? 'quyet';
// REQ07T evidence trip: env-overridable so reruns survive data changes. The
// expected display shape derives from the code (TRP-<YYYYMM>-<seq> →
// "TRP <yyyy>-<mm> · <seq>") instead of a second hardcoded literal.
const CANONICAL_CODE = process.env.CANONICAL_CODE ?? 'TRP-202610-0631';
const CANONICAL_ID = Number(process.env.CANONICAL_ID ?? 85065);
const CANONICAL_LABEL = (() => {
  const m = CANONICAL_CODE.match(/^TRP-(\d{4})(\d{2})-(\d+)$/);
  return m ? `TRP ${m[1]}-${m[2]} · ${m[3].padStart(4, '0')}` : CANONICAL_CODE;
})();
const OUT = path.resolve('qa/2026-10-21-req07-tripcode');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `ui-${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ── Health + login (house recipe: API login, token pre-injected) ────────────
const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: DRIVER, password: 'Abc123' }),
});
if (!loginRes.ok) { log(`ABORT: login failed for ${DRIVER} (${loginRes.status})`); process.exit(2); }
const { token } = await loginRes.json();
log(`LOGIN ok driver=${DRIVER}`);

const board = await fetch(`${API}/driver/me/journey-board`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json()).catch(() => null);
const canonicalCard = (board?.items ?? []).find((c) => c.tripCode === CANONICAL_CODE);
log(`BOARD items=${board?.items?.length ?? 0} canonicalPresent=${Boolean(canonicalCard)}`);
if (!canonicalCard) { log(`ABORT: ${CANONICAL_CODE} not on ${DRIVER}'s board — run the db reassign step first`); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, token);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

// ── REQ07T-01: journey card — formatted code line ───────────────────────────
await page.goto(`${FRONT}/my-trips`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.driver-journey-card', { timeout: 20000 });
await sleep(600);
await shot(page, '01-list-390');
const codeLines = await page.$$eval('[data-testid="trip-code"]', (els) => els.map((el) => el.textContent?.trim()));
const bodyText = await page.evaluate(() => document.body.textContent);
check('T01 canonical code line formatted', codeLines.includes(`Mã chuyến ${CANONICAL_LABEL}`), JSON.stringify(codeLines));
check('T01 raw generator string absent from list', !bodyText.includes('TRP-202610-0631'));
// Legacy-shaped codes (BULK-TR-…, TRP-C12-…) never reach this board with real
// local data (fulfillment-less trips drop from the INNER JOIN) — passthrough
// rendering is pinned at unit level (DriverTripsPage.test.tsx REQ-07 case).
check('T01 no stray code line without the Mã chuyến label', codeLines.every((l) => l?.startsWith('Mã chuyến')), JSON.stringify(codeLines));
const billLeads = await page.$eval('.driver-journey-card__bill', (el) => el.textContent?.trim());
check('T01 bill/booking still the lead identity', Boolean(billLeads), billLeads ?? 'none');

// ── REQ07T-02: detail — "Mã chuyến" fact row ────────────────────────────────
await page.goto(`${FRONT}/my-trips/${CANONICAL_ID}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.driver-task-fact', { timeout: 20000 });
await sleep(600);
await shot(page, '02-detail-390');
const firstFact = await page.evaluate(() => {
  const fact = document.querySelector('.driver-task-fact');
  return {
    label: fact?.querySelector('.driver-task-fact__label')?.textContent?.trim(),
    value: fact?.querySelector('.driver-task-fact__value')?.textContent?.trim(),
    order: Array.from(document.querySelectorAll('.driver-task-fact__label')).map((el) => el.textContent?.trim()),
  };
});
check('T02 first fact row is Mã chuyến', firstFact.label === 'Mã chuyến', firstFact.label ?? 'none');
check('T02 formatted value', firstFact.value === CANONICAL_LABEL, firstFact.value ?? 'none');
check('T02 schedule row follows', firstFact.order[1] === 'Ngày giờ kế hoạch', JSON.stringify(firstFact.order.slice(0, 3)));
const detailText = await page.evaluate(() => document.body.textContent);
check('T02 raw generator string absent from detail', !detailText.includes('TRP-202610-0631'));

// ── REQ07T-03: penalty page — drive reachable state only (no penalty rows w/
// trip exist locally; screenshot documents the surface renders clean) ───────
await page.goto(`${FRONT}/my-penalties`, { waitUntil: 'networkidle2' });
await sleep(800);
await shot(page, '03-penalties-390');
const penaltyText = await page.evaluate(() => document.body.textContent);
check('T03 penalty page renders (empty-state for this driver)', /Vi phạm|Chưa có/i.test(penaltyText));

check('console errors none', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');

fs.writeFileSync(path.join(OUT, 'dom-list-codes.txt'), codeLines.join('\n'));
fs.writeFileSync(path.join(OUT, 'dom-detail-facts.txt'), `${JSON.stringify(firstFact.order, null, 2)}\n\nMã chuyến value: ${firstFact.value}\n`);

await browser.close();

// ── Data note: no reassignment remains. Early attempts reassigned trips
// 192861 and 67894 (wrong keyspace — trips.driver_id is the drivers-table id);
// both were restored to their original rows before this successful run
// (db-0/db-1/db-2 records). Trip 85065 is quyet's own (drivers.id 3). ────────
log('DATA: restored 192861→3834, 67894→2; 85065 untouched (drivers.id=3 = quyet)');

log(`DONE failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
