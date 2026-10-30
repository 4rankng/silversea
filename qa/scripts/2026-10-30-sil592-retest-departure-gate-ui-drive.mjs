// SIL-592 (board id 692) — retest 30/10 fix drive: the departure-date half of
// the CUS staff-close gate. Local worktree build (FE 7175 / BE 3002 / DB 5441).
//
// Rows under drive (local dev DB):
//   lot 167 SHP-2610-00102 (bill R39B1-LCL01, trip 519, EXTERNAL, plate
//   15C-581.58, departure 2026-10-31 = TOMORROW) — the exact QA-retest shape:
//   the close would always 400, so the row must show NO close button (T01).
//   Then the trip's departure is corrected to TODAY (dispatch schedule fix —
//   the operator's real path) and the full close flow drives end-to-end:
//   button appears (T02) → dialog (T03) → confirm → success toast + chip flip
//   (T04) → API row + DB shipment/trip state (T05/T06) → lot bucket «Đã khóa»
//   on the workspace list wire (T07).
//
//   node qa/scripts/2026-10-30-sil592-retest-departure-gate-ui-drive.mjs
// Env: FRONT_PORT (7175), API_PORT (3002)
import puppeteer from 'puppeteer';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7175}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const OUT = path.resolve('qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '2026-10-30_sil592retest_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `2026-10-30_sil592retest_ui-${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login failed for ${identifier} (${res.status})`);
  const { token } = await res.json();
  log(`LOGIN ok ${identifier}`);
  return token;
}

const cusToken = await login(process.env.CUS_USER ?? 'cus');

const db = (sql) => execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -t -A -c ${JSON.stringify(sql)}`,
  { encoding: 'utf8' },
).trim();

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });

async function openPage(viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument((t) => {
    if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
  }, cusToken);
  return page;
}

// ── T01: departure TOMORROW → the dead affordance is GONE (the retest bug) ──
try {
  const before = db("select departure_date::text from trips where id = 519;");
  log(`T01 trip 519 departure_date=${before}`);
  const page = await openPage({ width: 1280, height: 900 });
  await page.goto(`${FRONT}/shipments-detail?dateScope=all&searchSuffix=R39B1-LCL01`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('R39B1-LCL01'), { timeout: 25000 });
  await sleep(900);
  const t01 = await page.evaluate(() => ({
    closeButtons: document.querySelectorAll('button.external-trip-complete').length,
    chip: document.querySelector('.shipment-container-ledger__dispatch-badge')?.textContent ?? null,
  }));
  log(`T01 row facts: ${JSON.stringify(t01)}`);
  check('T01 future-departure row renders NO close button (dead-end gone)', t01.closeButtons === 0, JSON.stringify(t01));
  await shot(page, 't01-no-button-future-departure');
  await page.close();
} catch (error) {
  check('T01 drive completed without exception', false, String(error).slice(0, 200));
}

// ── T02: departure corrected to TODAY (dispatch fixes the schedule) ────────
try {
  db("update trips set departure_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date where id = 519;");
  const after = db("select departure_date::text from trips where id = 519;");
  const today = db('select to_char((now() at time zone \'Asia/Ho_Chi_Minh\')::date, \'YYYY-MM-DD\');');
  log(`T02 trip 519 departure corrected: ${after} (today=${today})`);
  check('T02 departure is today', after === today, `${after} vs ${today}`);

  const page = await openPage({ width: 1280, height: 900 });
  await page.goto(`${FRONT}/shipments-detail?dateScope=all&searchSuffix=R39B1-LCL01`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('R39B1-LCL01'), { timeout: 25000 });
  await page.waitForSelector('button.external-trip-complete', { timeout: 20000 });
  const t02 = await page.evaluate(() => {
    const b = document.querySelector('button.external-trip-complete');
    return { label: b?.getAttribute('aria-label') ?? null, text: b?.textContent ?? null };
  });
  log(`T02 button facts: ${JSON.stringify(t02)}`);
  check('T02 same-day departure row renders the close button', t02.label === 'Hoàn thành chuyến xe ngoài của R39B1-LCL01', t02.label);
  await shot(page, 't02-button-same-day-departure');

  // ── T03: confirm dialog names the staff-close rationale ──────────────────
  await page.click('button.external-trip-complete');
  await page.waitForSelector('[role=dialog]', { timeout: 10000 });
  const dialogText = await page.evaluate(() => document.querySelector('[role=dialog]')?.textContent ?? '');
  log(`T03 dialog text: ${dialogText.replace(/\s+/g, ' ').trim()}`);
  check('T03 dialog names the trip and the staff-close rationale', dialogText.includes('Hoàn thành chuyến với xe ngoài R39B1-LCL01'), dialogText.slice(0, 140));
  await sleep(400);
  await shot(page, 't03-dialog');

  // ── T04: confirm → success toast + chip flips to Hoàn thành ───────────────
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent?.trim() === 'Hoàn thành chuyến');
    btn?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Đã hoàn thành chuyến xe ngoài.'), { timeout: 15000 });
  check('T04 success toast «Đã hoàn thành chuyến xe ngoài.» shown', true);
  await page.waitForFunction(() => {
    const badge = document.querySelector('.shipment-container-ledger__dispatch-badge');
    return badge?.textContent === 'Hoàn thành';
  }, { timeout: 15000 });
  const chip = await page.evaluate(() => document.querySelector('.shipment-container-ledger__dispatch-badge')?.textContent);
  check('T04 row dispatch chip flips to Hoàn thành', chip === 'Hoàn thành', chip);
  await sleep(400);
  await shot(page, 't04-completed');
  await page.close();

  // ── T05: API row persists the close ───────────────────────────────────────
  const rows = await fetch(`${API}/shipments/cus-workspace/containers?limit=20&searchSuffix=R39B1-LCL01`, { headers: { Authorization: `Bearer ${cusToken}` } }).then((r) => r.json());
  const row = rows.items?.[0];
  log(`T05 api row after close: tripId=${row?.tripId} tripStatus=${row?.tripStatus} dispatchStatus=${row?.dispatchStatus}`);
  check('T05 API row persists tripStatus=COMPLETED', row?.tripStatus === 'COMPLETED', `${row?.tripStatus}`);

  // ── T06: DB side effect — trip + shipment rows ────────────────────────────
  const tripRow = db("select status || '|' || coalesce(completed_at::text, 'null') from trips where id = 519;");
  const shipmentRow = db('select status from shipments where id = 167;');
  log(`T06 db trip 519=${tripRow} · shipment 167=${shipmentRow}`);
  check('T06 DB trip 519 COMPLETED with completed_at set', tripRow.startsWith('COMPLETED|'), tripRow);
  check('T06 DB shipment 167 COMPLETED (bucket law → Đã khóa)', shipmentRow === 'COMPLETED', shipmentRow);

  // ── T07: workspace lot list carries bucket LOCKED («Đã khóa») ─────────────
  const lots = await fetch(`${API}/shipments/cus-workspace?limit=20&searchSuffix=R39B1-LCL01`, { headers: { Authorization: `Bearer ${cusToken}` } })
    .then((r) => r.json())
    .catch(() => null);
  const lot = lots?.items?.find((item) => item.shipmentId === 167 || item.id === 167) ?? lots?.items?.[0] ?? null;
  log(`T07 workspace lot: ${JSON.stringify(lot ? { id: lot.shipmentId ?? lot.id, bucket: lot.bucket, status: lot.status } : lots)?.slice(0, 220)}`);
  check('T07 lot bucket reads LOCKED (Đã khóa)', lot?.bucket === 'LOCKED', `${lot?.bucket}`);
} catch (error) {
  check('T02-T07 flow completed without exception', false, String(error).slice(0, 300));
}

await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
