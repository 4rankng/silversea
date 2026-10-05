// Card 326 final rung — the USER's exact repro at the failing configuration:
// narrow viewport (mobile sheet path, TIME_PICKER_MOBILE_QUERY ≤640px), click
// the hour segment, WAIT past any focus steal (800ms), then type "08" and
// measure activeElement per keystroke. The earlier desktop-only rungs never
// saw the mobile Dialog steal. Usage:
//   BASE=https://vantai.tingting.vip node \
//   testplan/qa/scripts/probe-326-focus-steal-20261005.mjs
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'https://vantai.tingting.vip';
const OUT = process.env.OUT_DIR || 'qa/2026-10-05_card326-steal-rung';
mkdirSync(OUT, { recursive: true });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.IDENTIFIER || 'dungnv', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login failed ${login.status}`);
const { token } = await login.json();
console.log(`API login OK (${process.env.IDENTIFIER || 'dungnv'})`);
const browser = await puppeteer.launch({ headless: 'new' });
const results = { buildProbe: null, widths: [] };

async function rung(width) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width <= 640 ? 844 : 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(3500);
  // Open the first enabled editor (the Giờ trả hàng SplitDateTimeField lives there).
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button[aria-label^="Sửa ô điều phối"]')].find((b) => !b.disabled);
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true };
  });
  if (!opened.ok) { results.widths.push({ width, error: 'no enabled trigger' }); await page.close(); return; }
  try {
    await page.waitForSelector('input[aria-label="Giờ — Giờ trả hàng"]', { timeout: 20000 });
  } catch { results.widths.push({ width, error: 'segments not mounted' }); await page.close(); return; }
  await settle(500);
  const hourSelector = 'input[aria-label="Giờ — Giờ trả hàng"]';
  const box = await (await page.$(hourSelector)).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // THE STEAL WINDOW: the mobile sheet mounts and (pre-fix) autofocuses its
  // Dialog. Wait well past it, then measure.
  await settle(800);
  const afterOpen = await page.evaluate((sel) => ({
    active: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? 'none',
    sheetOpen: Boolean(document.querySelector('.time-picker__sheet, .time-picker__popup')),
  }), hourSelector);
  await page.screenshot({ path: `${OUT}/steal-window-${width}.png` });
  // Now the user types "08" — per-keystroke measurement.
  const steps = [];
  for (const ch of ['0', '8']) {
    await page.keyboard.type(ch);
    await settle(150);
    steps.push(await page.evaluate(() => {
      const active = document.activeElement;
      const group = active?.closest('[data-seg-part]');
      return {
        typed: null,
        active: active?.getAttribute('aria-label') ?? active?.tagName ?? 'none',
        seg: active?.getAttribute('data-seg') ?? null,
        values: group ? [...group.querySelectorAll('input')].map((i) => i.value) : null,
      };
    }));
    steps[steps.length - 1].typed = ch;
  }
  await page.screenshot({ path: `${OUT}/after-type-08-${width}.png` });
  const advanced = steps.at(-1)?.active === 'Phút — Giờ trả hàng';
  results.widths.push({
    width, afterOpen, steps,
    verdict: afterOpen.active === 'Giờ — Giờ trả hàng' && advanced ? 'FOCUS HOLDS, ADVANCES' : `CHECK: afterOpen=${afterOpen.active}, advanced=${advanced}`,
  });
  console.log(`width ${width}:`, JSON.stringify(results.widths.at(-1).verdict), '| afterOpen:', afterOpen.active, '| sheet:', afterOpen.sheetOpen);
  await page.close();
}

const health = await fetch(`${BASE}/api/health`);
results.buildProbe = (await health.json()).buildHash;
console.log('buildHash:', results.buildProbe);
await rung(390);
await rung(1440);
writeFileSync(`${OUT}/probe-results.json`, JSON.stringify(results, null, 2));
const v390 = results.widths.find((w) => w.width === 390)?.verdict ?? '';
console.log('VERDICT:', v390.includes('FOCUS HOLDS, ADVANCES') ? 'STEAL FIXED (390 + 1440)' : 'CHECK OUTPUT');
await browser.close();
