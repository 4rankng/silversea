#!/usr/bin/env node
/**
 * SIL-1167 QA drive — measures `.cus-schedule-missing` ("Chưa chốt lịch") on
 * /shipments at the ticket's evidence width (360x740) plus 375 / 390 sanity,
 * against the viewport's overflow-x: clip edge. BEFORE mode runs staging
 * (pre-fix build, clips), AFTER mode runs local dev (patched, must not clip).
 * Screenshots + numbers land in the repo-root qa/ dir per AGENTS.md §7.
 *
 * Run from frontend/:
 *   BASE_URL=https://vantai.tingting.vip MODE=before node sil1167-schedule-clip-drive.mjs
 *   MODE=after node sil1167-schedule-clip-drive.mjs   # local :7175
 */
import { chromium, webkit } from '@playwright/test';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:7175';
const MODE = process.env.MODE || 'after';
const ENGINE = process.env.ENGINE || 'chromium';
const USER = process.env.DRIVE_USER || 'tiepvv';
const PASS = process.env.DRIVE_PASS || 'Abc123';
const WIDTHS = (process.env.WIDTHS || '360,375,390').split(',').map(Number);
const ROOT = resolve(process.cwd(), '..');
const OUT = join(ROOT, 'qa');
const LOG = join(OUT, '2026-11-27_sil1167_ui-driver.log');
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'dumps'), { recursive: true });

const log = (...a) => {
  const line = a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
  process.stdout.write(line + '\n');
  appendFileSync(LOG, line + '\n');
};

const launch = async () => {
  if (ENGINE === 'webkit') return webkit.launch();
  try { return await chromium.launch({ channel: 'chrome' }); }
  catch { return await chromium.launch(); }
};
const browser = await launch();
const consoleErrors = [];
const apiCalls = [];

for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 740 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[w${width}] ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`[w${width}] ${String(e)}`));
  page.on('response', async (res) => {
    if (/\/api\/shipments(\?|$)/.test(res.url())) {
      let n = null;
      try { const j = await res.json(); n = Array.isArray(j) ? j.length : (j.data?.length ?? j.items?.length ?? j.meta?.totalItems ?? null); } catch { /* opaque */ }
      apiCalls.push({ mode: MODE, width, url: res.url().replace(BASE, ''), status: res.status(), rows: n });
    }
  });

  const gotoRetry = async (url, opts) => {
    try { await page.goto(url, opts); }
    catch { await page.waitForTimeout(1500); await page.goto(url, opts); }
  };
  await gotoRetry(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.fill('input[type="text"], input[name="username"], input[autocomplete="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|shipments|dispatch|trips|fleet|config)/, { timeout: 20000 });
  log(`[w${width}] login ok (${USER}) →`, page.url());

  await gotoRetry(`${BASE}/shipments`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.shipments-page--worksheet', { timeout: 20000 });
  try {
    await page.waitForSelector('.cus-schedule-missing', { timeout: 8000 });
  } catch {
    // default view shows settled lots — open the waiting-schedule tab
    log(`[w${width}] no .cus-schedule-missing in default view, clicking "Chưa chốt lịch" tab`);
    await page.locator('button', { hasText: 'Chưa chốt lịch' }).first().click();
    await page.waitForSelector('.cus-schedule-missing', { timeout: 10000 });
  }
  await page.waitForTimeout(2000); // let the lots query + card grid settle

  const data = await page.evaluate((w) => {
    const viewport = document.querySelector('.cus-dashboard-viewport');
    const vp = viewport?.getBoundingClientRect();
    const misses = [...document.querySelectorAll('.cus-schedule-missing')];
    const rows = misses.slice(0, 6).map((el) => {
      const r = el.getBoundingClientRect();
      const trigger = el.closest('.cus-inline-trigger')?.getBoundingClientRect();
      const card = el.closest('tr')?.getBoundingClientRect();
      return {
        text: el.textContent?.trim(),
        rectRight: +r.right.toFixed(1),
        width: +r.width.toFixed(1),
        ownLine: trigger ? r.top > trigger.top + 2 : null,
        viewportRight: vp ? +vp.right.toFixed(1) : null,
        overflowPx: vp ? +(r.right - vp.right).toFixed(1) : null,
        cardRight: card ? +card.right.toFixed(1) : null,
        clippedByViewport: vp ? r.right > vp.right + 0.5 : null,
      };
    });
    return {
      width: w,
      documentScrollWidth: document.documentElement.scrollWidth,
      viewport: vp ? { right: +vp.right.toFixed(1), width: +vp.width.toFixed(1) } : null,
      totalSpots: misses.length,
      rows,
    };
  }, width);

  const tag = `${MODE}_w${width}`;
  writeFileSync(join(OUT, 'dumps', `2026-11-27_sil1167_${tag}.json`), JSON.stringify(data, null, 2));
  await page.screenshot({ path: join(OUT, `2026-11-27_sil1167_${tag}_ui-page.png`), fullPage: false });
  const firstMiss = page.locator('.cus-schedule-missing').first();
  if (await firstMiss.count()) {
    await firstMiss.locator('xpath=ancestor::tr[1]').screenshot({ path: join(OUT, `2026-11-27_sil1167_${tag}_ui-row.png`) });
  }
  const clipped = data.rows.filter((r) => r.clippedByViewport);
  log(`[w${width}] ${tag}`, JSON.stringify({
    spots: data.totalSpots,
    scrollW: data.documentScrollWidth,
    vpRight: data.viewport?.right,
    clippedCount: clipped.length,
    sample: data.rows[0],
  }));
  await ctx.close();
}

log('api identity', JSON.stringify(apiCalls));
log('console/page errors:', consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 10)) : 'none');
await browser.close();
log(`MODE=${MODE} done`);
