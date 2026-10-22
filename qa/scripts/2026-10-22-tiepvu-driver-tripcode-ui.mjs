// Card 261022201006c — driver app drops the trip code (REQ-07 cũ) — rung-3 UI
// drive on the LOCAL worktree stack (frontend 7179 / backend 3006, DB 5441).
// BEFORE-state evidence: qa/2026-10-21-req07-tripcode/ (REQ-07 drive showed
// "Mã chuyến …" on list + detail). This drive proves the AFTER state:
//   T01 list  (/my-trips)          — no trip-code row at all (raw or formatted)
//   T02 detail (/my-trips/:id)     — no "Mã chuyến" fact; grid leads with schedule
//   T03 penalties (/my-penalties)  — violation meta never names a trip code
//   DB/API contract — journey-board + trips.trip_code still carry the field.
//
//   node qa/scripts/2026-10-22-tiepvu-driver-tripcode-ui.mjs
// Env: FRONT_PORT (7179), API_PORT (3006), DRIVER (quyet).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7179}`;
const API = `http://localhost:${process.env.API_PORT ?? 3006}/api`;
const DRIVER = process.env.DRIVER ?? 'quyet';
const OUT = path.resolve('qa/2026-10-22-tiepvu-b-c');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '2026-10-22_tiepvu-c_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `2026-10-22_tiepvu-c_ui-${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ── Health + login (house recipe: API login, token pre-injected) ────────────
const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: DRIVER, password: 'Abc123' }),
});
if (!loginRes.ok) { log(`ABORT: login failed for ${DRIVER} (${loginRes.status})`); process.exit(2); }
const { token } = await loginRes.json();
log(`LOGIN ok driver=${DRIVER}`);

// ── DB/API contract capture (read-only): the field stays on the wire ───────
const board = await fetch(`${API}/driver/me/journey-board`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json()).catch(() => null);
const card = (board?.items ?? []).find((c) => c.tripCode && (c.tripId ?? c.id));
const tripId = card ? Number(card.tripId ?? card.id) : Number(process.env.TRIP_ID ?? 85065);
const boardHasCode = Boolean(card?.tripCode);
check('CONTRACT journey-board still carries tripCode', boardHasCode, card ? `tripId=${tripId} tripCode=${card.tripCode}` : 'no coded card — falling back to TRIP_ID');
const dbRow = execSync(`docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "select id || ' | ' || coalesce(trip_code,'NULL') || ' | ' || status from trips where id=${tripId}"`).toString().trim();
fs.writeFileSync(path.join(OUT, '2026-10-22_tiepvu-c_db-trips-row.txt'),
  `trips row (field preserved in DB, UI-only change):\n${dbRow}\n`);
check('CONTRACT trips.trip_code preserved in DB', dbRow.includes('|') && !dbRow.includes('NULL |'), dbRow);
log(`TRIP under drive: id=${tripId}`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, token);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

// ── T01: journey list — no trip-code row at all ────────────────────────────
await page.goto(`${FRONT}/my-trips`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.driver-journey-card', { timeout: 20000 });
await sleep(600);
const listHasCards = await page.$$eval('.driver-journey-card', (els) => els.length);
if (!listHasCards) { log('ABORT: no journey cards on the board'); await browser.close(); process.exit(2); }
// Real control interaction: the board tab (Tất cả) re-renders the list before the capture.
const allTab = await page.$('button[role="tab"], [role="tab"]');
if (allTab) { await allTab.click(); await sleep(500); }
await shot(page, 'list-390');
const listState = await page.evaluate(() => ({
  codeTestIds: document.querySelectorAll('[data-testid="trip-code"]').length,
  bodyText: document.body.textContent ?? '',
}));
check('T01 no trip-code testid on list', listState.codeTestIds === 0, `count=${listState.codeTestIds}`);
check('T01 no "Mã chuyến" label on list', !listState.bodyText.includes('Mã chuyến'));
check('T01 no raw/formatted code text on list', !/TRP[\s-]20\d{2}/.test(listState.bodyText));
const billLeads = await page.$$eval('.driver-journey-card__bill', (els) => els.map((el) => el.textContent?.trim()));
check('T01 bill/booking still the lead identity', billLeads.length > 0 && billLeads.every(Boolean), JSON.stringify(billLeads.slice(0, 3)));

// ── T02: trip detail — no "Mã chuyến" fact; schedule leads the grid ────────
await page.goto(`${FRONT}/my-trips/${tripId}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.driver-task-fact', { timeout: 20000 });
// Real control interaction: ensure "Thông tin lệnh" is expanded before capture
// (it defaults open — click only if a stale session left it collapsed).
const infoHead = await page.$('[data-testid="task-section-toggle-driver-task-info-grid"]');
if (infoHead) {
  const expanded = await infoHead.evaluate((el) => el.getAttribute('aria-expanded'));
  if (expanded !== 'true') { await infoHead.click(); await sleep(400); }
}
await sleep(600);
await shot(page, 'detail-390');
const detailState = await page.evaluate(() => ({
  order: Array.from(document.querySelectorAll('.driver-task-fact__label')).map((el) => el.textContent?.trim()),
  bodyText: document.body.textContent ?? '',
}));
check('T02 no "Mã chuyến" fact on detail', !detailState.order.includes('Mã chuyến'), JSON.stringify(detailState.order.slice(0, 4)));
check('T02 schedule fact leads the grid', detailState.order[0] === 'Ngày giờ kế hoạch', String(detailState.order[0]));
check('T02 no raw/formatted code text on detail', !/TRP[\s-]20\d{2}/.test(detailState.bodyText));
fs.writeFileSync(path.join(OUT, '2026-10-22_tiepvu-c_dom-detail-facts.txt'), `${JSON.stringify(detailState.order, null, 2)}\n`);

// ── T03: penalties — violation meta never names a trip code ───────────────
await page.goto(`${FRONT}/my-penalties`, { waitUntil: 'networkidle2' });
await sleep(800);
await shot(page, 'penalties-390');
const penaltyText = await page.evaluate(() => document.body.textContent ?? '');
check('T03 penalty page renders', /Vi phạm|Chưa có/i.test(penaltyText));
check('T03 no trip-code text on penalties', !/TRP[\s-]20\d{2}/.test(penaltyText) && !penaltyText.includes('Mã chuyến'));

check('console errors none', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');
await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
