// SIL-590 UI drive — "Chỉnh sửa điều phối" dialog density @1440.
//
// Contract (SIL-520 width law preserved):
//   1. Dialog width ≥ 900px (the SIL-520 widened dialog, unchanged).
//   2. Phân loại + Cước thu dự kiến + Cước trả dự kiến share ONE row
//      (same field-wrapper offsetTop ±2px); Đóng kết hợp (FCL) on the same
//      row's last track.
//   3. Money inputs are content-sized: measured field width ≤ 205px.
//   4. Giờ điều vận owns the datetime row full-width — id 712 (owner 30/10)
//      removed the Giờ trả hàng field, so the dialog carries exactly ONE
//      datetime field (the former SIL-520 pair law is gone).
//   5. The modal body does not scroll with the form + Phát lệnh fieldset.
//
// Usage: cd frontend && QA_BASE_URL=http://localhost:7185 \
//   node ../qa/scripts/2026-10-27-sil590-dialog-dense-ui-drive.mjs
// Output: qa/2026-10-27_sil590-dialog-dense/*.png + assertions.json.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7185';
const QA_USER = process.env.QA_USER || 'dungnv';
const QA_PASS = process.env.QA_PASS || 'Abc123';
const OUT = resolve(process.cwd(), '../qa/2026-10-27_sil590-dialog-dense');
const LOG = resolve(OUT, 'ui-driver.log');
mkdirSync(OUT, { recursive: true });
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});

async function login(user, pass) {
  const page = await browser.newPage();
  await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('input[name="username"]', { timeout: 45000 });
  await page.type('input[name="username"]', user);
  await page.type('input[name="password"]', pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(() => localStorage.getItem('token') || localStorage.getItem('auth_token'), { timeout: 30000 });
  return page;
}

const page = await login(QA_USER, QA_PASS);
log(`login ok user=${QA_USER}`);
await page.goto(`${FE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('.detailed-plan-grid tbody tr', { timeout: 60000 });
await sleep(1200);
log('dispatch-detail rows rendered');

// Open "Sửa điều phối" from the ⋯ row menu (retry across rows — the repro
// needs a non-issued row; issued rows route to Phân xe lại instead).
const triggers = await page.$$('.detailed-plan-grid tbody tr .dispatch-row-menu__trigger');
let opened = false;
for (let i = 0; i < Math.min(triggers.length, 10) && !opened; i++) {
  await triggers[i].evaluate((el) => el.click());
  try {
    await page.waitForSelector('.dispatch-row-menu__list', { timeout: 2500 });
    const item = await page.evaluateHandle(() => [...document.querySelectorAll('.dispatch-row-menu__list button')].find((b) => b.textContent?.trim() === 'Sửa điều phối'));
    const el = item.asElement();
    if (el) { await el.evaluate((elm) => elm.click()); opened = true; }
    else await page.keyboard.press('Escape');
  } catch { await page.keyboard.press('Escape'); }
  if (opened) {
    try { await page.waitForSelector('.modal .dispatch-assignment-dialog', { timeout: 8000 }); }
    catch { opened = false; await page.keyboard.press('Escape'); await sleep(400); }
  }
  await sleep(250);
}
if (!opened) {
  result_failed('no Sửa điều phối item across the first rows');
} else log('plan editor dialog opened');

const result = { url: page.url(), viewport: '1440x900', checks: [] };
const check = (name, pass, detail) => { result.checks.push({ name, pass, detail }); if (!pass) result.failed = true; };

function result_failed(reason) {
  const r = { failed: true, checks: [{ name: 'dialog opened', pass: false, detail: reason }] };
  writeFileSync(resolve(process.cwd(), '../qa/2026-10-27_sil590-dialog-dense/assertions.json'), JSON.stringify(r, null, 2));
  console.error(reason);
  browser.close();
  process.exit(2);
}

await sleep(800);
const data = await page.evaluate(() => {
  const content = document.querySelector('.modal__content');
  const body = document.querySelector('.modal__body');
  const fields = document.querySelector('.dispatch-assignment-dialog__fields');
  const gridTemplate = fields ? getComputedStyle(fields).gridTemplateAreas : null;
  const cols = fields ? getComputedStyle(fields).gridTemplateColumns.split(' ').length : 0;
  const topOf = (sel) => {
    const el = document.querySelector(sel);
    return el ? Math.round(el.getBoundingClientRect().top) : null;
  };
  const bottomOf = (sel) => {
    const el = document.querySelector(sel);
    return el ? Math.round(el.getBoundingClientRect().bottom) : null;
  };
  const gridRowOf = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return `${cs.gridRowStart}/${cs.gridRowEnd}`;
  };
  const moneyWidths = [...document.querySelectorAll('.dispatch-assignment-dialog__money')]
    .map((f) => ({ w: Math.round(f.getBoundingClientRect().width), label: f.querySelector('.ds-field__label')?.textContent ?? '' }));
  const inputWidths = [...document.querySelectorAll('.dispatch-assignment-dialog__money input')]
    .map((i) => Math.round(i.getBoundingClientRect().width));
  const bodyScroll = body ? { sh: body.scrollHeight, ch: body.clientHeight } : null;
  const title = document.querySelector('.modal__title')?.textContent ?? '';
  return {
    title,
    dialogWidth: Math.round(content.getBoundingClientRect().width),
    gridTemplate,
    cols,
    topClassification: topOf('.dispatch-assignment-dialog__classification'),
    topRevenue: topOf('.dispatch-assignment-dialog__revenue'),
    topCost: topOf('.dispatch-assignment-dialog__cost'),
    topCombined: topOf('.dispatch-assignment-dialog__check'),
    topRun: topOf('.dispatch-assignment-dialog__run-field'),
    datetimeFields: document.querySelectorAll('.dispatch-assignment-dialog__run-field, .dispatch-assignment-dialog__end-field').length,
    gridRowClassification: gridRowOf('.dispatch-assignment-dialog__classification'),
    gridRowRevenue: gridRowOf('.dispatch-assignment-dialog__revenue'),
    gridRowCost: gridRowOf('.dispatch-assignment-dialog__cost'),
    bottomClassification: bottomOf('.dispatch-assignment-dialog__classification'),
    bottomRevenue: bottomOf('.dispatch-assignment-dialog__revenue'),
    bottomCost: bottomOf('.dispatch-assignment-dialog__cost'),
    moneyWidths,
    inputWidths,
    bodyScroll,
  };
});

check('plan editor dialog opened', data.title.includes('Chỉnh sửa điều phối'), data.title);
check('dialog keeps the SIL-520 width (≥900px @1440)', data.dialogWidth >= 900, { width: data.dialogWidth });
check('fields grid is 4 tracks at ≥900', data.cols === 4, { cols: data.cols, template: data.gridTemplate });
const row2 = [data.topClassification, data.topRevenue, data.topCost].filter((t) => t != null);
check('Phân loại + Cước thu + Cước trả occupy the SAME grid row (one template row, bottoms aligned by the grid)', row2.length >= 2
  && typeof data.gridTemplate === 'string' && data.gridTemplate.includes('classification revenue cost combined')
  && data.bottomClassification != null && data.bottomRevenue != null && data.bottomCost != null
  && Math.abs(data.bottomClassification - data.bottomRevenue) <= 2
  && Math.abs(data.bottomRevenue - data.bottomCost) <= 2,
{ template: data.gridTemplate, bottoms: { classification: data.bottomClassification, revenue: data.bottomRevenue, cost: data.bottomCost }, tops: { classification: data.topClassification, revenue: data.topRevenue, cost: data.topCost } });
if (data.topCombined != null) {
  check('Đóng kết hợp rides the same dense row (FCL)', Math.abs(data.topCombined - data.topRevenue) <= 2, { topCombined: data.topCombined, topRevenue: data.topRevenue });
}
check('money field content-sized (≤205px)', data.moneyWidths.every((m) => m.w <= 205), data.moneyWidths);
check('money input itself narrow (≤170px)', data.inputWidths.every((w) => w <= 170), data.inputWidths);
check('exactly ONE datetime field renders — Giờ điều vận (the Giờ trả hàng field was removed)', data.datetimeFields === 1 && data.topRun != null, { datetimeFields: data.datetimeFields, topRun: data.topRun });
check('Giờ điều vận owns the datetime row full-width', typeof data.gridTemplate === 'string' && data.gridTemplate.includes('run run run run'), { template: data.gridTemplate });
check('modal body does NOT scroll (full form visible, SIL-520)', data.bodyScroll ? data.bodyScroll.sh <= data.bodyScroll.ch + 1 : false, data.bodyScroll);

await page.screenshot({ path: resolve(OUT, 'dialog-on-page-1440.png') });
const dialog = await page.$('.modal__content');
if (dialog) await dialog.screenshot({ path: resolve(OUT, 'dialog-full.png') });

result.pass = result.checks.every((c) => c.pass);
writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
log(`EXIT ${result.pass ? 0 : 2} — checks: ${result.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'}:${c.name}`).join(' | ')}`);
await browser.close();
process.exit(result.pass ? 0 : 2);
