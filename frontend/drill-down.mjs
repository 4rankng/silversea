#!/usr/bin/env node
/**
 * CUS role drill-down: open a shipment detail, capture screenshots, test clicks.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:7174';
const USERNAME = process.env.CUS_USER || 'cus';
const PASSWORD = process.env.CUS_PASS || 'Abc123';
const OUT = 'qa/2026-08-16_cus-qa';
const SCREENS = `${OUT}/drilldown`;

mkdirSync(SCREENS, { recursive: true });

const log = (...a) => process.stdout.write(a.join(' ') + '\n');

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="text"], input[name="username"]', USERNAME);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle', { timeout: 30000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('[PAGEERROR]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') log('[CONSOLE.ERR]', m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 500) log('[HTTP5xx]', r.status(), r.url());
  });

  log('login...');
  await login(page);
  await page.waitForTimeout(800);
  log('url=', page.url());

  // Navigate to shipments
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Find first row's "Chi tiết" button
  const detailBtns = await page.$$('button[id^="cus-dashboard-detail-"]');
  log('detail buttons found:', detailBtns.length);
  if (detailBtns.length === 0) {
    log('no detail buttons, exiting');
    await browser.close();
    return;
  }
  // Get shipment id from the first button
  const btnId = await detailBtns[0].getAttribute('id');
  const shipmentId = btnId.replace('cus-dashboard-detail-', '');
  log('using shipment id:', shipmentId);

  // Go directly via URL
  await page.goto(`${BASE}/shipments/${shipmentId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SCREENS}/01_detail_desktop.png`, fullPage: true });

  // Open detail drawer/modal? Look for the existing tabs
  log('title:', await page.title());
  log('h1 text:', await page.textContent('h1').catch(() => 'n/a'));

  // Look for the cell that opens a quick edit
  const editCells = await page.$$('[role="button"], button[aria-label*="Chỉnh"], [data-testid*="edit"]');
  log('potential edit cells:', editCells.length);

  // Find customer name cell and click it
  const customerCell = await page.$('text=/CÔNG TY|Công ty|ATR/');
  if (customerCell) {
    log('clicking customer cell...');
    await customerCell.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENS}/02_customer_edit_modal.png`, fullPage: true });
    // close it
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // Try clicking each editable cell
  const cellTexts = await page.$$eval('[class*="cus-cell"], [class*="cell-edit"]', (els) => els.slice(0, 5).map((e) => e.textContent?.slice(0, 50)));
  log('cells:', cellTexts);

  // Click BLCUS label
  const blLabel = await page.$('text=/BLCUS|Số Bill/');
  if (blLabel) {
    log('clicking BL label...');
    await blLabel.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENS}/03_bl_edit_modal.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // Look for action buttons (Khóa sổ, Tạm khóa, Mở lại)
  const lockBtn = await page.$('button:has-text("Khóa")');
  if (lockBtn) {
    log('found lock button');
    const buttons = await page.$$('button');
    for (const b of buttons) {
      const t = await b.textContent();
      if (t && /Khóa|Mở|Xác nhận|Yêu cầu|Tải|Chia sẻ|Xuất/i.test(t)) {
        log('  - button:', t.trim().slice(0, 60));
      }
    }
  }

  // Try clicking every button to find ones that trigger errors
  log('listing all buttons on detail page...');
  const allBtns = await page.$$eval('button', (els) => els.map((e) => ({ txt: e.textContent?.trim().slice(0, 60) || '', aria: e.getAttribute('aria-label') || '' })));
  log('button count:', allBtns.length);
  for (const b of allBtns.slice(0, 40)) {
    log('  -', b.txt || b.aria);
  }

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL', e.stack || e.message);
  process.exit(1);
});
