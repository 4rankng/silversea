// SIL-536 (board id 601) — "Hàng lẻ: label Kho CFS/Nhà máy chưa đổi theo chiều
// Nhập/Xuất và mapping Cảng nâng/hạ chưa đúng" — rung-3 verification drive on
// the LOCAL trunk build (frontend 7175 / backend 3002).
//
//   T01 create form (/shipments/new, CUS): switching Nhập khẩu ↔ Xuất khẩu on a
//       Hàng lẻ lot swaps the two operating-point labels —
//         Nhập: "Kho lấy hàng (CFS/Cảng) *" + "Nhà máy (Điểm trả hàng) *"
//         Xuất: "Nhà máy (Điểm lấy hàng) *" + "Kho trả hàng (CFS/Cảng) *"
//   T02 Kế hoạch Chi tiết Xe (/dispatch-detail, DISPATCHER): Cảng nâng = pickup,
//       Cảng hạ = delivery —
//         IMPORT·Lẻ: Nâng = Kho CFS,  Hạ = Nhà máy
//         EXPORT·Lẻ: Nâng = Nhà máy, Hạ = Kho CFS
//       Lots under drive (local seed): R41-LCL06-TEST (IMPORT, kho=CFS Test 1)
//       and R42RV-D2 (EXPORT, kho=CTY LOGISTIC XANH C2).
//
//   node qa/scripts/2026-10-27-sil536-lcl-labels-mapping-ui-drive.mjs
// Env: FRONT_PORT (7175), API_PORT (3002)
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7175}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const OUT = path.resolve('qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '2026-10-27_sil536_lcl-labels-mapping_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `2026-10-27_sil536_lcl-labels-mapping_ui-${name}.png`), fullPage: false });

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

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });

async function openPage(token, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument((t) => {
    if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
  }, token);
  return page;
}

const fieldLabel = (page, fieldId) => page.evaluate((id) => {
  const el = document.querySelector(`[data-field-id="${id}"]`);
  return el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
}, fieldId);

// ── T01: create form label switching (CUS) ──────────────────────────────────
try {
  const cusToken = await login(process.env.CUS_USER ?? 'thanhdc');
  const page = await openPage(cusToken, { width: 1440, height: 900 });
  await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('main, .app-shell, body', { timeout: 20000 });
  await sleep(1200);
  await shot(page, 'create-initial');

  // Pick the first customer so the LCL pickers unlock.
  const khHandle = await page.evaluateHandle(() => {
    const els = Array.from(document.querySelectorAll('[role="combobox"], input[role="combobox"], input'));
    return els.find((el) => (el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? '').toLowerCase().includes('khách')) ?? null;
  });
  const khEl = khHandle.asElement?.();
  if (khEl) {
    await khEl.click();
    await sleep(700);
    const option = await page.$('[role="option"]');
    if (option) { await option.click(); await sleep(500); }
  }
  // Switch cargo mode to Hàng lẻ (native radio name="cargo-mode").
  const lclEl = await page.$('input[type="radio"][name="cargo-mode"][value="LCL"]');
  if (!lclEl) throw new Error('Hàng lẻ radio not found');
  await lclEl.click();
  await page.waitForSelector('[data-field-id="shipment-pickup-warehouse"]', { timeout: 20000 });
  await sleep(400);

  const defaultKho = await fieldLabel(page, 'shipment-pickup-warehouse');
  const defaultFactory = await fieldLabel(page, 'shipment-operational-site');
  check('T01 default labels stand before a direction is picked', true,
    `kho="${defaultKho}" nhamay="${defaultFactory}"`);

  const pickDirection = async (label) => {
    await page.click('#shipment-trade-direction');
    await sleep(500);
    const opts = await page.$$('[role="option"]');
    for (const opt of opts) {
      if ((await opt.evaluate((n) => n.textContent ?? '')).includes(label)) { await opt.click(); return; }
    }
    throw new Error(`direction option ${label} not found`);
  };

  await pickDirection('Nhập khẩu');
  await sleep(600);
  const nhapKho = await fieldLabel(page, 'shipment-pickup-warehouse');
  const nhapFactory = await fieldLabel(page, 'shipment-operational-site');
  await shot(page, 'create-nhap-lcl');
  check('T01 Nhập khẩu labels', /Kho lấy hàng \(CFS\/Cảng\)/.test(nhapKho ?? '') && /Nhà máy \(Điểm trả hàng\)/.test(nhapFactory ?? ''),
    `kho="${nhapKho}" nhamay="${nhapFactory}"`);

  await pickDirection('Xuất khẩu');
  await sleep(600);
  const xuatKho = await fieldLabel(page, 'shipment-pickup-warehouse');
  const xuatFactory = await fieldLabel(page, 'shipment-operational-site');
  await shot(page, 'create-xuat-lcl');
  check('T01 Xuất khẩu labels', /Kho trả hàng \(CFS\/Cảng\)/.test(xuatKho ?? '') && /Nhà máy \(Điểm lấy hàng\)/.test(xuatFactory ?? ''),
    `kho="${xuatKho}" nhamay="${xuatFactory}"`);
  await page.close();
} catch (err) {
  check('T01 create-form drive', false, String(err));
}

// ── T02: detailed-plan Cảng nâng/hạ mapping (DISPATCHER) ────────────────────
try {
  const dvToken = await login(process.env.DISPATCH_USER ?? 'dungnv');
  const page = await openPage(dvToken, { width: 1440, height: 900 });
  await page.goto(`${FRONT}/dispatch-detail`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.detailed-plan-grid__row', { timeout: 25000 });
  await sleep(600);

  // Search each lot by ref and clear the default date scope (tab "Tất cả") so
  // the 24-26/10 lots surface regardless of the today preset.
  const scopeAll = async () => {
    const tabs = await page.$$('[role="tab"]');
    for (const tab of tabs) {
      if ((await tab.evaluate((n) => n.textContent ?? '')).includes('Tất cả')) { await tab.click(); return true; }
    }
    return false;
  };
  await scopeAll();
  await sleep(1000);

  const rowsOnPage = () => page.evaluate(() => Array.from(document.querySelectorAll('.detailed-plan-grid__row')).map((tr) => (tr.textContent ?? '').replace(/\s+/g, ' ').trim()));

  const findRowCells = (needle) => page.evaluate((text) => {
    const tr = Array.from(document.querySelectorAll('.detailed-plan-grid__row'))
      .find((n) => (n.textContent ?? '').includes(text));
    if (!tr) return null;
    const lift = tr.querySelector('td[data-label="Nâng hàng"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    const drop = tr.querySelector('td[data-label="Trả hàng"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    return { lift, drop };
  }, needle);

  // Each lot search runs on a FRESH page load — the FilterBar's debounced
  // controlled input does not reliably accept a replace-typed-over value.
  const searchFor = async (needle) => {
    await page.goto(`${FRONT}/dispatch-detail`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.detailed-plan-grid__row', { timeout: 25000 });
    await sleep(800);
    const input = await page.$('input[placeholder="Bill, Cont, Tờ khai..."]');
    if (!input) throw new Error('quick search input not found');
    await input.click();
    await input.type(needle, { delay: 30 });
    // Poll until the row for this needle renders (debounced server search).
    for (let i = 0; i < 12; i += 1) {
      await sleep(700);
      const found = await page.evaluate((text) => Array.from(document.querySelectorAll('.detailed-plan-grid__row'))
        .some((n) => (n.textContent ?? '').includes(text)), needle);
      if (found) return true;
    }
    return false;
  };

  const importFound = await searchFor('R41-LCL06-TEST');
  const importPts = await findRowCells('R41-LCL06-TEST');
  await shot(page, 'detail-import-lcl');
  check('T02 IMPORT·Lẻ lot visible', importFound, importFound ? 'row rendered' : 'row never rendered');
  check('T02 IMPORT·Lẻ mapping (Nâng=Kho CFS, Hạ=Nhà máy)',
    /\S+/.test(importPts?.lift ?? '') && importPts?.lift !== importPts?.drop && /ASKEY/i.test(importPts?.drop ?? ''),
    `Nâng="${importPts?.lift}" Hạ="${importPts?.drop}"`);

  const exportFound = await searchFor('R42RV-D2');
  const exportPts = await findRowCells('R42RV-D2');
  await shot(page, 'detail-export-lcl');
  check('T02 EXPORT·Lẻ lot visible', exportFound, exportFound ? 'row rendered' : 'row never rendered');
  check('T02 EXPORT·Lẻ mapping (Nâng=Nhà máy, Hạ=Kho CFS)',
    /SJ/.test(exportPts?.lift ?? '') && /GLC/.test(exportPts?.drop ?? ''),
    `Nâng="${exportPts?.lift}" Hạ="${exportPts?.drop}"`);
  log(`IMPORT ports: ${JSON.stringify(importPts)}`);
  log(`EXPORT ports: ${JSON.stringify(exportPts)}`);
  await page.close();
} catch (err) {
  check('T02 dispatch-detail drive', false, String(err));
}

await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures ? 1 : 0);
