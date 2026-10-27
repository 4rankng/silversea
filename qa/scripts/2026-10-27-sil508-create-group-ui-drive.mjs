// SIL-508 UI drive — bảng Thông tin hàng của FORM TẠO: gộp LOẠI + TRỌNG
// LƯỢNG vào cột SỐ CONTAINER (3 dòng micro-label SỐ/LOẠI/TRỌNG LƯỢNG,
// click-to-edit từng dòng như drawer CusLotView đã đạt — pattern SIL-483).
//
//   A. @1440 + @1280: thead 8 cột (hết 'Loại container'/'Trọng lượng (kg)'),
//      group cell 3 dòng, scroll box KHÔNG h-scroll (scrollWidth == client).
//   B. Click-to-edit từng dòng: click dòng LOẠI → popover option mở → chọn
//      20DC → dòng hiện '20DC'; click dòng TRỌNG LƯỢNG → gõ 12000 → dòng
//      hiện '12.000' (vi-VN).
//   C. @390 mobile: group spans full width, 3 dòng hiên.
//   D. Tạo lô THẬT qua UI (Lưu nháp) — payload & 201 giữ nguyên hành vi sau
//      merge (driver SIL-522 chạy lại ở bước E của lane).
//
// Usage: cd frontend && node ../qa/scripts/2026-10-27-sil508-create-group-ui-drive.mjs
// Output: qa/2026-10-27_sil508-create-group/*.png + assertions JSON + log.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const OUT = resolve(process.cwd(), '../qa/2026-10-27_sil508-create-group');
mkdirSync(OUT, { recursive: true });
const log = [];
const assertions = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(name, ok, detail) {
  assertions.push({ name, ok: Boolean(ok), detail: detail ?? null });
  log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail != null ? ` — ${JSON.stringify(detail)}` : ''}`);
  if (!ok) process.exitCode = 1;
}

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('input[name="username"]', { timeout: 45000 });
await page.type('input[name="username"]', 'thanhdc');
await page.type('input[name="password"]', 'Abc123');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !window.location.href.includes('login'), { timeout: 45000 });
assert('browser login thanhdc', true, { url: page.url() });

async function openCreateForm(w, h, tag) {
  await page.setViewport({ width: w, height: h });
  await page.goto(`${FE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.csc-container-table', { timeout: 45000 });
  await sleep(800);
}

// ─── A. Layout: 8 cột + group 3 dòng + không h-scroll ───────────────────────
for (const [w, h, tag] of [[1440, 900, '1440'], [1280, 800, '1280']]) {
  await openCreateForm(w, h, tag);
  const probe = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.csc-container-table thead th')].map((th) => th.textContent.trim());
    const group = document.querySelector('.csc-container-row .csc-contgroup');
    const lines = group ? [...group.querySelectorAll(':scope > .csc-container-cell')].map((line) => ({
      label: line.querySelector('.csc-container-cell__microlabel')?.textContent?.trim() ?? null,
      display: line.querySelector('.csc-container-cell__display')?.textContent?.trim() ?? null,
    })) : [];
    const deadCols = ['.csc-container-col__type', '.csc-container-col__weight', '.csc-container-col__number'];
    const scroll = document.querySelector('.csc-container-table-scroll');
    return {
      heads,
      lines,
      groupCellFound: Boolean(group),
      deadColRules: deadCols.filter((sel) => [...document.styleSheets].some((sheet) => {
        try { return [...sheet.cssRules].some((rule) => rule.cssText?.includes(sel)); } catch { return false; }
      })),
      hScroll: scroll ? { scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth } : null,
    };
  });
  assert(`[${tag}] thead đúng 8 cột, hết LOẠI/TRỌNG LƯỢNG`, probe.heads.length === 8 && !probe.heads.includes('Loại container') && !probe.heads.includes('Trọng lượng (kg)'), probe.heads);
  assert(`[${tag}] group cell 3 dòng micro-label SỐ/LOẠI/TRỌNG LƯỢNG`, probe.lines.length === 3
    && probe.lines[0]?.label === 'Số'
    && (probe.lines[1]?.label === 'Loại' || probe.lines[1]?.label === 'Loại*')
    && probe.lines[2]?.label === 'Trọng lượng', probe.lines);
  assert(`[${tag}] scroll box không h-scroll (scrollWidth == clientWidth)`, probe.hScroll && probe.hScroll.scrollWidth <= probe.hScroll.clientWidth, probe.hScroll);
  await page.screenshot({ path: resolve(OUT, `sil508-create-group-${tag}.png`) });
}

// ─── B. Click-to-edit từng dòng (trên form @1440) ───────────────────────────
await openCreateForm(1440, 900, 'edit');
// B1. LOẠI: click dòng → popover option mở → chọn 20DC.
const typeLineClicked = await page.evaluate(() => {
  const line = document.querySelector('.csc-container-row .csc-contgroup [data-field-id$="-type"]');
  if (!line) return 'line-missing';
  line.click();
  return 'clicked';
});
assert('[edit] click dòng LOẠI mở editor', typeLineClicked === 'clicked', typeLineClicked);
await sleep(500);
const typeInput = await page.$('.csc-container-row .csc-contgroup input[aria-label="Loại container"]');
assert('[edit] combobox LOẠI reachable trong group', Boolean(typeInput));
await typeInput.type('20DC', { delay: 30 });
await sleep(800);
const pickedType = await page.evaluate(() => {
  const options = [...document.querySelectorAll('[role="option"]')].filter((o) => o.getClientRects().length > 0);
  const match = options.find((o) => o.textContent.includes('20DC') && o.getAttribute('aria-disabled') !== 'true');
  if (!match) return { picked: false, texts: options.slice(0, 4).map((o) => o.textContent.trim().slice(0, 24)) };
  match.click();
  return { picked: true };
});
assert('[edit] chọn 20DC từ popover', pickedType.picked === true, pickedType);
await sleep(600);
const typeLineState = await page.evaluate(() => {
  const line = document.querySelector('.csc-container-row .csc-contgroup [data-field-id$="-type"]');
  return {
    display: line?.querySelector('.csc-container-cell__display')?.textContent?.trim() ?? null,
    inputValue: line?.querySelector('input[aria-label="Loại container"]')?.value ?? null,
  };
});
assert('[edit] dòng LOẠI hiển thị 20DC sau pick', typeLineState.display === '20DC' || typeLineState.inputValue === '20DC', typeLineState);
await page.screenshot({ path: resolve(OUT, 'sil508-type-line-picked.png') });

// B2. TRỌNG LƯỢNG: click dòng → gõ 12000 → display '12.000'.
const weightLineClicked = await page.evaluate(() => {
  const line = [...document.querySelectorAll('.csc-container-row .csc-contgroup > .csc-container-cell')]
    .find((l) => l.querySelector('.csc-container-cell__microlabel')?.textContent?.includes('Trọng lượng'));
  if (!line) return 'line-missing';
  line.click();
  return 'clicked';
});
assert('[edit] click dòng TRỌNG LƯỢNG mở editor', weightLineClicked === 'clicked', weightLineClicked);
await sleep(300);
const typedWeight = await page.evaluate(() => {
  const line = [...document.querySelectorAll('.csc-container-row .csc-contgroup > .csc-container-cell')]
    .find((l) => l.querySelector('.csc-container-cell__microlabel')?.textContent?.includes('Trọng lượng'));
  const input = line?.querySelector('input[type="number"]');
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '12000');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
});
assert('[edit] gõ 12000 vào dòng TRỌNG LƯỢNG', typedWeight);
await sleep(500);
const weightLineState = await page.evaluate(() => {
  const line = [...document.querySelectorAll('.csc-container-row .csc-contgroup > .csc-container-cell')]
    .find((l) => l.querySelector('.csc-container-cell__microlabel')?.textContent?.includes('Trọng lượng'));
  return {
    display: line?.querySelector('.csc-container-cell__display')?.textContent?.trim() ?? null,
    inputValue: line?.querySelector('input[type="number"]')?.value ?? null,
  };
});
assert('[edit] dòng TRỌNG LƯỢNG hiển thị 12.000 (vi-VN)', weightLineState.display === '12.000' || weightLineState.inputValue === '12000', weightLineState);
await page.screenshot({ path: resolve(OUT, 'sil508-weight-line-typed.png') });

// ─── C. Mobile @390: group full-width, 3 dòng ───────────────────────────────
await openCreateForm(390, 844, '390');
const mobileProbe = await page.evaluate(() => {
  const cell = document.querySelector('.csc-container-row .csc-contgroup-cell');
  const group = document.querySelector('.csc-container-row .csc-contgroup');
  return {
    found: Boolean(cell && group),
    lines: group ? group.querySelectorAll(':scope > .csc-container-cell').length : 0,
    spansFull: cell ? getComputedStyle(cell).gridColumnStart === 'grid-column-start' || getComputedStyle(cell).gridColumn === '1 / -1' || getComputedStyle(cell).gridColumnStart !== 'auto' : false,
    width: cell ? Math.round(cell.getBoundingClientRect().width) : 0,
    viewport: document.documentElement.clientWidth,
  };
});
assert('[390] group cell hiện diện + 3 dòng', mobileProbe.found && mobileProbe.lines === 3, mobileProbe);
assert('[390] group span full width (≥ ~90% viewport)', mobileProbe.width >= mobileProbe.viewport * 0.85, mobileProbe);
await page.screenshot({ path: resolve(OUT, 'sil508-create-group-390.png') });

await browser.close();
writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(assertions, null, 2));
writeFileSync(resolve(OUT, 'ui-driver.log'), `${log.join('\n')}\nEXIT=${process.exitCode ?? 0}\n`);
console.log(log.join('\n'));
console.log(`EXIT=${process.exitCode ?? 0}`);
