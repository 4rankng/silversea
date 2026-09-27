// Driver task screen (/my-trips/:id) reproduction + verification instrument.
//
// Case QA-2026-09-27-01 (card 20260927_1): re-runnable proof for the three
// user-reported defects on the driver's phone screen —
//   1. the header titled the trip with the internal shipment code (SHP-…) and
//      must title with the carrier document number (Số Bill / Số Booking);
//   2. the "Chứng từ giao hàng" completion card must stay dense (≤ ~60px);
//   3. the fixed tab bar must paint its own surface past the layout-viewport
//      bottom edge (no foreign strip under the tabs).
//
// Fixture (the local DB carries no live driver task): trip 4394 → driver
// `laixe` (IN_TRANSIT, ORDER_RECEIVED recorded) → fulfillment 4674 → shipment
// 9389 (SHP-2609-00208 / bl_number MSCUVN260900208 / IMPORT / LONG MINH /
// factory "Kho seam B 1789702634486").
//
// Usage:  cd frontend && node drv-repro.mjs     (local dev stack up: `make dev`)
// Output: qa/<date>_driver-task-polish/*.png + the measurement log on stdout.

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const API = process.env.QA_API || 'http://localhost:3002/api';
const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const OUT = `${process.env.QA_OUT || '..'}/qa/${new Date().toISOString().slice(0, 10)}_driver-task-polish`;
const DAY = new Date().toISOString().slice(0, 10);
const TRIP_ID = process.env.QA_TRIP_ID || '4394';
const USER = process.env.QA_USER || 'laixe';
mkdirSync(OUT, { recursive: true });

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password: process.env.QA_PASS || 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};

const token = await login(USER);
const browser = await chromium.launch();
const log = [];

for (const width of [360, 390, 414, 430]) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => log.push(`pageerror ${width}: ${String(err).slice(0, 200)}`));
  await page.addInitScript((t) => globalThis.localStorage.setItem('token', t), token);
  await page.goto(`${FE}/my-trips/${TRIP_ID}`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const measured = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    };
    const nav = document.querySelector('.bottom-nav');
    const navAfter = nav ? getComputedStyle(nav, '::after') : null;
    return {
      headerTitle: document.querySelector('.driver-task-header__title')?.textContent,
      headerLocation: document.querySelector('.driver-task-header__location')?.textContent,
      completionCard: rect('.driver-task-footer__body'),
      missingLine: document.querySelector('.driver-task-footer__issues')?.textContent,
      tabBar: rect('.bottom-nav'),
      stickyBar: rect('.driver-task-complete-sticky'),
      viewportH: window.innerHeight,
      tabBarSurfaceBand: navAfter ? { top: navAfter.top, height: navAfter.height, position: navAfter.position, background: navAfter.backgroundColor } : null,
      rootCanvas: getComputedStyle(document.documentElement).backgroundColor,
    };
  });
  log.push(`${width}px ${JSON.stringify(measured)}`);

  await page.screenshot({ path: `${OUT}/${DAY}_driver-task_ui-${width}-top.png` });
  await page.evaluate(() => document.querySelector('.app-body')?.scrollTo(0, 99999));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${DAY}_driver-task_ui-${width}-bottom.png` });
  await ctx.close();
}

await browser.close();
console.log(log.join('\n'));
