/**
 * Lane H1 — UI DRIVEN probes for SIL-708 (Phân xe lại dư), SIL-714 (Cập nhật
 * biển số xe ngoài — Điều vận + CUS), SIL-699 (drawer /shipments).
 *
 * Stack under test: THIS worktree (h1b-fix) — BE :3012, FE :7185 (isolated
 * from the :3002/:7175 stack another worktree owns).
 *
 * Fixtures (local dev DB): EXTERNAL CREATED trips awaiting plate —
 *   trip 39 TRP-202610-0015 (ful 167, shipment 113 SHP-2610-00053, cont TCNU5789751) → Điều vận surface
 *   trip 37 TRP-202610-0013 (ful 164, shipment 110 SHP-2610-00050, cont ONEU4909935) → CUS surface
 *
 * Evidence: qa/2026-11-07-lane-h1/01..07-*.png · driver-h1.log ·
 * this script's exit code · DB read-back done separately into sil714-db-proof.txt
 */
import puppeteer from 'puppeteer';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.H1_BASE_URL ?? 'http://localhost:7186';
const API = process.env.H1_API_URL ?? 'http://localhost:3013/api';

const log = [];
function step(name, detail) {
  const line = `${new Date().toISOString()} ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`;
  log.push(line);
  console.log(line);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  const file = path.join(HERE, name);
  await page.screenshot({ path: file, fullPage: false });
  step('screenshot', { file });
}

async function login(page, user, pass) {
  // The browser context shares localStorage across probes — a leftover
  // session makes /login bounce before the form submits, and the next
  // probe silently runs as the PREVIOUS user (role guards then bounce every
  // deep link). Wipe storage first, then log in for real.
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' }).catch(() => {});
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input', { timeout: 20000 });
  const inputs = await page.$$('input');
  await inputs[0].type(user);
  await inputs[1].type(pass);
  await Promise.all([
    page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 }),
    page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Đăng nhập')?.click();
    }),
  ]);
  step('login', { user, url: page.url() });
}

/** The dispatch row menu portals to body — collect its item labels. */
async function openRowMenuAndGetItems(page, rowText) {
  await page.evaluate((text) => {
    const row = [...document.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(text));
    if (!row) throw new Error(`row not found: ${text}`);
    const trigger = [...row.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('Thao tác dòng'));
    if (!trigger) throw new Error('row ⋯ trigger not found');
    trigger.click();
  }, rowText);
  await page.waitForSelector('.dispatch-row-menu__list', { timeout: 10000 });
  const items = await page.evaluate(() => (
    [...document.querySelectorAll('.dispatch-row-menu__list [role="menuitem"]')].map((b) => b.textContent?.trim())
  ));
  return items;
}

async function fillPlateDialogAndSave(page, plate, openShotName) {
  await page.waitForSelector('#trip-external-plate-input', { timeout: 15000 });
  await shot(page, openShotName);
  await page.evaluate(() => { (document.querySelector('#trip-external-plate-input')).focus(); });
  await page.keyboard.type(plate);
  const savedValue = await page.$eval('#trip-external-plate-input', (el) => el.value);
  step('plate typed', { typed: plate, input: savedValue });
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Lưu biển số'))?.click();
  });
  // Toast + row refresh — wait for the success toast text.
  await page.waitForFunction(
    (t) => document.body.textContent?.includes(t),
    { timeout: 20000 },
    'Đã cập nhật biển số xe ngoài.',
  );
  await sleep(800);
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
let exitCode = 0;
const results = {};

try {
  await mkdir(HERE, { recursive: true });

  /* ---------- Probe 1: SIL-699 — drawer on /shipments (CUS) ---------- */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await login(page, 'cus', 'Abc123');
    await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => (
      [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Chi tiết')
    ), { timeout: 30000 });
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Chi tiết')?.click();
    });
    await page.waitForFunction(() => Boolean(document.querySelector('.cus-shipment-drawer')), { timeout: 15000 });
    const urlAfter = page.url();
    const drawerText = await page.$eval('.cus-shipment-drawer', (el) => el.textContent?.slice(0, 200));
    results.sil699 = { urlAfter, drawerPresent: true, drawerText };
    step('SIL-699 drawer opened', { urlAfter, drawerText });
    if (!urlAfter.includes('/shipments-detail')) step('SIL-699 PASS: URL stayed on the list', {});
    else throw new Error(`SIL-699 FAIL: navigated to ${urlAfter}`);
    await shot(page, '01-sil699-drawer.png');
    await page.close();
  }

  /* ---------- Probe 2: SIL-708 — /trips/:id ⋯ menu has no Phân xe lại ---------- */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await login(page, 'admin', 'Abc123');
    // Trip 39 is CREATED — admin holds canCancel, so the overflow menu renders.
    await page.goto(`${BASE}/trips/39`, { waitUntil: 'networkidle2' });
    let summaryFound = await page.waitForSelector('summary[aria-label="Mở các thao tác khác"]', { timeout: 45000 }).then(() => true).catch(() => false);
    if (!summaryFound) {
      // Diagnostic + one reload retry: the first paint after a cold vite
      // transform can stall networkidle2 before the trip query resolves.
      const bodySnippet = await page.evaluate(() => document.body.textContent?.slice(0, 300));
      step('SIL-708 first paint stalled — retrying', { url: page.url(), bodySnippet });
      await shot(page, '02a-sil708-stalled.png');
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForSelector('summary[aria-label="Mở các thao tác khác"]', { timeout: 45000 });
    }
    await page.evaluate(() => document.querySelector('summary[aria-label="Mở các thao tác khác"]').click());
    await page.waitForSelector('.header-overflow__menu', { timeout: 10000 });
    const menuItems = await page.$$eval('.header-overflow__menu [role="menuitem"]', (els) => els.map((e) => e.textContent?.trim()));
    results.sil708TripsMenu = menuItems;
    step('SIL-708 trips overflow menu items', { menuItems });
    if (menuItems.some((t) => t?.includes('Phân xe lại'))) throw new Error(`SIL-708 FAIL: menu still has Phân xe lại: ${menuItems}`);
    step('SIL-708 PASS: no Phân xe lại in the trips header menu', {});
    await shot(page, '02-sil708-trips-menu.png');
    await page.close();
  }

  /* ---------- Probe 3: SIL-714 dispatch — row menu + dialog (dieuvan) ---------- */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await login(page, 'dieuvan', 'Abc123');
    await page.goto(`${BASE}/dispatch-detail?q=ONEU4909935&date=2026-10-10`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.textContent?.includes('ONEU4909935'), { timeout: 30000 });
    const items = await openRowMenuAndGetItems(page, 'ONEU4909935');
    results.sil714DispatchMenu = items;
    step('SIL-714 dispatch row menu items', { items });
    if (!items.some((t) => t?.includes('Cập nhật biển số'))) throw new Error(`SIL-714 FAIL: no Cập nhật biển số in menu: ${items}`);
    if (items.some((t) => t?.includes('Phân xe lại'))) throw new Error(`SIL-708 FAIL: dispatch menu still offers Phân xe lại: ${items}`);
    await shot(page, '03-sil714-dispatch-menu.png');
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('.dispatch-row-menu__list [role="menuitem"]')]
        .find((b) => b.textContent?.includes('Cập nhật biển số'));
      item?.click();
    });
    await fillPlateDialogAndSave(page, '60H-714.31', '03b-sil714-dispatch-dialog.png');
    await shot(page, '04-sil714-dispatch-saved.png');
    // The grid refetches — the row must no longer offer the verb (plate now set).
    await page.waitForFunction(() => document.body.textContent?.includes('60H-714.31'), { timeout: 20000 });
    const itemsAfter = await openRowMenuAndGetItems(page, 'ONEU4909935');
    results.sil714DispatchMenuAfter = itemsAfter;
    step('SIL-714 dispatch row menu after save', { itemsAfter });
    if (itemsAfter.some((t) => t?.includes('Cập nhật biển số'))) throw new Error('SIL-714 FAIL: verb still offered after plate saved');
    await page.close();
  }

  /* ---------- Probe 4: SIL-714 CUS — PHÂN XE cell + dialog (cus) ---------- */
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await login(page, 'cus', 'Abc123');
    await page.goto(`${BASE}/shipments-detail?dateScope=all&searchSuffix=TCNU5789751`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.textContent?.includes("TCNU5789751"), { timeout: 60000 });
    await page.waitForFunction(() => (
      [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Cập nhật biển số'))
    ), { timeout: 15000 });
    await shot(page, '05-sil714-cus-cell.png');
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Cập nhật biển số'))?.click();
    });
    await fillPlateDialogAndSave(page, '60H-714.32', '05b-sil714-cus-dialog.png');
    await shot(page, '06-sil714-cus-saved.png');
    await page.waitForFunction(() => document.body.textContent?.includes('60H-714.32'), { timeout: 20000 });
    step('SIL-714 CUS PASS: plate visible on the workboard after save', {});
    await page.close();
  }

  /* ---------- Probe 5: API RBAC — OPS PATCH external-plate must 403 ---------- */
  // The /shipments-detail workboard API already excludes OPS upstream
  // (cus-workspace GET requireRoles has no OPS), so an OPS UI probe never
  // reaches this surface at all — the server-side negative lives HERE.
  {
    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'giaonhan', password: 'Abc123' }),
    });
    const { token } = await loginRes.json();
    const res = await fetch(`${API}/shipments/trips/37/external-plate`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': 'qa-ops-negative-1' },
      body: JSON.stringify({ externalPlateNumber: '99K-999.99', expectedVersion: 2 }),
    });
    results.opsPatchStatus = res.status;
    const body = await res.json().catch(() => ({}));
    step('SIL-714 OPS PATCH status', { status: res.status, body });
    if (res.status !== 403) throw new Error(`SIL-714 FAIL: OPS PATCH expected 403, got ${res.status}`);
    step('SIL-714 PASS: OPS PATCH denied 403', {});
    await writeFile(path.join(HERE, '07-sil714-ops-api-403.json'), JSON.stringify({ status: res.status, body }, null, 2));
  }
} catch (error) {
  exitCode = 1;
  step('DRIVER FAILED', { error: String(error) });
} finally {
  await browser.close();
  await writeFile(path.join(HERE, 'driver-h1.log'), log.join('\n') + '\n');
  await writeFile(path.join(HERE, 'driver-h1-results.json'), JSON.stringify(results, null, 2));
  // Clean up the temp screenshots from fillPlateDialogAndSave.
  await writeFile(path.join(HERE, 'driver-h1.exit'), String(exitCode));
}
process.exit(exitCode);
