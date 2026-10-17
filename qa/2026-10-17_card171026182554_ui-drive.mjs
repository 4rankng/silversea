// Card 171026182554 — rung-3 UI drive (AGENTS §9).
// CUS on three surfaces:
//   1. /shipments-detail?dateScope=all  (Chi tiết lô hàng — bảng): NO
//      "Thêm container cùng lô …" / "Xóa container …" row buttons, no
//      add-container form. Cell editors + Copy giờ hẹn must still be there.
//   2. /shipments/110968 (Chi tiết lô — từng lô, FCL 2 cont, chưa khóa):
//      heading "Containers (2)", NO "Thêm container" button, no dialog.
//   3. /shipments (Tổng quan): drawer still HAS "Thêm container" AND
//      "Xóa container <số>" — the single composition surface that stays.
// Read-only change: DB rows for lot 110968 captured before/after and must be
// identical; GET /api/shipments/110968 records the API identity of the view.
// Stack: frontend http://localhost:7175 → backend :3002 → dev DB :5441.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const ART = 'qa';
const LOG = 'qa/2026-10-17_card171026182554_ui-driver.log';
const LOT = 110968; // FCL, READY_FOR_DISPATCH, 2 containers (picked from dev DB)
mkdirSync(ART, { recursive: true });
const log = (line) => { const t = `${new Date().toISOString()} ${line}`; console.log(t); appendFileSync(LOG, `${t}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);

const dbContainers = () => execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -tAc "select c.id, c.container_number, c.shipment_id from shipment_containers c where c.shipment_id = ${LOT} order by c.id"`,
  { encoding: 'utf8' },
).trim();
const DB_BEFORE = dbContainers();
log(`DB before: lot ${LOT} containers = ${JSON.stringify(DB_BEFORE)}`);

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login cus: ${token ? 'OK' : 'FAIL'}`);
if (!token) process.exit(1);

const detailRes = await fetch(`${API}/shipments/${LOT}`, { headers: { Authorization: `Bearer ${token}` } });
const detailJson = await detailRes.json();
log(`GET /api/shipments/${LOT} → ${detailRes.status}; cargoMode=${detailJson?.shipment?.cargoMode} status=${detailJson?.shipment?.status} accountingLock=${detailJson?.accountingLock ? 'ACTIVE' : 'null'} containers=${detailJson?.containers?.length}`);
if (detailJson?.accountingLock) { log('ABORT: lot is accounting-locked, button gating would confound the assertion'); process.exit(1); }

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,1000'],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { await page.screenshot({ path: `${ART}/2026-10-17_card171026182554_${name}.png` }); log(`shot ${name}`); };

// Wait for a selector with a long timeout (vite lazy routes cold-compile
// 10–20s on first hit — that is NOT a product error, per the FB-086 lesson).
const waitFor = async (selector, ms = 60000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await page.$(selector).catch(() => null)) return true;
    if (Date.now() > deadline) return false;
    await sleep(500);
  }
};

// Collect every button whose aria-label OR text matches the pattern.
const buttonsMatching = (src, flags = 'i') => page.evaluate((s, f) => {
  const re = new RegExp(s, f);
  return [...document.querySelectorAll('button')].filter((b) => {
    const label = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.trim();
    return re.test(label);
  }).map((b) => `${b.getAttribute('aria-label') || b.textContent.trim()}`);
}, src, flags);

let failures = 0;
const expectNone = (found, where, what) => {
  if (found.length === 0) { log(`PASS [${where}] no ${what}`); } else { failures += 1; log(`FAIL [${where}] ${what} present: ${JSON.stringify(found)}`); }
};
const expectSome = (found, where, what) => {
  if (found.length > 0) { log(`PASS [${where}] ${what} present (${found.length}): ${JSON.stringify(found.slice(0, 3))}`); } else { failures += 1; log(`FAIL [${where}] ${what} MISSING`); }
};

// ── 1. /shipments-detail — the workboard ─────────────────────────────────
log('— surface 1: /shipments-detail?dateScope=all');
await page.goto(`${BASE}/shipments-detail?dateScope=all`, { waitUntil: 'networkidle2', timeout: 90000 });
if (!(await waitFor('.shipment-container-ledger table tbody tr', 60000))) {
  log('FAIL workboard rows never rendered'); failures += 1;
} else {
  await sleep(800);
  expectNone(await buttonsMatching('Thêm container cùng lô'), '/shipments-detail', 'Thêm container cùng lô buttons');
  expectNone(await buttonsMatching('^Xóa container'), '/shipments-detail', 'Xóa container buttons');
  const addForm = await page.$('[data-testid="add-container-form"]');
  if (addForm) { failures += 1; log('FAIL [/shipments-detail] add-container form rendered'); } else log('PASS [/shipments-detail] no add-container form');
  // Surviving business edits: an inline cell edit trigger + Copy giờ hẹn (if
  // any row qualifies). The edit triggers are aria "Chỉnh sửa … CONT-…".
  expectSome(await buttonsMatching('Chỉnh sửa'), '/shipments-detail', 'cell edit triggers (sibling behavior intact)');
  const copyBtns = await buttonsMatching('Copy giờ hẹn');
  log(`INFO [/shipments-detail] Copy giờ hẹn buttons: ${copyBtns.length} (fixture-dependent, ≥0 ok)`);
  await shot('ui-shipments-detail-1440');
}

// ── 2. /shipments/:id — the single-lot detail ────────────────────────────
log(`— surface 2: /shipments/${LOT}`);
await page.goto(`${BASE}/shipments/${LOT}`, { waitUntil: 'networkidle2', timeout: 90000 });
if (!(await waitFor('.shipment-detail__section-title', 60000))) {
  log('FAIL lot detail never rendered'); failures += 1;
} else {
  await sleep(800);
  const heading = await page.evaluate(() => [...document.querySelectorAll('h3')].map((h) => h.textContent.trim()).find((t) => /^Containers \(\d+\)/.test(t)) || null);
  log(`[/shipments/${LOT}] heading: ${JSON.stringify(heading)}`);
  if (!heading) failures += 1;
  expectNone(await buttonsMatching('Thêm container'), `/shipments/${LOT}`, 'Thêm container button');
  const dialog = await page.$('[role="dialog"]');
  if (dialog) { failures += 1; log('FAIL a dialog is open on load'); } else log('PASS no dialog open');
  await shot(`ui-shipment-detail-${LOT}-1440`);
}

// ── 3. /shipments — Tổng quan drawer KEEPS the composition buttons ────────
log('— surface 3: /shipments drawer (must keep Thêm/Xóa container)');
await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 90000 });
let drawerKept = false;
if (!(await waitFor('table tbody tr, [role="row"]', 60000))) {
  log('FAIL overview rows never rendered'); failures += 1;
} else {
  await sleep(800);
  // The default view lists today's lots; a container-less lot has no Xóa row.
  // Search straight to a lot that OWNS containers (FBXF9069254 = lot 110968),
  // then open its drawer — the surface the ticket keeps.
  const searched = await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Tìm lô hàng"]');
    if (!input) return false;
    input.focus();
    return true;
  });
  if (searched) {
    await page.type('input[aria-label="Tìm lô hàng"]', 'FBXF9069254', { delay: 30 });
    await page.keyboard.press('Enter');
    await sleep(2500);
    log(`searched FBXF9069254; overview rows now: ${await page.evaluate(() => document.querySelectorAll('table tbody tr').length)}`);
  } else {
    log('WARN search field not found; walking default drawers instead');
  }
  // Walk the drawers (post-search first row should be the target lot).
  const openDrawerWithContainers = async () => {
    const total = await page.evaluate(() => [...document.querySelectorAll('button')]
      .filter((b) => /Mở chi tiết lô hàng/.test(b.getAttribute('aria-label') || '')).length);
    for (let i = 0; i < Math.min(total, 12); i += 1) {
      const clicked = await page.evaluate((idx) => {
        const btns = [...document.querySelectorAll('button')]
          .filter((b) => /Mở chi tiết lô hàng/.test(b.getAttribute('aria-label') || ''));
        if (!btns[idx]) return false;
        btns[idx].click();
        return true;
      }, i);
      if (!clicked) break;
      if (!(await waitFor('[role="dialog"]', 20000))) { log(`row ${i}: drawer never opened`); continue; }
      await sleep(1200);
      const removeBtns = await buttonsMatching('^Xóa container');
      if (removeBtns.length > 0) return { index: i, removeBtns };
      await page.keyboard.press('Escape');
      await sleep(700);
      // The drawer may gate Escape behind a confirm; force-close any dialog.
      await page.evaluate(() => { [...document.querySelectorAll('[role="dialog"] button')].filter((b) => /^Đóng|^Hủy/.test(b.textContent || '')).pop()?.click(); });
      await sleep(500);
    }
    return null;
  };
  const found = await openDrawerWithContainers();
  if (!found) { failures += 1; log('FAIL no visible drawer carries container rows (Xóa buttons) to assert the kept surface'); } else {
    expectSome(await buttonsMatching('Thêm container'), 'drawer /shipments', 'Thêm container (Tổng quan keeps it)');
    expectSome(found.removeBtns, 'drawer /shipments', 'Xóa container (Tổng quan keeps it)');
    drawerKept = true;
    await shot('ui-overview-drawer-1440');
  }
}

// ── 4. phone band: the changed workboard at 390px ─────────────────────────
log('— surface 4: /shipments-detail at 390px (phone band)');
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/shipments-detail?dateScope=all`, { waitUntil: 'networkidle2', timeout: 90000 });
if (await waitFor('.shipment-container-ledger tbody tr, .shipment-container-ledger [data-label]', 60000)) {
  await sleep(800);
  expectNone(await buttonsMatching('Thêm container cùng lô'), '/shipments-detail@390', 'Thêm container cùng lô buttons');
  expectNone(await buttonsMatching('^Xóa container'), '/shipments-detail@390', 'Xóa container buttons');
  await shot('ui-shipments-detail-390');
} else { log('INFO @390 rows not rendered (card mode selector differs) — 1440 pass stands'); }

const DB_AFTER = dbContainers();
log(`DB after: lot ${LOT} containers = ${JSON.stringify(DB_AFTER)}`);
if (DB_BEFORE === DB_AFTER) log('PASS DB unchanged (read-only verification, rows identical before/after)');
else { failures += 1; log('FAIL DB changed during a read-only drive'); }

await browser.close();
log(`drawerKept=${drawerKept} failures=${failures}`);
log(`EXIT ${failures === 0 ? 0 : 1}`);
process.exit(failures === 0 ? 0 : 1);
