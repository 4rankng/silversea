#!/usr/bin/env node
/**
 * SIL-615 supplementary drive — the ticket's defect report is about the
 * EXPANDED sidebar touching the table. The main driver measured the default
 * states; this pass toggles the sidebar open at 1307px (compact desktop,
 * starts collapsed) and measures the expanded-248px state too.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:7175';
const ROOT = resolve(process.cwd(), '..');
const OUT = join(ROOT, 'qa');
const LOG = join(OUT, '2026-10-31_sil615_ui-driver.log');
mkdirSync(OUT, { recursive: true });

const log = (...a) => {
  const line = a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
  process.stdout.write(line + '\n');
  appendFileSync(LOG, line + '\n');
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1307, height: 800 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[type="text"], input[name="username"], input[autocomplete="username"]', 'admin');
await page.fill('input[type="password"]', process.env.ADMIN_PASS || 'Abc123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|shipments|dispatch|trips|fleet|config)/, { timeout: 20000 });
await page.goto(`${BASE}/shipments`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.shipments-page--worksheet', { timeout: 20000 });
await page.waitForTimeout(2000);

// Expand the sidebar (compact desktop starts collapsed at 1307).
await page.click('button[aria-label="Mở menu điều hướng"]');
await page.waitForTimeout(800);

const m = await page.evaluate(() => {
  const rect = (sel) => {
    const el = document.querySelector(sel);
    return el ? (({ left, right, width }) => ({ left, right, width }))(el.getBoundingClientRect()) : null;
  };
  const sidebar = rect('.sidebar');
  const board = rect('.cus-workspace--worksheet');
  return {
    sidebarWidth: sidebar?.width,
    boardLeft: board?.left,
    gap: sidebar && board ? +(board.left - sidebar.right).toFixed(2) : null,
  };
});
const shot = '2026-10-31_sil615_ui-desktop-1307-sidebar-expanded.png';
await page.screenshot({ path: join(OUT, shot), fullPage: false });
log('[1307-expanded] measured:', JSON.stringify(m), `shot=${shot}`);
const pass = m.gap !== null && m.gap >= 12 && m.sidebarWidth > 100;
log(`VERDICT expanded-sidebar gap ≥ 12px: ${pass}`);
log('console errors:', consoleErrors.length ? consoleErrors : 'none');
await browser.close();
process.exit(pass && consoleErrors.length === 0 ? 0 : 1);
