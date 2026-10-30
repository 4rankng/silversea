// SIL-608 remainder — picker Loại cont UX — rung 3 probe + reproducer (§9).
// Regression context: testplan/cases/case-SIL-608-picker-loai-cont.md
// The LOẠI ghost line (SIL-552) floats its editor in a GroupFloatingLine
// card. Probe the REAL click flows against THIS worktree (fe :7177):
//   PICK-01: click the line trigger → is the options menu open? (the
//            drawer solved the same panel with a click-to-open listbox —
//            CusLotView "collapses to a bare caret" note.)
//   PICK-02: click the combobox input inside the card → menu opens?
//   PICK-03: type-to-filter still works (openOnType contract 20260921_1).
//   PICK-04: '+ Thêm' create option still reachable (TC-CUS-CREATE-020).
//   PICK-05: a real option click commits and closes the card.
// Artifacts: qa/2026-10-30_sil608_picker_ui-0{1..5}.png
//            qa/2026-10-30_sil608_picker_ui-driver.log
// Usage: node testplan/qa/scripts/qa-2026-10-30-sil608-picker-loai-cont.mjs
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require2 = createRequire(import.meta.dirname + '/../../../package.json');
const puppeteer = require2('puppeteer-core');

const BASE = process.env.QA_BASE || 'http://localhost:7177';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG_PATH = path.join(OUT, '2026-10-30_sil608_picker_ui-driver.log');

const LOG = [];
let exitCode = 0;
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const fail = (step, obj = {}) => { exitCode = 1; log(step, { verdict: 'FAIL', ...obj }); };
const ok = (step, obj = {}) => log(step, { verdict: 'PASS', ...obj });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const menuState = () => {
  // Measure the popover SCROLL BOX (the listbox's parentElement — the box
  // that carries overflow-y-auto and the max-height cap), never the raw
  // listbox: the listbox is content-sized and its rect legitimately extends
  // past the scroll lane (it is clipped, not painted past the viewport).
  const listbox = document.querySelector('[role="listbox"]');
  const pop = listbox?.parentElement;
  const rect = pop?.getBoundingClientRect();
  const card = document.querySelector('.csc-fline__card.is-open');
  const cardRect = card?.getBoundingClientRect();
  return {
    open: Boolean(listbox),
    options: listbox ? listbox.querySelectorAll('[role="option"]').length : 0,
    labels: listbox ? [...listbox.querySelectorAll('[role="option"]')].slice(0, 6).map((o) => o.textContent.trim()) : [],
    popoverRect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
    cardRect: cardRect ? { x: Math.round(cardRect.x), y: Math.round(cardRect.y), w: Math.round(cardRect.width), h: Math.round(cardRect.height) } : null,
    inViewport: rect ? rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth : false,
  };
};

(async () => {
  log('start', { base: BASE, api: API });
  let browser;
  try {
    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }),
    });
    const loginBody = await loginRes.json().catch(() => ({}));
    const token = loginBody.token ?? loginBody.data?.token ?? loginBody.accessToken;
    if (!token) { fail('login', { status: loginRes.status }); throw new Error('no token'); }
    ok('login', { status: loginRes.status });

    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--no-sandbox', '--window-size=1440,900'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', (err) => fail('pageerror', { message: String(err) }));
    await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);

    await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(1500);
    if (page.url().includes('/login')) { fail('auth-redirect', { url: page.url() }); throw new Error('redirected'); }
    await page.waitForSelector('.csc-form', { timeout: 30000 });
    ok('page-loaded');

    // PICK-01: the operator's report — bấm chọn loại cont.
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('Chỉnh sửa loại container — dòng 1')).click();
    });
    await sleep(600);
    const afterLineClick = await page.evaluate(menuState);
    log('PICK-01', { verdict: afterLineClick.open ? 'MENU-OPEN' : 'MENU-CLOSED', ...afterLineClick });
    if (!afterLineClick.open) fail('PICK-01-line-click-opens-menu', { afterLineClick });
    else ok('PICK-01-line-click-opens-menu');
    await page.screenshot({ path: path.join(OUT, '2026-10-30_sil608_picker_ui-01.png') });

    // PICK-02: click the combobox input itself (openOnPress).
    await page.evaluate(() => {
      const card = document.querySelector('.csc-fline__card.is-open');
      card.querySelector('[role="combobox"]').click();
    });
    await sleep(600);
    const afterInputClick = await page.evaluate(menuState);
    log('PICK-02', afterInputClick);
    if (!afterInputClick.open) fail('PICK-02-input-click-opens-menu', afterInputClick);
    else ok('PICK-02-input-click-opens-menu');
    if (afterInputClick.open && !afterInputClick.inViewport) fail('PICK-02-viewport', afterInputClick);
    await page.screenshot({ path: path.join(OUT, '2026-10-30_sil608_picker_ui-02.png') });

    // PICK-05: a real option click commits and closes the card (only if a
    // real type option exists; '+ Thêm' is probed separately below).
    const typeOption = await page.evaluate(() => {
      const listbox = document.querySelector('[role="listbox"]');
      const opt = [...(listbox?.querySelectorAll('[role="option"]') ?? [])].find((o) => !o.textContent.includes('+ Thêm'));
      if (opt) { opt.click(); return opt.textContent.trim(); }
      return null;
    });
    await sleep(700);
    if (typeOption) {
      const afterPick = await page.evaluate(() => ({
        cardOpen: Boolean(document.querySelector('.csc-fline__card.is-open')),
        triggerText: [...document.querySelectorAll('button')]
          .find((b) => (b.getAttribute('aria-label') ?? '').includes('Chỉnh sửa loại container — dòng 1'))
          ?.textContent.trim(),
      }));
      log('PICK-05', { picked: typeOption, ...afterPick });
      if (afterPick.cardOpen) fail('PICK-05-commit-closes-card', afterPick);
      else ok('PICK-05-commit-closes-card', { picked: typeOption, triggerText: afterPick.triggerText });
      await page.screenshot({ path: path.join(OUT, '2026-10-30_sil608_picker_ui-05.png') });
    } else {
      log('PICK-05', { verdict: 'SKIP', reason: 'no type option in catalog menu' });
      await page.keyboard.press('Escape');
      await sleep(300);
    }

    // Re-open the line for the remaining probes.
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('Chỉnh sửa loại container — dòng 1')).click();
    });
    await sleep(600);

    // PICK-03: type-to-filter (openOnType).
    await page.keyboard.type('2', { delay: 80 });
    await sleep(600);
    const afterType = await page.evaluate(menuState);
    log('PICK-03', afterType);
    if (!afterType.open) fail('PICK-03-typing-opens-filtered-menu', afterType);
    else ok('PICK-03-typing-opens-filtered-menu', { labels: afterType.labels });
    await page.screenshot({ path: path.join(OUT, '2026-10-30_sil608_picker_ui-03.png') });

    // PICK-04: '+ Thêm' reachable.
    const createVisible = await page.evaluate(() => {
      const listbox = document.querySelector('[role="listbox"]');
      const opt = [...(listbox?.querySelectorAll('[role="option"]') ?? [])].find((o) => o.textContent.includes('+ Thêm'));
      return Boolean(opt);
    });
    log('PICK-04', { createVisible });
    if (!createVisible) fail('PICK-04-create-option', { createVisible });
    else ok('PICK-04-create-option');
  } catch (err) {
    fail('fatal', { message: String(err) });
  } finally {
    await browser?.close();
  }

  fs.writeFileSync(LOG_PATH, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  log('done', { exitCode });
  process.exit(exitCode);
})();
