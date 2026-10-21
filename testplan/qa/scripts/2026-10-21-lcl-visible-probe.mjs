// Cards 211026130115/30215/30315/30415 (LCL-02..05) — visible-by-default probe.
// Runs the DESIRED behavior as checks on the form QA opens (default Nhập/FCL):
// before-fix the log shows FAIL (the defect), after-fix PASS (the fix).
// Usage: node testplan/qa/scripts/2026-10-21-lcl-visible-probe.mjs <prefix>
//   prefix = before | after  → screenshots/logs under qa/2026-10-21-lcl-visible/
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';

const PREFIX = process.argv[2] ?? 'before';
// The port contract (src/tests/dev-port-contract.test.ts) requires the shared
// 7175 literal here; a run against another local port passes QA_BASE explicitly.
const BASE = process.env.QA_BASE ?? 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const ART = 'qa/2026-10-21-lcl-visible';
const LOG = `${ART}/${PREFIX}-probe.log`;
mkdirSync(ART, { recursive: true });
const log = (line) => { const t = `${new Date().toISOString()} ${line}`; console.log(t); appendFileSync(LOG, `${t}\n`); };
appendFileSync(LOG, `\n=== ${PREFIX} run ${new Date().toISOString()} base=${BASE} ===\n`);

let failures = 0;
const check = (name, ok, detail = '') => { log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures += 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) });
const { token } = await login.json();
log(`login cus: ${token ? 'OK' : 'FAIL'}`);
if (!token) process.exit(1);

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('dialog', (d) => void d.accept());

// ---------- default form (Nhập khẩu/FCL) ----------
await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Tạo lô hàng')), { timeout: 30000 });
await sleep(800);
check('form renders (not login)', !(await page.evaluate(() => document.body.innerText.includes('Đăng nhập'))));

// Default direction select value — the "mặc định Nhập khẩu" surface.
const defaultDir = await page.evaluate(() => {
  const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'IMPORT'));
  return sel ? sel.value : null;
});
log(`default tradeDirection select value: ${JSON.stringify(defaultDir)}`);
await page.screenshot({ path: `${ART}/${PREFIX}-01-default-form.png`, fullPage: true });
log(`shot ${PREFIX}-01-default-form.png (form mặc định, full page)`);

// --- LCL-03 (30215): Hàng lẻ segmented control at the TOP of the form ---
const modeInfo = await page.evaluate(() => {
  const input = document.querySelector('input[name="cargo-mode"][value="LCL"]');
  const fieldset = input?.closest('fieldset') ?? null;
  const form = document.querySelector('.csc-form');
  const band = document.querySelector('#shipment-section-mode');
  return {
    found: Boolean(fieldset),
    legend: fieldset?.querySelector('legend')?.textContent?.trim() ?? null,
    bandExists: Boolean(band),
    bandIsFirstBlock: form?.firstElementChild === band,
    fieldsetInBand: Boolean(band && fieldset && band.contains(fieldset)),
    sectionTitle: fieldset?.closest('div[id], section')?.querySelector('h2')?.textContent?.trim() ?? null,
    html: fieldset?.outerHTML.slice(0, 400) ?? null,
  };
});
check('lcl-03 mode control (radio Hàng lẻ) sits at the TOP of the form', modeInfo.found && modeInfo.bandExists && modeInfo.bandIsFirstBlock && modeInfo.fieldsetInBand, JSON.stringify({ bandIsFirstBlock: modeInfo.bandIsFirstBlock, fieldsetInBand: modeInfo.fieldsetInBand }));

// --- LCL-04 (30315) on the default form: nothing yet (mode-scoped), record ---
const deliveryDefault = await page.evaluate(() => ({
  field: Boolean(document.getElementById('shipment-expected-delivery')),
  revealButtons: [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter((t) => /Thêm ngày giao|Ngày giao bổ sung/.test(t)),
}));
log(`default form: #shipment-expected-delivery=${deliveryDefault.field} revealButtons=${JSON.stringify(deliveryDefault.revealButtons)}`);

// ---------- switch to Hàng lẻ (one obvious click) ----------
const lclClicked = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.csc-mode__option, label, span')].find((e) => e.textContent?.trim() === 'Hàng lẻ');
  if (!el) return false;
  el.closest('label')?.querySelector('input')?.click() ?? el.click();
  return true;
});
check('lcl-03 "Hàng lẻ" option clickable', lclClicked);
await page.waitForFunction(() => document.body?.innerText.includes('Ngày giao hàng'), { timeout: 15000 }).catch(() => {});
await sleep(600);
const lclText = await page.evaluate(() => document.body.innerText);
check('lcl-03 "Lịch & ghi chú" drops away immediately on Hàng lẻ', !lclText.includes('Lịch & ghi chú') && !lclText.includes('Ghi chú cho khách hàng'));

// --- LCL-04 (30315): Ngày giao hàng open by default, no "+" reveal ---
const delivery = await page.evaluate(() => {
  const field = document.getElementById('shipment-expected-delivery');
  const revealButtons = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter((t) => /Thêm ngày giao|Ngày giao bổ sung/.test(t));
  return { field: Boolean(field), visible: Boolean(field && field.offsetParent !== null), revealButtons };
});
check('lcl-04 "Ngày giao hàng" visible immediately after mode switch (no reveal step)', delivery.field && delivery.visible, JSON.stringify(delivery));
check('lcl-04 no "+" reveal button for Ngày giao hàng', delivery.revealButtons.length === 0, JSON.stringify(delivery.revealButtons));
await page.screenshot({ path: `${ART}/${PREFIX}-02-lcl-form.png`, fullPage: true });
log(`shot ${PREFIX}-02-lcl-form.png (Hàng lẻ form)`);

// --- LCL-05 (30415): quy cách combobox hint + suggestions from the start ---
const pkg = await page.evaluate(() => {
  const combo = [...document.querySelectorAll('input')].find((i) => (i.getAttribute('placeholder') ?? '').toLowerCase().includes('quy cách') || i.closest('[data-field-id="shipment-package-type"]'));
  return { found: Boolean(combo), placeholder: combo?.getAttribute('placeholder') ?? null };
});
check('lcl-05 quy cách placeholder hint "Gợi ý quy cách (chọn hoặc gõ)"', pkg.found && pkg.placeholder === 'Gợi ý quy cách (chọn hoặc gõ)', `placeholder=${JSON.stringify(pkg.placeholder)}`);
if (pkg.found) {
  const comboEl = await page.evaluateHandle(() => [...document.querySelectorAll('input')].find((i) => (i.getAttribute('placeholder') ?? '').toLowerCase().includes('quy cách') || i.closest('[data-field-id="shipment-package-type"]')));
  // User-like interaction: the field settles into view BEFORE the click — an
  // instant scroll-into-view racing the open is overlay scroll-dismissal
  // (same for every picker in the app), not the field's open contract.
  await page.evaluate(() => {
    [...document.querySelectorAll('input')].find((i) => (i.getAttribute('placeholder') ?? '').toLowerCase().includes('quy cách') || i.closest('[data-field-id="shipment-package-type"]'))
      ?.scrollIntoView({ block: 'center' });
  });
  await sleep(600);
  await (comboEl.asElement()).click();
  await sleep(800);
  const optsBare = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim()).filter(Boolean));
  check('lcl-05 dropdown opens with suggestions WITHOUT typing', optsBare.length >= 5, JSON.stringify(optsBare.slice(0, 12)));
  await page.screenshot({ path: `${ART}/${PREFIX}-03-packaging-dropdown.png` });
  log(`shot ${PREFIX}-03-packaging-dropdown.png`);
  await page.keyboard.press('Escape');
}

// ---------- LCL-02 (30115): Thêm kho quick-add ----------
// (a) BEFORE choosing a customer: the affordance must exist and open.
const preCustomer = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter((t) => t.includes('Thêm kho'));
  return buttons;
});
check('lcl-02 "Thêm kho" affordance visible BEFORE choosing a customer', preCustomer.length > 0, JSON.stringify(preCustomer));
if (preCustomer.length > 0) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim().includes('Thêm kho'));
    b?.click();
  });
  await sleep(800);
  const dlg = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return {
      open: Boolean(dialog),
      title: dialog?.querySelector('h1,h2,h3,[class*="title"]')?.textContent?.trim() ?? null,
      labels: [...(dialog ?? document).querySelectorAll('label')].map((l) => l.textContent?.trim()).filter(Boolean).slice(0, 10),
    };
  });
  check('lcl-02 dialog opens before choosing KH (Nhập default → title "Thêm kho lấy hàng")', dlg.open && (dlg.title ?? '').includes('Thêm kho lấy hàng') && dlg.labels.some((l) => l?.includes('Khách hàng')), JSON.stringify(dlg));
  await page.screenshot({ path: `${ART}/${PREFIX}-04-them-kho-before-customer.png` });
  log(`shot ${PREFIX}-04-them-kho-before-customer.png`);
  await page.keyboard.press('Escape');
  await sleep(400);
}

// (b) with a customer: quick-add body + direction-following title (EXPORT probe).
const custInput = await page.evaluateHandle(() => {
  const label = [...document.querySelectorAll('label')].find((l) => (l.textContent || '').trim().startsWith('Khách hàng'));
  const scope = label?.closest('div') ?? document;
  return scope.querySelector('input[role="combobox"], input');
});
const custEl = custInput.asElement();
if (custEl) {
  await custEl.type('LONG', { delay: 40 });
  await sleep(1200);
  const firstOpt = await page.evaluateHandle(() => [...document.querySelectorAll('[role="option"]')].find((o) => o.offsetParent != null));
  if (firstOpt.asElement()) { await firstOpt.asElement().click(); log('picked first customer option'); }
  await sleep(1200);
}
const withCustomer = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter((t) => t.includes('Thêm kho')));
check('lcl-02 "Thêm kho" present with customer', withCustomer.length > 0, JSON.stringify(withCustomer));

// EXPORT direction → title must be "Thêm kho trả hàng".
const dirSel = await page.evaluateHandle(() => [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'EXPORT')));
if (dirSel.asElement()) {
  await dirSel.asElement().select('EXPORT');
  await sleep(600);
}
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim().includes('Thêm kho'));
  b?.click();
});
await sleep(800);
const exportDlg = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  return {
    open: Boolean(dialog),
    title: dialog?.querySelector('h1,h2,h3,[class*="title"]')?.textContent?.trim() ?? null,
    labels: [...(dialog ?? document).querySelectorAll('label')].map((l) => l.textContent?.trim()).filter(Boolean).slice(0, 10),
    heavy: /Google Maps|Mã điểm/.test(dialog?.textContent ?? ''),
  };
});
check('lcl-02 EXPORT → dialog title "Thêm kho trả hàng"', exportDlg.open && (exportDlg.title ?? '').includes('Thêm kho trả hàng'), JSON.stringify(exportDlg));
check('lcl-02 quick-add body stays simple (Tên đầy đủ/Tên ngắn/Địa chỉ)', ['Tên đầy đủ', 'Tên ngắn', 'Địa chỉ'].every((f) => exportDlg.labels.some((l) => l?.includes(f))) && !exportDlg.heavy, JSON.stringify(exportDlg.labels));
writeFileSync(`${ART}/${PREFIX}-dom-them-kho.json`, JSON.stringify({ modeInfo, deliveryDefault, delivery, pkg, preCustomer, exportDlg }, null, 2));
await page.screenshot({ path: `${ART}/${PREFIX}-05-them-kho-export.png` });
log(`shot ${PREFIX}-05-them-kho-export.png`);
await page.keyboard.press('Escape');

await browser.close();
log(`PROBE ${PREFIX} DONE — failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
