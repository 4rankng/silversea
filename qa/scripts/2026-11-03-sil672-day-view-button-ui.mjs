// SIL-672 — /my-trips drops the "Lệnh trong ngày" header shortcut (the board
// IS the day view); paired-orders screen renames to "Lệnh ghép". Rung-3 UI
// drive on the LOCAL worktree stack (frontend 7175 / backend 3002, DB 5441).
// Run twice per the owner UI contract: MODE=before with the fix stashed,
// MODE=after with the fix applied — real click-through of the day-view tabs
// and the paired-orders direct URL in both.
//
//   MODE=before node qa/scripts/2026-11-03-sil672-day-view-button-ui.mjs
//   MODE=after  node qa/scripts/2026-11-03-sil672-day-view-button-ui.mjs
// Env: FRONT_PORT (7175), API_PORT (3002), DRIVER (bqhuong).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const MODE = process.env.MODE ?? 'after';
const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7175}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const DRIVER = process.env.DRIVER ?? 'bqhuong';
const OUT = path.resolve('qa/2026-11-03-sil672');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `2026-11-03_sil672_ui-driver-${MODE}.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `2026-11-03_sil672_ui-${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ── Health + login (house recipe: API login, token pre-injected) ─────────────
const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT} mode=${MODE}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: DRIVER, password: 'Abc123' }),
});
if (!loginRes.ok) { log(`ABORT: login failed for ${DRIVER} (${loginRes.status})`); process.exit(2); }
const { token } = await loginRes.json();
log(`LOGIN ok driver=${DRIVER}`);

// ── DB/API identity capture (read-only): the day-view data is untouched ──────
const board = await fetch(`${API}/driver/me/journey-board`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json()).catch(() => null);
const bucketCounts = {};
for (const card of board?.items ?? []) bucketCounts[card.bucket] = (bucketCounts[card.bucket] ?? 0) + 1;
log(`API journey-board items=${board?.items?.length ?? 'null'} buckets=${JSON.stringify(bucketCounts)}`);
check('CONTRACT journey-board readable', Array.isArray(board?.items), `items=${board?.items?.length}`);

const paired = await fetch(`${API}/driver/me/two-orders`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json()).catch(() => null);
log(`API paired-orders allToday=${paired?.allToday?.length ?? 'null'} hasPair=${Boolean(paired?.pair)}`);
fs.writeFileSync(path.join(OUT, `2026-11-03_sil672_api-identity-${MODE}.json`),
  JSON.stringify({ board: { items: board?.items?.length, buckets: bucketCounts }, paired: { allToday: paired?.allToday?.length, hasPair: Boolean(paired?.pair) } }, null, 2) + '\n');

const dbRow = execSync(`docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "select 'trips_total=' || count(*) || ' today=' || count(*) filter (where t.departure_date = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) from trips t join drivers d on d.id = t.driver_id join users u on u.id = d.user_id where u.username = '${DRIVER}' and t.deleted_at is null"`).toString().trim();
log(`DB ${dbRow} (driver=${DRIVER}, read-only identity)`);
fs.writeFileSync(path.join(OUT, `2026-11-03_sil672_db-driver-trips-${MODE}.txt`), `${dbRow}\n`);

// ── Browser drive ────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, token);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(`${FRONT}/my-trips`, { waitUntil: 'networkidle2' });
await sleep(900);
await shot(page, `mytrips-390-${MODE}`);
const tripsState = await page.evaluate(() => ({
  shortcutHrefs: Array.from(document.querySelectorAll('a[href="/my-trips/paired-orders"]')).map((a) => a.textContent?.trim()),
  tabs: Array.from(document.querySelectorAll('[role="tab"]')).map((t) => t.textContent?.trim()),
  cards: document.querySelectorAll('.driver-journey-card').length,
  bodyHasOldLabel: (document.body.textContent ?? '').includes('Lệnh trong ngày'),
  title: document.title,
}));
log(`DOM my-trips shortcut=${JSON.stringify(tripsState.shortcutHrefs)} tabs=${tripsState.tabs.length} cards=${tripsState.cards} title="${tripsState.title}"`);

if (MODE === 'before') {
  check('BEFORE shortcut link exists (old UI)', tripsState.shortcutHrefs.length === 1, JSON.stringify(tripsState.shortcutHrefs));
  check('BEFORE shortcut named "Lệnh trong ngày"', tripsState.bodyHasOldLabel);
} else {
  check('AFTER no shortcut link on /my-trips (SIL-672 AC1)', tripsState.shortcutHrefs.length === 0, JSON.stringify(tripsState.shortcutHrefs));
  check('AFTER no "Lệnh trong ngày" text on /my-trips', !tripsState.bodyHasOldLabel);
  check('AFTER day-view tabs intact (SIL-672 AC2)', tripsState.tabs.length === 3, JSON.stringify(tripsState.tabs));
}

// Click-through every day-view tab; the panel must re-render each time.
for (const tabName of ['Lệnh mới', 'Đã nhận', 'Lịch sử']) {
  const clicked = await page.evaluate((name) => {
    const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((t) => (t.textContent ?? '').includes(name));
    if (!tab) return false;
    tab.click();
    return true;
  }, tabName);
  await sleep(500);
  const panel = await page.evaluate(() => {
    const p = document.querySelector('[role="tabpanel"]');
    return { visible: Boolean(p), content: p?.textContent?.trim().slice(0, 80) ?? '' };
  });
  check(`AFTER tab click-through "${tabName}"`, clicked && panel.visible, `panel="${panel.content}"`);
  if (tabName === 'Đã nhận') await shot(page, `mytrips-390-${MODE}-tab-running`);
}

// ── paired-orders direct URL: stays alive, renamed ──────────────────────────
await page.goto(`${FRONT}/my-trips/paired-orders`, { waitUntil: 'networkidle2' });
await sleep(900);
await shot(page, `paired-orders-390-${MODE}`);
const pairedState = await page.evaluate(() => ({
  h1: document.querySelector('h1')?.textContent?.trim() ?? '',
  title: document.title,
  notFound: /404|không tìm thấy trang/i.test(document.body.textContent ?? ''),
  bodyHasOldLabel: (document.body.textContent ?? '').includes('Lệnh trong ngày'),
}));
log(`DOM paired-orders h1="${pairedState.h1}" title="${pairedState.title}" notFound=${pairedState.notFound}`);

if (MODE === 'before') {
  check('BEFORE paired-orders loads by URL', !pairedState.notFound, `h1="${pairedState.h1}"`);
  check('BEFORE paired-orders header still old label', pairedState.bodyHasOldLabel, `h1="${pairedState.h1}"`);
} else {
  check('AFTER paired-orders loads directly, no 404 (SIL-672 AC3)', !pairedState.notFound, `h1="${pairedState.h1}"`);
  check('AFTER paired-orders h1 renamed (AC4)', pairedState.h1 === 'Lệnh ghép' || pairedState.h1 === 'Lệnh ghép 2 chiều', `h1="${pairedState.h1}"`);
  check('AFTER paired-orders no "Lệnh trong ngày" anywhere (AC4)', !pairedState.bodyHasOldLabel);
  check('AFTER paired-orders document.title = "Hành trình · Lệnh ghép…"', pairedState.title.includes('Hành trình · Lệnh ghép'), pairedState.title);
}

// Sibling widths on the AFTER pass (390 primary already captured).
if (MODE === 'after') {
  for (const width of [768, 1440]) {
    await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
    await page.goto(`${FRONT}/my-trips`, { waitUntil: 'networkidle2' });
    await sleep(700);
    await shot(page, `mytrips-${width}-after`);
    const layout = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      shortcutLinks: document.querySelectorAll('a[href="/my-trips/paired-orders"]').length,
    }));
    check(`AFTER ${width}px no horizontal overflow, no shortcut`, !layout.horizontalOverflow && layout.shortcutLinks === 0, JSON.stringify(layout));
    await page.goto(`${FRONT}/my-trips/paired-orders`, { waitUntil: 'networkidle2' });
    await sleep(700);
    await shot(page, `paired-orders-${width}-after`);
  }
}

check('console errors none', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');
await browser.close();
log(`DONE mode=${MODE} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
