// Item 2: Find multi-cont-type bill on /shipments
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const credPath = path.resolve('../prompts/qa-credentials.yaml');
const credText = fs.readFileSync(credPath, 'utf8');
const localBlock = credText.split('staging:')[0];
const cred = yaml.load(localBlock);
const env = cred.local;
const baseUrl = env.baseUrl;
const SCREEN_DIR = path.resolve('../qa/2026-08-24_silver-feedback/screens');
const log = (...a) => console.log(...a);

async function login(page, u, p) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"], input[type="text"]:not([readonly])', u);
  await page.fill('input[type="password"]', p);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(800);
}

(async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await login(p, env.users.cus.username, env.users.cus.password);
    await p.goto(`${baseUrl}/shipments`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);

    // Get all Tổng quan cells across all pages
    const tongQuanAll = await p.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table thead th'));
      const idx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('tổng quan'));
      if (idx < 0) return [];
      return Array.from(document.querySelectorAll('table tbody tr')).map((r) => {
        const tds = r.querySelectorAll('td');
        return (tds[idx]?.innerText || '').replace(/\s+/g, ' ').trim();
      });
    });
    log('Tổng quan hàng hóa cells (all rows this page):', tongQuanAll);

    // Go to page 2
    const page2 = await p.$('button:text("2")');
    if (page2) {
      await page2.click();
      await p.waitForTimeout(1000);
      const tongQuanP2 = await p.evaluate(() => {
        const headers = Array.from(document.querySelectorAll('table thead th'));
        const idx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('tổng quan'));
        if (idx < 0) return [];
        return Array.from(document.querySelectorAll('table tbody tr')).map((r) => {
          const tds = r.querySelectorAll('td');
          return (tds[idx]?.innerText || '').replace(/\s+/g, ' ').trim();
        });
      });
      log('Page 2:', tongQuanP2);
    }

    // Look for "1 x 40HC" and "1 x 20DC" in same shipment via API
    // Direct hit on backend API
    const apiRes = await p.evaluate(async (apiBase) => {
      const res = await fetch(`${apiBase}/shipments/cus/overview?pageSize=200`, { credentials: 'include' });
      if (!res.ok) return { error: res.status };
      const data = await res.json();
      return data;
    }, env.api);
    log('API overview items count:', apiRes?.items?.length);
    // Find items with mixed cont types
    const items = apiRes?.items || [];
    const mixed = items.filter((it) => {
      const tq = it.tongQuanHangHoa || it.cargoSummary || '';
      return tq && tq.includes('40') && tq.includes('20');
    }).slice(0, 4);
    log('Items with both 40 and 20 (multi-type):', mixed.map(m => ({
      id: m.id,
      bill: m.billOrBookNumber || m.declarationNumber,
      tq: m.tongQuanHangHoa || m.cargoSummary,
    })));

    // Direct API for /shipments-detail? Try detail
    const detailRes = await p.evaluate(async (apiBase) => {
      const res = await fetch(`${apiBase}/shipments/cus/detail?pageSize=50`, { credentials: 'include' });
      if (!res.ok) return { error: res.status };
      const data = await res.json();
      return data;
    }, env.api);
    log('API detail items count:', detailRes?.items?.length);

    await ctx.close();
  } finally {
    await browser.close();
  }
})();
