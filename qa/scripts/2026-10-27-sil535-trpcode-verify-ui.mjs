// SIL-535 (board id 598) — "Phần lái xe: bỏ hiển thị Mã chuyến (TRP-XXX) trên
// thẻ lệnh" — rung-3 verification drive on the LOCAL stack (frontend 7175 /
// backend 3002, DB ss-prod-db:5441). The removal itself landed 22/10 in
// 6a633ed6 (cards 261022201006b/c); prod still shows the code because prod
// never received that build. This drive re-proves the AFTER state on the
// current trunk (e9376fc8) with a driver holding all three buckets:
//   T01 list  (/my-trips, tabs Lệnh mới + Đã nhận) — no trip-code row at all
//             (raw TRP-… or formatted "TRP 2026-10 · NNNN"), bill/booking leads
//   T02 detail (/my-trips/:id)     — no "Mã chuyến" fact; grid leads schedule
//   T03 penalties (/my-penalties)  — violation meta never names a trip code
//   DB/API contract — journey-board + trips.trip_code still carry the field
//                     (UI-only change; driver never sees it).
//
//   node qa/scripts/2026-10-27-sil535-trpcode-verify-ui.mjs
// Env: FRONT_PORT (7175), API_PORT (3002), DRIVER (bqhuong — trips 49/48/47).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7175}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const DRIVER = process.env.DRIVER ?? 'bqhuong';
const OUT = path.resolve('qa/2026-10-27_sil535-trpcode-verify');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '2026-10-27_sil535_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `2026-10-27_sil535_ui-${name}.png`), fullPage: false });

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
const coded = (board?.items ?? []).filter((c) => c.tripCode && c.tripId);
const tripId = Number(process.env.TRIP_ID ?? coded[0]?.tripId ?? 0);
check('CONTRACT journey-board still carries tripCode', coded.length > 0,
  coded.map((c) => `tripId=${c.tripId} bucket=${c.bucket} tripCode=${c.tripCode}`).join(' ; '));
fs.writeFileSync(path.join(OUT, '2026-10-27_sil535_api-journey-board.json'),
  JSON.stringify({ items: board?.items ?? [], knownTagLabels: board?.knownTagLabels ?? [] }, null, 2) + '\n');
const dbRows = coded.map((c) =>
  execSync(`docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "select id || ' | ' || coalesce(trip_code,'NULL') || ' | ' || status from trips where id=${Number(c.tripId)}"`).toString().trim());
fs.writeFileSync(path.join(OUT, '2026-10-27_sil535_db-trips-rows.txt'),
  `trips rows (field preserved in DB, UI-only change):\n${dbRows.join('\n')}\n`);
check('CONTRACT trips.trip_code preserved in DB', dbRows.length > 0 && dbRows.every((r) => /TRP-/.test(r)), dbRows.join(' ; '));
log(`TRIP under drive: id=${tripId} driver=${DRIVER}`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, token);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

// ── T01: journey list — Lệnh mới tab — no trip-code row at all ──────────────
await page.goto(`${FRONT}/my-trips`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.driver-journey-card', { timeout: 20000 });
await sleep(600);
const listHasCards = await page.$$eval('.driver-journey-card', (els) => els.length);
if (!listHasCards) { log('ABORT: no journey cards on the board'); await browser.close(); process.exit(2); }
// Real control interaction: click the "Lệnh mới" tab (default bucket) to
// re-render the list before the capture.
const tabs = await page.$$eval('[role="tab"]', (els) => els.map((el) => el.textContent?.trim() ?? ''));
const newTab = await page.$$('[role="tab"]');
for (const el of newTab) {
  if ((await el.evaluate((n) => n.textContent ?? '')).includes('Lệnh mới')) { await el.click(); break; }
}
await sleep(500);
await shot(page, 'list-new-390');
const assertNoCode = (label, state) => {
  check(`${label} no trip-code testid`, state.codeTestIds === 0, `count=${state.codeTestIds}`);
  check(`${label} no "Mã chuyến" label`, !state.bodyText.includes('Mã chuyến'));
  check(`${label} no raw/formatted code text`, !/TRP[\s-]20\d{2}/.test(state.bodyText), state.bodyText.match(/TRP[\s\S]{0,20}/)?.[0] ?? 'clean');
};
const newState = await page.evaluate(() => ({
  codeTestIds: document.querySelectorAll('[data-testid="trip-code"]').length,
  bodyText: document.body.textContent ?? '',
}));
assertNoCode('T01 list[Lệnh mới]', newState);
const billLeads = await page.$$eval('.driver-journey-card__bill', (els) => els.map((el) => el.textContent?.trim()));
check('T01 bill/booking still the lead identity', billLeads.length > 0 && billLeads.every(Boolean), JSON.stringify(billLeads));

// T01b: switch to "Đã nhận" tab — the RUNNING bucket card must stay code-free.
const runningTab = (await page.$$('[role="tab"]')).find(async (el) => {});
for (const el of await page.$$('[role="tab"]')) {
  if ((await el.evaluate((n) => n.textContent ?? '')).includes('Đã nhận')) { await el.click(); break; }
}
await sleep(500);
await shot(page, 'list-running-390');
const runningState = await page.evaluate(() => ({
  codeTestIds: document.querySelectorAll('[data-testid="trip-code"]').length,
  bodyText: document.body.textContent ?? '',
}));
assertNoCode('T01b list[Đã nhận]', runningState);
log(`TABS rendered: ${JSON.stringify(tabs)}`);

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
check('T02 no raw/formatted code text on detail', !/TRP[\s-]20\d{2}/.test(detailState.bodyText), detailState.bodyText.match(/TRP[\s\S]{0,20}/)?.[0] ?? 'clean');
fs.writeFileSync(path.join(OUT, '2026-10-27_sil535_dom-detail-facts.txt'), `${JSON.stringify(detailState.order, null, 2)}\n`);

// ── T03: penalties — violation meta never names a trip code ────────────────
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
