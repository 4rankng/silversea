#!/usr/bin/env node
/**
 * SIL-169 / SIL-468 / SIL-471 REDO (QA verdict 8cea1a6b) — UI driver.
 * Phase via env PHASE=before|after. Captures screenshots + DOM measurements
 * into qa/2026-10-25_sil-redo/ and appends a driver log.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:7175';
const PHASE = process.env.PHASE || 'before';
const OUT = join(process.cwd(), 'qa', '2026-10-25_sil-redo');
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

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="text"], input[name="username"], input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', process.env.ADMIN_PASS || 'Abc123');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|config|customers|penalties|expenses)/, { timeout: 20000 });
  log('login ok →', page.url());
}

async function shot(name) {
  await page.screenshot({ path: join(OUT, `${PHASE}-${name}.png`), fullPage: false });
  log('shot', `${PHASE}-${name}.png`);
}

await login();

// ── SIL-169 /customers ──────────────────────────────────────────────────────
await page.goto(`${BASE}/customers`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await shot('customers-1440');
{
  const idle = page.locator('[data-testid="cus-metric-idle30"]');
  if (await idle.count()) log('SIL169 idle-metric text:', JSON.stringify(await idle.innerText()));
  else log('SIL169 idle-metric MISSING');
  const termHeader = page.locator('.customers-page .record-table thead th', { hasText: 'Hạn' }).first();
  if (await termHeader.count()) log('SIL169 term-header text:', JSON.stringify(await termHeader.innerText()));
  const contact = page.locator('.customers-page tbody tr').first().locator('td[data-label="Liên hệ"]');
  if (await contact.count()) log('SIL169 first-row contact:', JSON.stringify(await contact.innerText()));
  const canvas = await page.evaluate(() => {
    const el = document.querySelector('.app-body');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  log('SIL169 .app-body background:', canvas);
  const bg = await page.evaluate(() => {
    const el = document.querySelector('.customers-page');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  log('SIL169 .customers-page background:', bg);
}

// ── SIL-468 /penalties ──────────────────────────────────────────────────────
await page.goto(`${BASE}/penalties`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
await shot('penalties-1440');
{
  const rail = await page.evaluate(() => {
    const el = document.querySelector('.penalty-page .summary-rail');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { h: Math.round(r.height), itemH: Math.round(el.querySelector('.summary-rail__item')?.getBoundingClientRect().height ?? 0) };
  });
  log('SIL468 summary-rail:', JSON.stringify(rail));
  const chips = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.penalty-chip')).map((c) => c.textContent?.trim()),
  );
  log('SIL468 status chips:', JSON.stringify(chips));
  const vioCard = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('.penalty-transparent-panel'));
    const el = panels.find((p) => p.textContent?.includes('Phân loại vi phạm'));
    if (!el) return null;
    return Math.round(el.getBoundingClientRect().height);
  });
  log('SIL468 phan-loai card height:', vioCard);
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.penalty-scoreboard-table tbody tr')).slice(0, 6).map((tr) => Math.round(tr.getBoundingClientRect().height)),
  );
  log('SIL468 scoreboard row heights:', JSON.stringify(rows));
}

// ── SIL-471 /expenses ───────────────────────────────────────────────────────
await page.goto(`${BASE}/expenses`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await shot('expenses-1440');
{
  const dateCells = await page.evaluate(() =>
    Array.from(document.querySelectorAll('td[data-label="Ngày phát sinh"]')).slice(0, 4).map((td) => ({
      text: td.textContent?.replace(/\s+/g, ' ').trim(),
      badge: td.querySelector('.expense-record-table__entry-badge')?.textContent?.trim() ?? null,
    })),
  );
  log('SIL471 date cells:', JSON.stringify(dateCells, null, 0));
}

// mobile pass 390
await page.setViewportSize({ width: 390, height: 844 });
for (const [path, name] of [['/customers', 'customers'], ['/penalties', 'penalties'], ['/expenses', 'expenses']]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await shot(`${name}-390`);
}

log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 5)));
await browser.close();
log(`PHASE ${PHASE} DONE`);
