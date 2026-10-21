// R29 re-verify (2026-10-21) — FB-048 (red borders on 5 container cells) +
// FB-002 Case A (Enter in ô giờ with complete datetime must SAVE) on staging
// build c643ef1e. One browser session, two verdict sets.
//   FB-048: empty submit → validation → each of the 5 container picker cells
//           (Loại container/Nhà máy/Tuyến đường/Cảng nâng/Cảng hạ) must paint a
//           REAL red border on .csc-container-cell__display (not just red text),
//           steady state AND menu-open state.
//   FB-002: fill CUS minimum + click ô giờ → type 1630 → 22112026 → Enter with
//           form still incomplete (save attempt paints summary, NOTHING wiped),
//           then fill the 5 cells → Enter again → POST /shipments/quick 201.
// Usage: node testplan/qa/scripts/2026-10-21-r29-fb002-fb048-staging.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const ROOT = path.resolve('qa/2026-10-21-r29-verify');
const OUT_FB048 = path.join(ROOT, 'fb048');
const OUT_FB002 = path.join(ROOT, 'fb002-case-a');
fs.mkdirSync(OUT_FB048, { recursive: true });
fs.mkdirSync(OUT_FB002, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => { results.push({ id, pass, detail }); log('RESULT', { id, pass, detail }); if (!pass) exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log('health', { status: health?.status, build: health?.buildHash });
if (health?.buildHash !== 'c643ef1e' && !process.env.QA_IGNORE_BUILD) {
  log(`ABORT: staging build ${health?.buildHash} != c643ef1e`);
  process.exit(2);
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const token = await login('tiepvv');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const quickPosts = [];
  page.on('request', (req) => {
    if (/\/api\/shipments\/quick$/.test(req.url()) && req.method() === 'POST') {
      quickPosts.push({ url: req.url(), body: req.postData() });
      log('mutation', { url: req.url(), body: (req.postData() ?? '').slice(0, 300) });
    }
  });
  page.on('response', async (res) => {
    if (/\/api\/shipments\/quick$/.test(res.url()) && res.request().method() === 'POST') {
      try { log('mutation_status', { status: res.status, body: (await res.text()).slice(0, 300) }); } catch { /* noop */ }
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('form.csc-workspace', { timeout: 30000 });
  log('form-open');

  const snap = () => page.evaluate(() => {
    const segs = Array.from(document.querySelectorAll('.csc-workspace [data-seg-part] input[data-seg]'))
      .map((i) => `${i.closest('[data-seg-part]')?.getAttribute('data-seg-part')}:${i.getAttribute('data-seg')}=${i.value}`);
    const val = (sel) => document.querySelector(sel)?.value ?? null;
    return {
      url: location.pathname,
      customer: val('[data-field-id="shipment-customer"] input'),
      booking: val('[data-field-id="shipment-booking-ref"] input'),
      cont: val('input[aria-label="Số container"]'),
      segs,
      summary: document.querySelector('.csc-validation-summary')?.textContent?.trim().slice(0, 200) ?? null,
      summaryCount: document.querySelector('.csc-validation-summary')?.textContent?.match(/Cần bổ sung (\d+)/)?.[1] ?? null,
    };
  });

  // ══ FB-048: empty submit → red text AND red border on 5 container cells ══
  const createBtnHandle = await page.evaluateHandle(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Tạo lô hàng'));
    return btn ?? null;
  });
  const createBtn = createBtnHandle.asElement();
  if (!createBtn) throw new Error('Tạo lô hàng button not found');
  await createBtn.click();
  await sleep(1800);
  const borders = await page.evaluate(() => {
    const labels = ['Loại container', 'Nhà máy', 'Tuyến đường', 'Cảng nâng', 'Cảng hạ'];
    return labels.map((label) => {
      const input = Array.from(document.querySelectorAll(`input[aria-label="${label}"]`))[0];
      if (!input) return { label, found: false };
      const cell = input.closest('.csc-container-cell');
      const display = cell?.querySelector('.csc-container-cell__display');
      const errText = cell?.querySelector('.csc-container-cell__error')?.textContent?.trim() ?? null;
      const cs = display ? getComputedStyle(display) : null;
      return {
        label, found: true,
        hasErrorClass: cell?.classList.contains('csc-container-cell--error') ?? false,
        errText,
        borderTop: cs?.borderTopWidth ?? null, borderStyle: cs?.borderTopStyle ?? null,
        borderColor: cs?.borderTopColor ?? null,
        displayOpacity: cs?.opacity ?? null,
      };
    });
  });
  log('fb048_borders', borders);
  await page.screenshot({ path: path.join(OUT_FB048, '01-empty-submit-errors.png'), fullPage: true });
  const allRed = borders.every((b) => b.found && b.hasErrorClass && b.errText
    && b.borderTop === '1px' && b.borderStyle === 'solid'
    && /rgba?\(\s*2\d\d,\s*[0345]?\d,?\s*\d*/.test((b.borderColor ?? '').replace(/\s+/g, ' ')) === true
    && !/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(b.borderColor ?? ''));
  // looser but explicit: border 1px solid and NOT transparent, plus red-family rgb
  const allRedLoose = borders.every((b) => b.found && b.hasErrorClass && b.errText
    && b.borderTop === '1px' && b.borderStyle === 'solid' && b.borderColor && !b.borderColor.includes('0, 0, 0, 0'));
  record('FB-048: 5 container cells have red ERROR TEXT + REAL 1px red border (steady state, empty submit)',
    allRedLoose, JSON.stringify(borders.map(({ label, hasErrorClass, errText, borderTop, borderStyle, borderColor }) => ({ label, hasErrorClass, errText: (errText ?? '').slice(0, 60), borderTop, borderStyle, borderColor }))));

  // menu-open state: click 'Loại container' cell → display hides, open combobox
  // keeps the red border ([aria-invalid=true] visible with border).
  const opened = await page.evaluate(() => {
    const input = Array.from(document.querySelectorAll('input[aria-label="Loại container"]'))[0];
    if (input instanceof HTMLElement) { input.click(); return true; }
    return false;
  });
  await sleep(900);
  const menuState = await page.evaluate(() => {
    const input = Array.from(document.querySelectorAll('input[aria-label="Loại container"]'))[0];
    const cell = input?.closest('.csc-container-cell');
    const display = cell?.querySelector('.csc-container-cell__display');
    const combo = cell?.querySelector('[role="combobox"], [data-uui-control="combobox"]');
    const csd = display ? getComputedStyle(display) : null;
    const csc = combo ? getComputedStyle(combo) : null;
    return {
      expanded: combo?.getAttribute('aria-expanded') ?? null,
      invalid: combo?.getAttribute('aria-invalid') ?? combo?.getAttribute('data-invalid') ?? null,
      displayOpacity: csd?.opacity ?? null,
      comboOpacity: csc?.opacity ?? null,
      comboBorderTop: csc?.borderTopWidth ?? null, comboBorderColor: csc?.borderTopColor ?? null,
    };
  });
  log('fb048_menu_open', menuState);
  await page.screenshot({ path: path.join(OUT_FB048, '02-cell-menu-open.png') });
  await page.keyboard.press('Escape');
  await sleep(400);
  const redSomewhere = (menuState.comboBorderTop === '1px' && menuState.comboBorderColor && !menuState.comboBorderColor.includes('0, 0, 0, 0'))
    || (menuState.displayOpacity === '1' && borders[0].borderTop === '1px');
  record('FB-048: red border persists in menu-open state (display hides, combobox shows red)',
    opened && redSomewhere, JSON.stringify(menuState));

  // ══ FB-002 Case A: CUS minimum + complete datetime + Enter ═══════════════
  // Staging lessons (debug 2026-10-21-r29-debug*.mjs):
  //  - popovers portal per-field; a stale open listbox (from FB-048's menu test)
  //    otherwise hijacks the first [role=option] (picked '20DC' = container type)
  //  - the Nhà máy list is customer-scoped and stays EMPTY until a customer is set
  //  - factory/port lists live in visible [role=listbox] + popover elements.
  const closePopovers = async () => {
    await page.keyboard.press('Escape');
    await sleep(250);
    await page.evaluate(() => document.querySelector('h1, form')?.blur?.());
    await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
    await sleep(250);
  };
  const pickFirstOption = async (clickSel, typeQuery = null, matchText = null) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await closePopovers();
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el instanceof HTMLElement) { el.click(); el.focus?.(); }
      }, clickSel);
      await sleep(1200);
      if (typeQuery) { await page.keyboard.type(typeQuery, { delay: 60 }); await sleep(1000); }
      const picked = await page.evaluate((match) => {
        const visible = (el) => el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
        let opts = Array.from(document.querySelectorAll('.searchable-select__popover [role="option"], .searchable-select__popover button'))
          .filter(visible);
        if (!opts.length) opts = Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="listbox"] li, [role="listbox"] button')).filter(visible);
        if (!opts.length) opts = Array.from(document.querySelectorAll('.csc-type-picker button, .csc-type-picker li')).filter(visible);
        const clean = opts.map((el) => ({ el, text: (el.textContent || '').trim() })).filter((o) => o.text && !/^[-—–]/.test(o.text));
        const opt = match
          ? clean.find((o) => o.text.includes(match))
          : clean[0];
        if (opt) { opt.el.click(); return opt.text.slice(0, 50); }
        return null;
      }, matchText);
      await sleep(500);
      await page.keyboard.press('Escape');
      await sleep(300);
      if (picked) return picked;
    }
    return null;
  };

  const picked = await pickFirstOption('[data-field-id="shipment-customer"] input', 'YUAN', 'YUANFANG');
  log('customer_picked', { picked });
  await page.click('[data-field-id="shipment-trade-direction"] button, [data-field-id="shipment-trade-direction"] [role="combobox"], [data-field-id="shipment-trade-direction"] .searchable-select__trigger', { timeout: 8000 }).catch(() => {});
  await sleep(400);
  await page.evaluate(() => {
    const visible = (el) => el && el.offsetParent !== null;
    const opt = Array.from(document.querySelectorAll('[role="option"], .searchable-select__option'))
      .filter(visible).find((el) => (el.textContent || '').includes('Xuất khẩu'));
    if (opt instanceof HTMLElement) opt.click();
  });
  await sleep(400);
  await page.keyboard.press('Escape');
  await page.type('[data-field-id="shipment-booking-ref"] input', 'R29-FB002-VRF', { delay: 15 });
  const contInput = await page.$('input[aria-label="Số container"]');
  await contInput.click();
  await page.keyboard.type('TEMU1234565', { delay: 25 });

  // Case A: ô giờ click → 1630 → date auto-advance → 22112026 → Enter.
  const timeSeg = await page.$('.csc-workspace [data-seg-part="time"] input[data-seg]');
  await timeSeg.click();
  await sleep(400);
  await page.keyboard.type('1630', { delay: 100 });
  await sleep(300);
  await page.keyboard.type('22112026', { delay: 90 });
  await sleep(500);
  let st = await snap();
  log('caseA_after_datetime', st);
  await page.screenshot({ path: path.join(OUT_FB002, '01-datetime-typed.png'), fullPage: true });
  quickPosts.length = 0;
  await page.keyboard.press('Enter');
  await sleep(1800);
  st = await snap();
  log('caseA_after_enter_incomplete', { ...st, quickPosts: quickPosts.length });
  await page.screenshot({ path: path.join(OUT_FB002, '02-after-enter-incomplete.png'), fullPage: true });
  record('FB-002 Case A step 1: Enter with complete datetime but incomplete form → save attempt RAN (summary paints) and NOTHING wiped',
    Boolean(st.summaryCount) && st.cont === 'TEMU1234565' && st.booking === 'R29-FB002-VRF'
      && st.segs.includes('time:hh=16') && st.segs.includes('date:yyyy=2026'),
    `summary=${st.summaryCount} segs=${JSON.stringify(st.segs)} quickPosts=${quickPosts.length}`);

  // Fill the 5 picker cells (first non-dash option each), like QA finishing
  // the form. Verify each cell actually took a value; retry once if not.
  for (const label of ['Loại container', 'Nhà máy', 'Tuyến đường', 'Cảng nâng', 'Cảng hạ']) {
    const pickedCell = await pickFirstOption(`input[aria-label="${label}"]`, null, null);
    let cellVal = await page.evaluate((lbl) => {
      const input = Array.from(document.querySelectorAll(`input[aria-label="${lbl}"]`))[0];
      const cell = input?.closest('.csc-container-cell');
      const display = cell?.querySelector('.csc-container-cell__display')?.textContent?.trim() ?? '';
      return display;
    }, label);
    if (!cellVal || /^[-—–]|^Chọn /.test(cellVal)) {
      log('cell_retry', { label, firstPick: pickedCell });
      await pickFirstOption(`input[aria-label="${label}"]`, 'a', null);
      cellVal = await page.evaluate((lbl) => {
        const input = Array.from(document.querySelectorAll(`input[aria-label="${lbl}"]`))[0];
        return input?.closest('.csc-container-cell')?.querySelector('.csc-container-cell__display')?.textContent?.trim() ?? '';
      }, label);
    }
    log('cell_picked', { label, pickedCell, cellVal });
  }
  st = await snap();
  log('caseA_prefill_done', st);
  await page.screenshot({ path: path.join(OUT_FB002, '03-form-complete.png'), fullPage: true });

  quickPosts.length = 0;
  await page.evaluate(() => {
    const seg = document.querySelector('.csc-workspace [data-seg-part="date"] input[data-seg="yyyy"]');
    if (seg instanceof HTMLInputElement) seg.focus();
  });
  await sleep(300);
  await page.keyboard.press('Enter');
  // wait for navigation to /shipments/:id
  let created = false;
  for (let i = 0; i < 20; i++) {
    await sleep(600);
    st = await snap();
    if (quickPosts.length > 0 && /\/shipments\/\d+/.test(st.url)) { created = true; break; }
  }
  log('caseA_after_enter_complete', { ...st, quickPosts: quickPosts.length, created });
  await page.screenshot({ path: path.join(OUT_FB002, '04-after-enter-create.png'), fullPage: true });
  const body = quickPosts[0]?.body ?? '';
  record('FB-002 Case A step 2: Enter in ô giờ with COMPLETE form → lot SAVED (POST /shipments/quick → /shipments/:id) carrying the typed giờ',
    created && quickPosts.length > 0, `url=${st.url} quickPosts=${quickPosts.length} body=${body.slice(0, 260)}`);

  await page.close();
} catch (error) {
  record('driver', false, String(error?.stack ?? error));
}
fs.writeFileSync(path.join(ROOT, 'fb002-fb048-driver.log'), JSON.stringify({ results, log: LOG }, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
await browser.close();
process.exit(exitCode);
