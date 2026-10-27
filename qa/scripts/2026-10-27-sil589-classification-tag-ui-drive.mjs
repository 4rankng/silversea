// SIL-589 UI drive — /dispatch-detail PHÂN LOẠI column: the grouped-row tag
// "Ghép (n/m)" renders as COMPACT TEXT (no oval pill), one "Lẻ" per cell, the
// header sits on ONE line, nothing overflows into the neighbouring columns.
//
// Usage: cd frontend && QA_BASE_URL=http://localhost:7185 \
//   node ../qa/scripts/2026-10-27-sil589-classification-tag-ui-drive.mjs
// Output: qa/2026-10-27_sil589-classification-tag/*.png + assertions.json.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7185';
const QA_USER = process.env.QA_USER || 'dungnv';
const QA_PASS = process.env.QA_PASS || 'Abc123';
const OUT = resolve(process.cwd(), '../qa/2026-10-27_sil589-classification-tag');
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
// Focus the grouped population: deep-link the cost group's Bill (SIL-589
// repro lot pair SHP-2610-00083/00086 share cost group c0d89ee9, plate
// 15C-222.22 — the q filter matches Bill/Booking, not plates). Without it
// the grouped rows sit pages deep in the month board.
await page.goto(`${FE}/dispatch-detail?q=KK95249354`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('.detailed-plan-grid tbody tr', { timeout: 60000 });
await sleep(1500);
log('dispatch-detail rows rendered (filtered to the grouped plate)');

const result = { url: page.url(), viewport: '1440x900', checks: [] };
const check = (name, pass, detail) => { result.checks.push({ name, pass, detail }); if (!pass) result.failed = true; };

const data = await page.evaluate(() => {
  const headers = [...document.querySelectorAll('.detailed-plan-grid thead th')];
  const headerInfo = headers.map((th) => ({ text: th.textContent.replace(/\s+/g, ' ').trim(), h: Math.round(th.getBoundingClientRect().height) }));
  const oneLineRef = headerInfo.find((h) => /^CONTAINER$/i.test(h.text))?.h ?? null;
  const phanLoai = headerInfo.find((h) => /^PHÂN LOẠI$/i.test(h.text)) ?? null;

  const rows = [...document.querySelectorAll('.detailed-plan-grid tbody tr')];
  const grouped = rows.map((tr, idx) => {
    const cellEl = tr.querySelector('td[data-label="Phân loại"]');
    if (!cellEl) return null;
    const tag = cellEl.querySelector('.detailed-plan-grid__lcl-group-tag');
    if (!tag) return null; // not a grouped row
    const tagRect = tag.getBoundingClientRect();
    const cellRect = cellEl.getBoundingClientRect();
    const cs = getComputedStyle(tag);
    return {
      rowIdx: idx,
      text: (cellEl.textContent ?? '').replace(/\s+/g, ' ').trim(),
      tagText: tag.textContent.replace(/\s+/g, ' ').trim(),
      leCount: ((cellEl.textContent ?? '').match(/Lẻ/g) ?? []).length,
      tagHeight: Math.round(tagRect.height),
      tagLines: Math.round(tagRect.height / parseFloat(cs.lineHeight || '16')),
      insideCellX: tagRect.left >= cellRect.left - 0.5 && tagRect.right <= cellRect.right + 0.5,
      insideCellY: tagRect.top >= cellRect.top - 0.5 && tagRect.bottom <= cellRect.bottom + 0.5,
      radius: cs.borderRadius,
      background: cs.backgroundColor,
      borderWidth: cs.borderTopWidth,
    };
  }).filter(Boolean);
  return { phanLoai, oneLineRef, headerInfo, groupedCount: grouped.length, grouped: grouped.slice(0, 6) };
});

check('grouped Phân loại rows rendered on the board', data.groupedCount > 0, data.groupedCount);
check('PHÂN LOẠI header present', data.phanLoai != null, data.headerInfo);
if (data.phanLoai && data.oneLineRef) {
  check('PHÂN LOẠI header sits on ONE line (same height as the CONTAINER header)', data.phanLoai.h === data.oneLineRef, { phanLoai: data.phanLoai, oneLineRef: data.oneLineRef });
}
check('group tag says "Ghép (n/m)" — no "Lẻ ·" prefix (one label per cell)', data.grouped.every((g) => /^Ghép \(\d+\/\d+\)$/.test(g.tagText)), data.grouped.map((g) => g.tagText));
check('no duplicated "Lẻ" in the cell (≤1 occurrence)', data.grouped.every((g) => g.leCount <= 1), data.grouped.map((g) => ({ text: g.text, leCount: g.leCount })));
check('tag renders on ONE line (compact, no vertical oval)', data.grouped.every((g) => g.tagLines <= 1), data.grouped.map((g) => ({ tagHeight: g.tagHeight, tagLines: g.tagLines })));
check('tag stays inside its own cell (no overflow into ĐIỀU PHỐI/GHI CHÚ)', data.grouped.every((g) => g.insideCellX && g.insideCellY), data.grouped.filter((g) => !(g.insideCellX && g.insideCellY)).slice(0, 3));
check('tag carries NO pill chrome (radius 0 / transparent bg / no border)', data.grouped.every((g) => parseFloat(g.radius) === 0 && (g.background === 'rgba(0, 0, 0, 0)' || g.background === 'transparent') && parseFloat(g.borderWidth) === 0), data.grouped.map((g) => ({ radius: g.radius, background: g.background, borderWidth: g.borderWidth })));

// Scroll the board's horizontal rail to the END so the pinned Thao tác rail
// stops covering Ghi chú / the tail of Phân loại at scrollLeft 0 — the ticket
// is about the Phân loại cell, the evidence must show it in full.
await page.evaluate(() => {
  const pane = document.querySelector('.detailed-plan-grid__wrapper');
  if (pane) pane.scrollLeft = pane.scrollWidth;
});
await sleep(400);
await page.screenshot({ path: resolve(OUT, 'dispatch-detail-1440-full.png') });
const groupedRow = await page.$('.detailed-plan-grid tbody tr .detailed-plan-grid__lcl-group-tag');
if (groupedRow) {
  const rowEl = (await groupedRow.$('xpath=ancestor::tr[1]'));
  if (rowEl) await rowEl.screenshot({ path: resolve(OUT, 'grouped-row.png') });
  await groupedRow.screenshot({ path: resolve(OUT, 'group-tag.png') });
}

result.pass = result.checks.every((c) => c.pass);
writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
log(`EXIT ${result.pass ? 0 : 2} — checks: ${result.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'}:${c.name}`).join(' | ')}`);
await browser.close();
process.exit(result.pass ? 0 : 2);
