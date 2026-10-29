// SIL-592 (board id 692) — "[BUG] CUS chưa có chức năng xác nhận hoàn thành
// vận chuyển cho xe ngoài" — rung-3 verification drive on the LOCAL worktree
// build (frontend 7175 / backend 3002, dev DB 5441).
//
// Rows under drive (local dev seed):
//   cont FFAU6012758 (lot WITSE2609038, trip 50, EXTERNAL, plate 15H-12541)
//     — live plated external trip: the closable case (T01/T02/T05).
//   lot R42DIS-02 (trip 54, EXTERNAL, plate 15C-99999)
//     — live plated external LOT row, left live: mobile geometry (T03).
//   cont TCNU5789751 (trip 39, EXTERNAL, plate NONE)
//     — deferred-plate trip: server 409s completion ("Chuyến chưa có biển số
//     xe…", card 20261004_359) so the row must show NO affordance (T04).
//
//   T01 desktop 1280 workboard: "Hoàn thành chuyến xe ngoài của FFAU6012758"
//       in the Trạng thái cell, not clipped.
//   T02 drawer 1280 (BEFORE completion): the same action on the drawer's
//       container line (SIL-485's read-only rewrite had dropped it).
//   T03 mobile 390 workboard (lot row, stays live): wrap, never clip.
//   T04 desktop 1280: plate-less row renders NO close button (no dead button).
//   T05 desktop 1280: click → ConfirmDialog → confirm → success toast
//       "Đã hoàn thành chuyến xe ngoài." + chip flips to "Hoàn thành" + the
//       API row persists tripStatus=COMPLETED.
//
//   node qa/scripts/2026-10-29-sil592-cus-external-trip-complete-ui-drive.mjs
// Env: FRONT_PORT (7175), API_PORT (3002)
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7175}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const OUT = path.resolve('qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '2026-10-29_sil592_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `2026-10-29_sil592_ui-${name}.png`), fullPage: false });

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

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });

async function openPage(viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument((t) => {
    if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
  }, cusToken);
  return page;
}

const buttonFacts = (page) => page.evaluate(() => {
  const b = document.querySelector('button.external-trip-complete');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const cell = b.closest('td');
  const c = cell?.getBoundingClientRect();
  return {
    label: b.getAttribute('aria-label'),
    text: b.textContent,
    w: Math.round(r.width), h: Math.round(r.height),
    cellW: c ? Math.round(c.width) : null,
    clippedByCell: c ? (r.right > c.right + 1 || r.left < c.left - 1) : null,
    wraps: getComputedStyle(b).whiteSpace,
    overflowsSelf: b.scrollWidth > b.clientWidth + 1,
  };
});

const desktop = await openPage({ width: 1280, height: 900 });

// ── T01: desktop 1280 — the close action on the live plated external row ───
try {
  await desktop.goto(`${FRONT}/shipments-detail?dateScope=all&searchSuffix=FFAU6012758`, { waitUntil: 'networkidle2' });
  await desktop.waitForSelector('button.external-trip-complete', { timeout: 20000 });
  await sleep(800);
  const t01 = await buttonFacts(desktop);
  log(`T01 button facts: ${JSON.stringify(t01)}`);
  check('T01 close button on live plated EXTERNAL row (1280)', t01?.label === 'Hoàn thành chuyến xe ngoài của FFAU6012758', t01?.label);
  check('T01 button not clipped by its cell (1280)', t01?.clippedByCell === false && t01?.overflowsSelf === false, `cellW=${t01?.cellW} w=${t01?.w}`);
  check('T01 wrap law (white-space normal)', t01?.wraps === 'normal', t01?.wraps);
  await shot(desktop, 'desktop-button');
} catch (error) {
  check('T01 desktop drive completed without exception', false, String(error).slice(0, 200));
}

// ── T02: drawer 1280 — same action on the drawer's container line ──────────
try {
  const drawer = await openPage({ width: 1280, height: 900 });
  await drawer.goto(`${FRONT}/shipments?searchSuffix=WITSE2609038`, { waitUntil: 'networkidle2' });
  await drawer.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Chi tiết'), { timeout: 20000 });
  await drawer.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Chi tiết');
    btn?.click();
  });
  await drawer.waitForSelector('button.external-trip-complete', { timeout: 20000 });
  const t02 = await buttonFacts(drawer);
  log(`T02 drawer button facts: ${JSON.stringify(t02)}`);
  check('T02 drawer close button on live EXTERNAL line', t02?.label === 'Hoàn thành chuyến xe ngoài của FFAU6012758', t02?.label);
  await sleep(400);
  await shot(drawer, 'drawer-button');
  await drawer.close();
} catch (error) {
  check('T02 drawer drive completed without exception', false, String(error).slice(0, 200));
}

// ── T03: mobile 390 — wrap, never clip (lot row stays live) ────────────────
try {
  const mobile = await openPage({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mobile.goto(`${FRONT}/shipments-detail?dateScope=all&searchSuffix=R42DIS-02`, { waitUntil: 'networkidle2' });
  await mobile.waitForSelector('button.external-trip-complete', { timeout: 20000 });
  await sleep(800);
  const t03 = await buttonFacts(mobile);
  log(`T03 button facts: ${JSON.stringify(t03)}`);
  check('T03 close button present at 390 (lot row)', t03?.label === 'Hoàn thành chuyến xe ngoài của R42DIS-02', t03?.label);
  check('T03 no clipping at 390 (wrap-full)', t03?.clippedByCell === false && t03?.overflowsSelf === false && t03?.wraps === 'normal', JSON.stringify(t03));
  await shot(mobile, 'mobile-390-button');
  await mobile.close();
} catch (error) {
  check('T03 mobile drive completed without exception', false, String(error).slice(0, 200));
}

// ── T04: desktop 1280 — plate-less trip shows NO dead affordance ───────────
try {
  await desktop.goto(`${FRONT}/shipments-detail?dateScope=all&searchSuffix=TCNU5789751`, { waitUntil: 'networkidle2' });
  await desktop.waitForFunction(() => document.body.innerText.includes('TCNU5789751'), { timeout: 20000 });
  await sleep(800);
  const t04 = await desktop.evaluate(() => ({
    buttons: document.querySelectorAll('button.external-trip-complete').length,
    badge: document.querySelector('.shipment-container-ledger__dispatch-badge')?.textContent ?? null,
  }));
  log(`T04 plate-less row facts: ${JSON.stringify(t04)}`);
  check('T04 plate-less deferred trip renders NO close button', t04.buttons === 0, JSON.stringify(t04));
  await shot(desktop, 'desktop-no-button-plateless');
} catch (error) {
  check('T04 dead-affordance check completed without exception', false, String(error).slice(0, 200));
}

// ── T05: desktop 1280 — confirm dialog → complete → toast + chip flip ──────
try {
  await desktop.goto(`${FRONT}/shipments-detail?dateScope=all&searchSuffix=FFAU6012758`, { waitUntil: 'networkidle2' });
  await desktop.waitForSelector('button.external-trip-complete', { timeout: 20000 });
  await desktop.click('button.external-trip-complete');
  await desktop.waitForSelector('[role=dialog]', { timeout: 10000 });
  const dialogText = await desktop.evaluate(() => document.querySelector('[role=dialog]')?.textContent ?? '');
  log(`T05 dialog text: ${dialogText.replace(/\s+/g, ' ').trim()}`);
  check('T05 dialog names the trip and the staff-close rationale', dialogText.includes('Hoàn thành chuyến với xe ngoài FFAU6012758'), dialogText.slice(0, 120));
  await sleep(400);
  await shot(desktop, 'desktop-dialog');
  await desktop.evaluate(() => {
    const btn = [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent?.trim() === 'Hoàn thành chuyến');
    btn?.click();
  });
  await desktop.waitForFunction(() => document.body.innerText.includes('Đã hoàn thành chuyến xe ngoài.'), { timeout: 15000 });
  const toastText = await desktop.evaluate(() => {
    const t = [...document.querySelectorAll('body *')].map((e) => e.childElementCount === 0 ? e.textContent?.trim() : '').find((s) => s === 'Đã hoàn thành chuyến xe ngoài.');
    return t ?? null;
  });
  check('T05 success toast text present', toastText === 'Đã hoàn thành chuyến xe ngoài.', toastText);
  await desktop.waitForFunction(() => {
    const badge = document.querySelector('.shipment-container-ledger__dispatch-badge');
    return badge?.textContent === 'Hoàn thành';
  }, { timeout: 15000 });
  const chip = await desktop.evaluate(() => document.querySelector('.shipment-container-ledger__dispatch-badge')?.textContent);
  check('T05 row dispatch chip flips to Hoàn thành', chip === 'Hoàn thành', chip);
  await sleep(400);
  await shot(desktop, 'desktop-completed');

  // API-side proof of the same row's persisted state.
  const rows = await fetch(`${API}/shipments/cus-workspace/containers?limit=200&searchSuffix=FFAU6012758`, { headers: { Authorization: `Bearer ${cusToken}` } }).then((r) => r.json());
  const row = rows.items?.find((r) => r.containerNumber === 'FFAU6012758');
  log(`T05 api row after close: tripId=${row?.tripId} tripStatus=${row?.tripStatus} dispatchStatus=${row?.dispatchStatus}`);
  check('T05 API row persists tripStatus=COMPLETED', row?.tripStatus === 'COMPLETED', `${row?.tripStatus}`);
} catch (error) {
  check('T05 completion drive completed without exception', false, String(error).slice(0, 200));
}

await desktop.close();
await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
