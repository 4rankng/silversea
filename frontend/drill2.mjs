#!/usr/bin/env node
/**
 * CUS role drill-down: inspect shipment detail and container overview.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:7174';
const USERNAME = process.env.CUS_USER || 'cus';
const PASSWORD = process.env.CUS_PASS || 'Abc123';
const OUT = 'qa/2026-08-16_cus-qa';
const SCREENS = `${OUT}/drill2`;

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

  await page.goto(`${BASE}/shipments/196946`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${SCREENS}/01_shipment_detail.png`, fullPage: true });

  // Now look at ShipmentsDetailPage
  await page.goto(`${BASE}/shipments-detail`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SCREENS}/02_shipments-detail-page.png`, fullPage: true });
  log('h1:', await page.textContent('h1').catch(() => 'n/a'));

  // Click first container card
  const cards = await page.$$('[class*="container"]');
  log('container cards found:', cards.length);

  // Look for all buttons/links on the page
  const allButtons = await page.$$eval('button, a, [role="button"]', (els) => els.map((e) => ({ tag: e.tagName.toLowerCase(), txt: e.textContent?.trim().slice(0, 60) || '', href: e.getAttribute('href') || '', aria: e.getAttribute('aria-label') || '' })));
  log('total clickables:', allButtons.length);
  for (const b of allButtons) {
    if (b.txt || b.aria) log('  -', b.tag, ':', b.txt || b.aria, b.href ? `(href: ${b.href})` : '');
  }

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL', e.stack || e.message);
  process.exit(1);
});
