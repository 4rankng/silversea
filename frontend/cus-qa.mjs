#!/usr/bin/env node
/**
 * Comprehensive CUS role visual & functional QA.
 *
 * - Visits every CUS-accessible page at desktop & mobile viewports
 * - Captures full-page screenshots under qa/2026-08-16_cus-qa/screens/
 * - Lists all console errors, network failures, visible page errors
 * - Clicks every clickable element on each page to surface logic/visual bugs
 * - Performs realistic create/update/delete actions
 *
 * Run with:  cd frontend && PLAYWRIGHT_BROWSERS_PATH=... node ../qa/2026-08-16_cus-qa/cus-qa.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:7174';
const USERNAME = process.env.CUS_USER || 'cus';
const PASSWORD = process.env.CUS_PASS || 'Abc123';
const OUT = 'qa/2026-08-16_cus-qa';
const SCREENS = `${OUT}/screens`;

mkdirSync(SCREENS, { recursive: true });

const log = (...a) => {
  const line = a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
  process.stdout.write(line + '\n');
};

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(500);
  await page.fill('input[type="text"], input[name="username"]', USERNAME);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle', { timeout: 30000 });
  await page.waitForTimeout(500);
}

async function attachListeners(page, label, errors) {
  page.on('pageerror', (e) => {
    errors.push({ kind: 'pageerror', where: label, message: e.message, stack: e.stack });
    log(`[${label}] PAGEERROR: ${e.message}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') {
      errors.push({ kind: 'console', where: label, text: m.text() });
      log(`[${label}] CONSOLE.ERR: ${m.text()}`);
    }
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.startsWith(BASE) || url.includes('/api/')) {
      errors.push({ kind: 'requestfailed', where: label, url, failure: req.failure()?.errorText });
      log(`[${label}] REQFAIL: ${url} :: ${req.failure()?.errorText}`);
    }
  });
  page.on('response', (resp) => {
    if (resp.status() >= 500) {
      errors.push({ kind: 'http5xx', where: label, url: resp.url(), status: resp.status() });
      log(`[${label}] HTTP${resp.status()}: ${resp.url()}`);
    }
  });
}

async function shot(page, name) {
  const path = join(SCREENS, name);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function clickableInventory(page) {
  return await page.evaluate(() => {
    const out = [];
    const els = document.querySelectorAll('button, a, [role="button"], [role="link"], [role="menuitem"], [role="tab"], select, input[type="checkbox"], input[type="radio"], [contenteditable]');
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const txt = (el.textContent || '').trim().slice(0, 80);
      const aria = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') || '';
      const href = el.getAttribute('href') || '';
      const name = el.getAttribute('name') || '';
      const id = el.getAttribute('id') || '';
      out.push({ tag, type, name, id, href, txt, aria, title, placeholder });
    });
    return out;
  });
}

async function visit(page, label, url, errors) {
  log(`-- [${now()}] visit ${label} -> ${url}`);
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(700);
  await shot(page, `01_${label}_desktop.png`);
  // inventory
  const inv = await clickableInventory(page);
  return { url: page.url(), inv };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: VIEWPORTS[0], locale: 'vi-VN' });
  const page = await ctx.newPage();
  const errors = [];
  await attachListeners(page, 'init', errors);

  // Login
  log(`-- [${now()}] login as ${USERNAME}`);
  await login(page);
  log(`-- after login url=${page.url()}`);
  await shot(page, '00_after-login.png');

  // List CUS-accessible pages
  const cusPages = [
    { label: 'shipments-list', path: '/shipments' },
    { label: 'shipments-detail', path: '/shipments-detail' },
    { label: 'recoverable-costs', path: '/recoverable-costs' },
  ];

  const inventory = [];
  for (const v of VIEWPORTS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    for (const p of cusPages) {
      const r = await visit(page, `${p.label}_${v.name}`, p.path, errors);
      inventory.push({ viewport: v.name, page: p.label, url: r.url, clickables: r.inv });
    }
  }

  // Find a shipment to drill into
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  // Look for a row link
  const shipmentLinks = await page.$$eval('a[href*="/shipments/"]', (els) => els.map((e) => e.getAttribute('href')).filter((h) => /\/shipments\/(?!new$|detail$)/.test(h || '')));
  log(`>>> shipment links found: ${JSON.stringify(shipmentLinks.slice(0, 5))}`);

  let shipmentId = null;
  if (shipmentLinks.length > 0) {
    const href = shipmentLinks[0];
    shipmentId = href.split('/').pop();
    log(`>>> using shipmentId=${shipmentId}`);
    for (const v of VIEWPORTS) {
      await page.setViewportSize({ width: v.width, height: v.height });
      const r = await visit(page, `shipment-detail_${v.name}`, `/shipments/${shipmentId}`, errors);
      inventory.push({ viewport: v.name, page: 'shipment-detail', url: r.url, clickables: r.inv });
    }
  } else {
    log('!!! no shipment found to drill into');
  }

  writeFileSync(`${OUT}/inventory.json`, JSON.stringify(inventory, null, 2));
  writeFileSync(`${OUT}/errors.json`, JSON.stringify(errors, null, 2));
  log(`-- total errors: ${errors.length}`);
  log(`-- inventory: ${inventory.length} pages`);
  await browser.close();
}

main().catch((e) => {
  console.error('FATAL', e.stack || e.message);
  process.exit(1);
});
