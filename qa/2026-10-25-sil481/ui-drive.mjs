// SIL-481 UI drive — before (main checkout :7175, code 0e8cd190) vs after
// (this worktree :7176). House pattern: puppeteer-core + system Chrome +
// localStorage token injection BEFORE any SPA navigation.
// Usage: node ui-drive.mjs before|after
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const MODE = process.argv[2] ?? 'after';
const BASE = MODE === 'before' ? 'http://localhost:7175' : 'http://localhost:7176';
const API = 'http://localhost:3002/api';
const LOT = 300;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = 'qa/2026-10-25-sil481';

mkdirSync(DIR, { recursive: true });
const LOG = `${DIR}/ui-driver.log`;
const log = (line) => {
  const t = `${new Date().toISOString()} [${MODE}] ${line}`;
  console.log(t);
  appendFileSync(LOG, `${t}\n`);
};

const res = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
});
if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
const { token } = await res.json();
log(`login cus OK (token ${token.length} chars), BASE=${BASE}, lot=${LOT}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
});

async function drive(width, height, tag) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  // Token BEFORE the SPA boots — otherwise React Router bounces to /login.
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${BASE}/shipments/${LOT}`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('form.csc-workspace', { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));

  const state = await page.evaluate(() => {
    const h1 = document.querySelector('.csc-topline__title')?.textContent ?? null;
    const inputs = Array.from(document.querySelectorAll('form.csc-workspace input, form.csc-workspace textarea, form.csc-workspace select'));
    const buttons = Array.from(document.querySelectorAll('form.csc-workspace button'));
    const disabledInputs = inputs.filter((el) => el.disabled).length;
    const enabledInputs = inputs.filter((el) => !el.disabled).length;
    const enabledButtons = buttons.filter((el) => !el.disabled).length;
    const bill = document.querySelector('[data-field-id="shipment-booking-ref"] input');
    const hasProgressChip = Boolean(Array.from(document.querySelectorAll('.csc-topline__progress')).find((el) => el.textContent.includes('Bắt buộc')));
    const byName = (name) => Boolean(Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === name || b.getAttribute('aria-label') === name));
    return {
      path: location.pathname,
      h1,
      totalInputs: inputs.length,
      disabledInputs,
      enabledInputs,
      totalButtons: buttons.length,
      enabledButtons,
      billValue: bill instanceof HTMLInputElement ? bill.value : null,
      billDisabled: bill instanceof HTMLInputElement ? bill.disabled : null,
      hasProgressChip,
      btnCreate: byName('Tạo lô hàng'),
      btnDraft: byName('Lưu nháp'),
      btnEditTop: byName('Chuyển sang sửa'),
      btnBackTop: byName('Quay lại'),
      btnEditFooter: byName('Chuyển sang sửa (cuối trang)'),
      btnBackFooter: byName('Quay lại (cuối trang)'),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  log(`${tag} view-state ${JSON.stringify(state)}`);
  const shot = `${DIR}/${MODE}-${tag}.png`;
  await page.screenshot({ path: shot, fullPage: false });
  log(`shot ${shot}`);

  if (MODE === 'after' && tag === '1440') {
    // Click the real control: "Chuyển sang sửa" (topline) must land on the
    // SIL-171 edit form for the same lot.
    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Chuyển sang sửa');
      if (!btn) return false;
      btn.click();
      return true;
    });
    log(`click Chuyển sang sửa → ${clicked}`);
    await page.waitForFunction(() => location.pathname.endsWith('/edit'), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));
    const editState = await page.evaluate(() => ({
      path: location.pathname,
      h1: document.querySelector('.csc-topline__title')?.textContent ?? null,
      btnSave: Boolean(Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Lưu thay đổi'))),
    }));
    log(`after-edit ${JSON.stringify(editState)}`);
    const editShot = `${DIR}/${MODE}-1440-after-click-edit.png`;
    await page.screenshot({ path: editShot });
    log(`shot ${editShot}`);

    // Back to the review, then "Quay lại" must land on the lô list.
    await page.goto(`${BASE}/shipments/${LOT}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('form.csc-workspace', { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 800));
    const backClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Quay lại');
      if (!btn) return false;
      btn.click();
      return true;
    });
    log(`click Quay lại → ${backClicked}`);
    await page.waitForFunction(() => location.pathname === '/shipments', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1200));
    const backShot = `${DIR}/${MODE}-1440-after-click-back-list.png`;
    await page.screenshot({ path: backShot });
    log(`shot ${backShot} path=${await page.evaluate(() => location.pathname)}`);
  }

  if (errors.length) log(`console-errors: ${errors.slice(0, 5).join(' | ')}`);
  else log('console-errors: none');
  await page.close();
}

await drive(390, 844, '390');
await drive(768, 1024, '768');
await drive(1440, 900, '1440');

await browser.close();
log('done');
