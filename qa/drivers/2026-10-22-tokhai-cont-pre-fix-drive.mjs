// Card 261022095235b — PRE-FIX UI repro. LOCAL ONLY (7178 → 3005 worktree stack).
// Flow khách: lô NHẬP sai/thiếu cont → SỬA lô → thêm cont / đổi số cont.
// Captures: drawer add flow, workboard container-number edit flow, detail page affordances.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7178';
const API = `${BASE}/api`;
const OUT = 'qa/2026-10-22-cus-tokhai-cont';
const SHOTS = '/tmp/tokhai-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LOT_REF = process.env.LOT_REF; // e.g. HAGHTB298xxxxx
if (!LOT_REF) { console.error('need LOT_REF'); process.exit(1); }

let L = null;
for (let i = 0; i < 3 && !L?.token; i++) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) });
  try { L = await r.json(); } catch { }
  if (!L?.token) await sleep(1000);
}
if (!L?.token) { console.log('LOGIN FAILED'); process.exit(1); }
console.log('LOGIN OK cus');
const T = L.token;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), T);
const netLog = [];
page.on('response', async (res) => {
  const url = res.url();
  if (url.includes('/api/') && !url.includes('/api/auth/')) {
    const ok = res.status() < 400;
    if (!ok || /containers|shipments/.test(url)) {
      let body = '';
      if (!ok) { try { body = (await res.text()).slice(0, 300); } catch { } }
      netLog.push(`${res.request().method()} ${res.status()} ${url.replace(BASE, '')}${body ? ' :: ' + body : ''}`);
    }
  }
});
page.on('pageerror', (e) => netLog.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') netLog.push(`CONSOLE: ${m.text().slice(0, 200)}`); });
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false });

// ── Flow 1: /shipments → drawer Tổng quan → Thêm container ────────────────
await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 45000 });
await sleep(1200);
const search = await page.$('input[placeholder*="Tìm"], input[type="search"], input[aria-label*="Tìm"]');
if (search) {
  await search.click({ clickCount: 3 });
  await search.type(LOT_REF);
  await sleep(1500);
}
await shot('01-shipments-search');
const openBtn = await page.$(`::-p-xpath(//button[starts-with(@aria-label,'Mở chi tiết lô hàng')][contains(@aria-label,'${LOT_REF}')])`);
if (!openBtn) { console.log('FAIL: row/open button not found for', LOT_REF); await shot('01b-row-not-found'); }
else {
  await openBtn.click();
  await sleep(1800);
  await shot('02-drawer-open');
  const addBtn = await page.$('button::-p-text(Thêm container)');
  console.log('drawer add button present:', Boolean(addBtn));
  if (addBtn) {
    await addBtn.click();
    await sleep(700);
    await shot('03-add-row-open');
    // gõ số cont HỢP LỆ
    const numInput = await page.$('input[aria-label="Số container"]');
    await numInput.type('CSQU3054383');
    await sleep(400);
    await shot('04-add-row-filled');
    const submit = await page.$('.cus-container-ledger__add-row button::-p-text(Thêm)');
    await submit.click();
    await sleep(2200);
    await shot('05-add-result');
    const errEl = await page.$('.cus-container-ledger__add-error');
    const toast = await page.$('.toast, [role="status"]');
    console.log('ADD RESULT: addError =', errEl ? await page.evaluate((e) => e.textContent, errEl) : '(none)');
    console.log('ADD RESULT: toast =', toast ? (await page.evaluate((e) => e.textContent, toast)).slice(0, 160) : '(none)');
  }
}

// ── Flow 2: /shipments-detail workboard → đổi số cont dòng bẩn ────────────
await page.goto(`${BASE}/shipments-detail?searchSuffix=${LOT_REF}&dateScope=all`, { waitUntil: 'networkidle2', timeout: 45000 });
await sleep(1600);
await shot('06-workboard-search');
// click cell "Thông số container" của dòng chứa HAGU (số sai)
const cell = await page.$('::-p-xpath(//button[contains(@aria-label,"Chỉnh sửa ô thông số container")][contains(@aria-label,"HAGU")])')
  ?? await page.$('::-p-xpath(//button[contains(@aria-label,"Chỉnh sửa ô thông số container")][contains(@aria-label,"MSKU1234560")])');
if (!cell) {
  console.log('workboard: container cell trigger not found — maybe row filtered; dump row labels');
  const labels = await page.$$eval('[data-cell-label]', (els) => [...new Set(els.map((e) => e.getAttribute('data-cell-label')))]);
  console.log('cell labels on page:', labels);
} else {
  await cell.click();
  await sleep(1800);
  await shot('07-container-editor-open');
  const numField = await page.$('input[maxlength="20"]');
  if (numField) {
    await numField.click({ clickCount: 3 });
    await numField.type('MSKU1234565');
    await sleep(300);
    await shot('08-container-editor-filled');
    await page.keyboard.press('Enter');
    await sleep(2200);
    await shot('09-container-editor-result');
    const err = await page.$('.shipment-container-ledger__edit-error');
    console.log('CONTAINER EDIT RESULT: err =', err ? await page.evaluate((e) => e.textContent, err) : '(none — saved?)');
  } else console.log('workboard editor: number input not found');
}

// ── Flow 3: /shipments/:id detail page — affordance audit ─────────────────
const lots = await (await fetch(`${API}/shipments/cus-workspace?searchSuffix=${LOT_REF}`, { headers: { Authorization: `Bearer ${T}` } })).json();
const lotId = lots.items?.[0]?.id;
if (lotId) {
  await page.goto(`${BASE}/shipments/${lotId}`, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(1500);
  await shot('10-detail-page');
  const addBtn2 = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].map((b) => b.textContent.trim());
    return {
      hasAdd: btns.some((t) => t.includes('Thêm container')),
      hasRemove: btns.some((t) => t.includes('Xóa container')),
      containerSection: btns.filter((t) => /container/i.test(t)).slice(0, 8),
    };
  });
  console.log('DETAIL PAGE (/shipments/:id) affordances:', JSON.stringify(addBtn2));
}

fs.writeFileSync(`${OUT}/pre-fix-network-console.log`, netLog.join('\n') || '(no errors captured)');
fs.writeFileSync(`${SHOTS}/pre-fix-network-console.log`, netLog.join('\n') || '(no errors captured)');
console.log('\nNETWORK/CONSOLE captured lines:', netLog.length);
await browser.close();
console.log('PRE-FIX REPRO DRIVER DONE');
