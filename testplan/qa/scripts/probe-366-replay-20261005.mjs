// Card 20261005_366 replay — the retester's exact flow on the CURRENT build:
// open the dispatch editor, click the hour segment (prefilled), type "15",
// assert focus stays + advances while the pointer sheet is open, and capture
// whether the sheet visually covers the segments. Usage:
//   BASE=https://vantai.tingting.vip node testplan/qa/scripts/probe-366-replay-20261005.mjs
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'https://vantai.tingting.vip';
const OUT = 'qa/2026-10-05_card366-replay';
mkdirSync(OUT, { recursive: true });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
if (!login.ok) throw new Error(`login failed ${login.status}`);
const { token } = await login.json();
const browser = await puppeteer.launch({ headless: 'new' });
const results = { build: null, widths: [] };
async function replay(width) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width <= 640 ? 844 : 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(3500);
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button[aria-label^="Sửa ô điều phối"]')].find((b) => !b.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!opened) { results.widths.push({ width, error: 'no trigger' }); await page.close(); return; }
  await page.waitForSelector('input[aria-label="Giờ — Giờ trả hàng"]', { timeout: 20000 });
  await settle(400);
  const hour = await page.$('input[aria-label="Giờ — Giờ trả hàng"]');
  const prefill = await page.evaluate((sel) => [...document.querySelectorAll('[data-seg-part="time"] input')].map((i) => i.value), 'x');
  const box = await hour.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await settle(800); // the steal window from the retest
  const state = await page.evaluate(() => {
    const seg = document.elementFromPoint(0, 0);
    const active = document.activeElement;
    const group = active?.closest('[data-seg-part]');
    const sheet = document.querySelector('.time-picker__overlay');
    let covered = null;
    if (active && 'getBoundingClientRect' in active) {
      const r = active.getBoundingClientRect();
      const topEl = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      covered = topEl ? !active.contains(topEl) && topEl !== active : null;
    }
    return {
      active: active?.getAttribute('aria-label') ?? 'none',
      values: group ? [...group.querySelectorAll('input')].map((i) => i.value) : null,
      sheetOpen: Boolean(sheet),
      sheetCoversHourField: covered,
      sheetRect: sheet ? (() => { const r = sheet.getBoundingClientRect(); return { top: Math.round(r.top), height: Math.round(r.height) }; })() : null,
    };
  });
  await page.screenshot({ path: `${OUT}/after-click-${width}.png` });
  let sheetClosedOnFirstDigit = null;
  for (const ch of ['1', '5']) {
    await page.keyboard.type(ch);
    await settle(250);
    if (ch === '1') {
      sheetClosedOnFirstDigit = await page.evaluate(() => !document.querySelector('.time-picker__overlay'));
    }
  }
  const afterType = await page.evaluate(() => {
    const active = document.activeElement;
    const group = active?.closest('[data-seg-part]');
    return {
      active: active?.getAttribute('aria-label') ?? 'none',
      values: group ? [...group.querySelectorAll('input')].map((i) => i.value) : null,
    };
  });
  await page.screenshot({ path: `${OUT}/after-type-15-${width}.png` });
  const verdict = afterType.active === 'Phút — Giờ trả hàng' && sheetClosedOnFirstDigit ? 'ADVANCES, SHEET CLOSED ON FIRST DIGIT' : `CHECK (advanced=${afterType.active}, sheetClosed=${sheetClosedOnFirstDigit})`;
  results.widths.push({ width, prefill, afterOpen: state, afterType, verdict });
  console.log(`width ${width}: prefill=${JSON.stringify(prefill)} afterOpen=${state.active} (sheet=${state.sheetOpen}, coversHour=${state.sheetCoversHourField}) → type "15" → ${afterType.active} [${verdict}]`);
  await page.close();
}
results.build = (await (await fetch(`${BASE}/api/health`)).json()).buildHash;
console.log('buildHash:', results.build);
await replay(390);
await replay(1440);
writeFileSync(`${OUT}/probe-results.json`, JSON.stringify(results, null, 2));
console.log('VERDICT:', results.widths.every((w) => w.verdict?.includes('ADVANCES')) ? 'CARD 366 FLOW GREEN ON CURRENT BUILD' : 'CHECK OUTPUT');
await browser.close();
