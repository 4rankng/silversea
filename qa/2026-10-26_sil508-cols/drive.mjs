/**
 * SIL-508 UI drive — Thông tin hàng sheet: SỐ CONTAINER 3-line group
 * (SỐ/LOẠI/TRỌNG LƯỢNG click-to-edit), SỐ TỜ KHAI 11ch, no horizontal
 * scroll at 1440/1280.
 *
 * Logs in as the local CUS demo account (testplan/testaccounts.txt; admin
 * fallback), injects the JWT BEFORE any page load (puppeteer-spa-auth law),
 * opens the first lot drawer on /shipments and captures:
 *   - full-page screenshots at 1440 + 1280 (drawer open at the cargo card),
 *   - header-list + group-cell DOM assertions (10 columns, 3 ghost lines),
 *   - horizontal-scroll geometry (AC: none at standard viewports),
 *   - a real click-to-edit on the TRỌNG LƯỢNG line: editor → Enter →
 *     container-line POST → detail reload → persisted value read back from
 *     the API (side-effect proof), then RESTORED to the original value.
 *
 * Usage: node qa/2026-10-26_sil508-cols/drive.mjs <baseUrl> <tag>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:7176';
const TAG = process.argv[3] ?? 'after';
const API = 'http://localhost:3002/api';
const OUT = 'qa/2026-10-26_sil508-cols';
const WIDTHS = (process.env.WIDTHS ?? '1440,1280').split(',').map(Number);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function tryLogin(username) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: 'Abc123' }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.token ?? null;
}

let token = await tryLogin('cus');
let account = 'cus';
if (!token) { token = await tryLogin('admin'); account = 'admin'; }
if (!token) throw new Error('login failed for cus and admin');
console.log(`logged in as ${account}`);

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const report = { base: BASE, tag: TAG, account, widths: {}, edit: null };
const containerResponses = [];

try {
  const page = await browser.newPage();
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/cus-workspace/') && url.includes('/containers/')) {
      containerResponses.push({ status: res.status(), url: url.replace(BASE, ''), method: res.request().method() });
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle0', timeout: 45000 });
    await page.waitForSelector('table', { timeout: 30000 });
    await page.waitForSelector('button[aria-label*="Mở chi tiết lô hàng"]', { timeout: 30000 });
    const buttons = await page.$$('button[aria-label*="Mở chi tiết lô hàng"]');
    await buttons[0].click();
    await page.waitForSelector('.cus-lot-table', { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1200)); // drawer slide-in + detail settle

    const assertions = await page.evaluate(() => {
      const headers = [...document.querySelectorAll('.cus-lot-table thead th')].map((th) => th.textContent.trim());
      const table = document.querySelector('.cus-lot-table-scroll');
      const group = document.querySelector('.cus-lot-contgroup');
      const groupLines = group ? [...group.querySelectorAll('.cus-lot-line')].map((line) => line.textContent.trim()) : [];
      const declInput = document.querySelector('.cus-lot-decl__input');
      const drawer = document.querySelector('[id^="cus-detail-drawer-"]');
      return {
        headers,
        headerCount: headers.length,
        hasRetiredHeaders: headers.includes('Loại') || headers.includes('Trọng lượng'),
        groupLines,
        tableScroll: table ? { scrollWidth: table.scrollWidth, clientWidth: table.clientWidth, overflowsX: table.scrollWidth > table.clientWidth } : null,
        drawerScroll: drawer ? { scrollWidth: drawer.scrollWidth, clientWidth: drawer.clientWidth, overflowsX: drawer.scrollWidth > drawer.clientWidth } : null,
        pageScroll: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, overflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth },
        declInputWidthPx: declInput ? declInput.getBoundingClientRect().width : null,
        firstWeightTrigger: (() => {
          const triggers = [...document.querySelectorAll('.cus-lot-contgroup button')];
          const weight = triggers.find((b) => b.getAttribute('aria-label')?.startsWith('Trọng lượng'));
          return weight ? weight.getAttribute('aria-label') : null;
        })(),
      };
    });
    report.widths[width] = assertions;

    // Screenshot: scroll the cargo card into view inside the drawer body.
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('.cus-lot-card')].find((el) => el.textContent.includes('Thông tin hàng'));
      card?.scrollIntoView({ block: 'start' });
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: `${OUT}/sil508_${TAG}_${width}_drawer-cargo.png`, fullPage: false });
  }

  // The click-to-edit drive only makes sense on a standard width run.
  if (TAG !== 'narrow') {
  // ── Click-to-edit drive (1440 viewport still set) ──
  // TRỌNG LƯỢNG line of the OPEN drawer's first row: remember the persisted
  // raw value, edit it, Enter-commit, prove the POST + reload + persisted
  // read-back, then RESTORE the original value.
  const drawerId = await page.evaluate(() => {
    const el = document.querySelector('[id^="cus-detail-drawer-"]');
    return el ? Number(el.id.replace('cus-detail-drawer-', '')) : null;
  });
  if (drawerId == null) throw new Error('drawer not open');
  const original = await page.evaluate(async (shipmentId) => {
    const res = await fetch(`/api/shipments/cus-workspace/${shipmentId}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const detail = await res.json();
    const line = (detail.containers ?? [])[0];
    return line ? { shipmentId: detail.summary.id, containerId: line.id, ordinal: line.ordinal, weight: line.raw.cargoWeightKg, version: detail.summary.version, fieldAccessMode: line.fieldAccess?.cargoWeightKg?.mode ?? null } : null;
  }, drawerId);
  if (!original) throw new Error(`lot ${drawerId} has no container line`);
  if (original.fieldAccessMode !== 'DIRECT') {
    report.edit = { skipped: true, reason: `fieldAccess.cargoWeightKg=${original.fieldAccessMode} for ${account}` };
    console.log(`EDIT SKIPPED: fieldAccess=${original.fieldAccessMode}`);
  } else {
    const nextWeight = '13579';
    await page.bringToFront();
    // The drawer may have closed on the navigation of the width loop — reopen.
    const open = await page.$('.cus-lot-table');
    if (!open) {
      await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle0', timeout: 45000 });
      await page.waitForSelector('button[aria-label*="Mở chi tiết lô hàng"]', { timeout: 30000 });
      const buttons = await page.$$('button[aria-label*="Mở chi tiết lô hàng"]');
      await buttons[0].click();
      await page.waitForSelector('.cus-lot-table', { timeout: 20000 });
      await new Promise((r) => setTimeout(r, 1000));
    }
    const triggerLabel = `Trọng lượng — dòng ${original.ordinal}`;
    await page.waitForFunction((label) => {
      return [...document.querySelectorAll('.cus-lot-contgroup button')].some((b) => b.getAttribute('aria-label') === label);
    }, { timeout: 15000 }, triggerLabel);

    await page.evaluate((label) => {
      const trigger = [...document.querySelectorAll('.cus-lot-contgroup button')].find((b) => b.getAttribute('aria-label') === label);
      trigger.click();
    }, triggerLabel);
    await page.waitForSelector('.cus-lot-line--editor input', { timeout: 5000 });
    await page.screenshot({ path: `${OUT}/sil508_${TAG}_edit-open.png`, fullPage: false });

    await page.evaluate((label) => {
      const input = document.querySelector(`.cus-lot-line--editor input[aria-label="${label}"]`);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '13579');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, triggerLabel);
    await page.keyboard.press('Enter');

    // Wait for the save POST + the forced detail reload.
    await page.waitForFunction(() => {
      return [...document.querySelectorAll('body *')].some((el) => el.children.length === 0 && /Đã lưu trọng lượng/.test(el.textContent ?? ''));
    }, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: `${OUT}/sil508_${TAG}_edit-saved.png`, fullPage: false });

    const postSave = await page.evaluate(async (shipmentId) => {
      const res = await fetch(`/api/shipments/cus-workspace/${shipmentId}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const detail = await res.json();
      return { weight: detail.containers?.[0]?.raw?.cargoWeightKg ?? null, notice: document.body.textContent.includes('Đã lưu trọng lượng') };
    }, drawerId);
    report.edit = {
      original: original.weight, sent: nextWeight,
      apiResponses: containerResponses,
      persistedAfterSave: postSave.weight,
      toastSeen: postSave.notice,
      persistedMatch: postSave.weight === '13579.00',
    };
    console.log(`EDIT: ${original.weight} -> ${postSave.weight} (toast=${postSave.notice}) responses=${JSON.stringify(containerResponses)}`);

    // Restore the original value so local data stays as found.
    const restoreKey = `restore-${Date.now()}`;
    const restore = await fetch(`${API}/shipments/cus-workspace/${original.shipmentId}/containers/${original.containerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': restoreKey },
      body: JSON.stringify({ expectedShipmentVersion: (await (await fetch(`${API}/shipments/cus-workspace/${original.shipmentId}`, { headers: { Authorization: `Bearer ${token}` } })).json()).summary.version, cargoWeightKg: original.weight }),
    });
    report.restore = { status: restore.status, value: original.weight };
    console.log(`RESTORE: ${restore.status}`);
  }
  } // end TAG !== 'narrow'

  writeFileSync(`${OUT}/sil508_${TAG}_report.json`, JSON.stringify(report, null, 2));
  console.log('REPORT WRITTEN');
} finally {
  await browser.close();
}
