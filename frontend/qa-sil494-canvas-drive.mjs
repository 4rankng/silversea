#!/usr/bin/env node
/**
 * SIL-494 / SIL-496 QA drive (26/10, build 52ee6443+fix) — measures the full
 * page-background ladder on /customers and /config/customers (html, body,
 * .app-main, .app-body, page root), screenshots both at 1440, and appends a
 * driver log into qa/2026-10-26_sil494-496/.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:7179';
const PHASE = process.env.PHASE || 'before';
const OUT = join(process.cwd(), 'qa', '2026-10-26_sil494-496');
const LOG = join(OUT, `driver-${PHASE}.log`);
mkdirSync(OUT, { recursive: true });

const log = (...a) => {
  const line = a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
  process.stdout.write(line + '\n');
  appendFileSync(LOG, line + '\n');
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[type="text"], input[name="username"], input[autocomplete="username"]', 'admin');
await page.fill('input[type="password"]', process.env.ADMIN_PASS || 'Abc123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|config|customers|penalties|expenses)/, { timeout: 20000 });
log('login ok →', page.url());

for (const [path, name, rootSel] of [
  ['/customers', 'customers', '.customers-page'],
  ['/config/customers', 'config-customers', '.cfg-page--customers'],
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `${PHASE}-${name}-1440.png`), fullPage: false });
  log(`shot ${PHASE}-${name}-1440.png`);
  const ladder = await page.evaluate((sel) => {
    const pick = (query) => {
      const el = document.querySelector(query);
      return el ? getComputedStyle(el).backgroundColor : null;
    };
    return {
      html: pick('html'),
      body: pick('body'),
      appMain: pick('.app-main'),
      appBody: pick('.app-body'),
      pageRoot: pick(sel),
      pageRootFound: document.querySelector(sel) != null,
    };
  }, rootSel);
  log(`SIL496 ${name} background ladder:`, JSON.stringify(ladder));
}

// mobile pass 390 — same ladder assertion at phone width.
await page.setViewportSize({ width: 390, height: 844 });
for (const [path, name, rootSel] of [
  ['/customers', 'customers', '.customers-page'],
  ['/config/customers', 'config-customers', '.cfg-page--customers'],
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, `${PHASE}-${name}-390.png`), fullPage: false });
  log(`shot ${PHASE}-${name}-390.png`);
  const ladder = await page.evaluate((sel) => {
    const pick = (query) => {
      const el = document.querySelector(query);
      return el ? getComputedStyle(el).backgroundColor : null;
    };
    return { body: pick('body'), appBody: pick('.app-body'), pageRoot: pick(sel) };
  }, rootSel);
  log(`SIL496 ${name}@390 ladder:`, JSON.stringify(ladder));
}

log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 5)));
await browser.close();
log(`PHASE ${PHASE} DONE`);
