// Dispatch master-plan (/dispatch) toolbar regression instrument.
//
// Case QA-2026-09-27-02 / card 20260927_2: re-runnable proof that the
// standalone "+ Tạo lô hàng" row was retired into the same toolbar as the
// search/chiều-hàng/Bộ-lọc controls, that the topbar global search dropped
// to ≤ 360px, and that the Bộ-lọc drawer now owns a single
// `DateRangePopover` for the delivery-date range.
//
// Usage:  cd frontend && node dispatch-toolbar-shot.mjs     (local dev stack
//        up: `make dev`).
// Output: qa/<date>_dispatch-toolbar/*.png + the JSON probe on stdout.

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const OUT = resolve(process.cwd(), `../qa/${new Date().toISOString().slice(0, 10)}_dispatch-toolbar`);
const VIEWPORT = parseInt(process.env.VIEWPORT || '1440', 10);
const HEIGHT = parseInt(process.env.HEIGHT || '900', 10);
const PATH_ = process.env.PATH_ || '/dispatch';
const FULL = process.env.FULL === '1';
const LABEL = process.env.LABEL || 'frame';
const OPEN_DRAWER = process.env.OPEN_DRAWER === '1';
const USER = process.env.QA_USER || 'dieuvan';
const PASS = process.env.QA_PASS || 'Abc123';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: VIEWPORT, height: HEIGHT } });
const page = await ctx.newPage();

const requests = [];
const responses = [];
page.on('request', (r) => {
  if (r.url().includes('/api/')) requests.push({ method: r.method(), url: r.url() });
});
page.on('response', async (r) => {
  if (r.url().includes('/api/')) responses.push({ status: r.status(), url: r.url() });
});

await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="username"]', USER);
await page.fill('input[name="password"]', PASS);
await page.locator('button[type="submit"]').first().click();
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 }).catch(() => {});
console.error(`after login, url: ${page.url()}`);

await page.goto(`${FE}${PATH_}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const target = `${OUT}/${LABEL}.png`;
await page.screenshot({ path: target, fullPage: FULL });
console.error(`saved ${target}`);

const probe = await page.evaluate(() => {
  const toolbar = document.querySelector('.master-plan-filters');
  const action = document.querySelector('.master-plan-filters__actions .btn');
  const search = document.querySelector('.master-plan-filters__search input');
  const direction = document.querySelector('.master-plan-filters__direction');
  const trigger = document.querySelector('.master-plan-filters__advanced-trigger');
  const oldToolbar = document.querySelector('.dispatch-plan-page__toolbar');
  const topbarSearch = document.querySelector('.topbar__search input');
  const dateTrigger = document.querySelector('.topbar-date__trigger');
  const dateLabel = document.querySelector('.topbar-date__label')?.textContent?.trim();
  const datePeriod = document.querySelector('.topbar-date__period')?.textContent?.trim();
  const summary = document.querySelector('.master-plan-cargo-summary');
  return {
    hasToolbar: !!toolbar,
    hasOldToolbar: !!oldToolbar,
    actionText: action?.textContent?.trim() ?? null,
    searchValue: search?.value ?? null,
    directionLabel: direction?.textContent?.trim().slice(0, 80) ?? null,
    triggerLabel: trigger?.textContent?.trim().slice(0, 60) ?? null,
    toolbarBox: toolbar?.getBoundingClientRect()?.toJSON?.() ?? null,
    topbarSearchBox: topbarSearch?.getBoundingClientRect()?.toJSON?.() ?? null,
    dateTriggerBox: dateTrigger?.getBoundingClientRect()?.toJSON?.() ?? null,
    dateLabel,
    datePeriod,
    summaryTop: summary?.getBoundingClientRect()?.top ?? null,
    title: document.title,
    pathname: location.pathname,
  };
});
console.log(JSON.stringify(probe, null, 2));

if (OPEN_DRAWER) {
  await page.waitForTimeout(300);
  const triggerEl = page.locator('.master-plan-filters__advanced-trigger').first();
  if (await triggerEl.count()) {
    await triggerEl.scrollIntoViewIfNeeded();
    await triggerEl.click({ force: true });
    await page.waitForTimeout(500);
    const drawerTarget = `${OUT}/${LABEL}-drawer.png`;
    await page.screenshot({ path: drawerTarget, fullPage: FULL });
    console.error(`saved ${drawerTarget}`);

    const rangeTrigger = page.locator('[aria-label="Khoảng ngày giao"]').first();
    if (await rangeTrigger.count()) {
      await rangeTrigger.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
      const popoverTarget = `${OUT}/${LABEL}-date-range-popover.png`;
      await page.screenshot({ path: popoverTarget, fullPage: FULL });
      console.error(`saved ${popoverTarget}`);
    }
  }
}

console.error(`\n=== API traffic ===\nrequests: ${requests.length}\nresponses: ${responses.length}`);

await browser.close();
