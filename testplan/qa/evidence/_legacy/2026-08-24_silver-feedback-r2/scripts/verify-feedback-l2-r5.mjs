// Find vendor (nhà xe ngoài) chips in /dispatch across all pages
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
    await login(p, env.users.dieuvan.username, env.users.dieuvan.password);
    await p.goto(`${baseUrl}/dispatch`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);

    // Click "Phân xe" filter to find Đã phân xong
    const phanXeSel = await p.evaluate(() => {
      const sels = Array.from(document.querySelectorAll('select'));
      for (const s of sels) {
        const opts = Array.from(s.options).map((o) => o.text);
        if (opts.some((t) => /Chưa phân|Đang phân|Đã phân/.test(t))) {
          return { value: Array.from(s.options).find((o) => /Đã phân/.test(o.text))?.value, opts };
        }
      }
      return null;
    });
    log('Phân xe select:', phanXeSel);
    if (phanXeSel?.value) {
      // Use locator
      const sels = await p.$$('select');
      for (const s of sels) {
        const opts = await p.evaluate((el) => Array.from(el.options).map((o) => ({ v: o.value, t: o.text })), s);
        const target = opts.find((o) => /Đã phân/.test(o.t));
        if (target) {
          await s.selectOption(target.v);
          break;
        }
      }
      await p.waitForTimeout(1500);
    }
    await p.screenshot({ path: path.join(SCREEN_DIR, 'dv-11-phansang-xe.png'), fullPage: true });

    // Get all Phân bổ cells on this page
    const phanBoCells = await p.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table thead th'));
      const idx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('phân bổ'));
      if (idx < 0) return [];
      return Array.from(document.querySelectorAll('table tbody tr')).map((r) => {
        const tds = r.querySelectorAll('td');
        return (tds[idx]?.innerText || '').replace(/\s+/g, ' ').trim();
      });
    });
    log('Phân bổ cells on Đã phân page:', phanBoCells);

    // Check page 2
    const nextBtn = await p.$('button[aria-label*="next"], button:has-text(">")');
    const hasNext = await p.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.some((b) => (b.innerText || '').trim() === '>' || (b.innerText || '').trim() === '›');
    });
    log('Has next button:', hasNext);

    // Check the page 2
    const page2 = await p.$('button:text("2")');
    if (page2) {
      await page2.click();
      await p.waitForTimeout(1000);
      const phanBoPage2 = await p.evaluate(() => {
        const headers = Array.from(document.querySelectorAll('table thead th'));
        const idx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('phân bổ'));
        if (idx < 0) return [];
        return Array.from(document.querySelectorAll('table tbody tr')).map((r) => {
          const tds = r.querySelectorAll('td');
          return (tds[idx]?.innerText || '').replace(/\s+/g, ' ').trim();
        });
      });
      log('Phân bổ cells on page 2:', phanBoPage2);
    }

    // Cảng nâng - collect unique port names from many rows
    const portNames = await p.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table thead th'));
      const cangNangIdx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('cảng nâng'));
      const cangHaIdx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('cảng hạ'));
      const out = { cangNang: new Set(), cangHa: new Set() };
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      for (const r of rows) {
        const tds = r.querySelectorAll('td');
        const cn = (tds[cangNangIdx]?.innerText || '').replace(/\s+/g, ' ').trim();
        const ch = (tds[cangHaIdx]?.innerText || '').replace(/\s+/g, ' ').trim();
        cn.split(' ').forEach((w) => { if (w.length > 3 && !w.match(/^\d/)) out.cangNang.add(w); });
        ch.split(' ').forEach((w) => { if (w.length > 3 && !w.match(/^\d/)) out.cangHa.add(w); });
      }
      return { cangNang: Array.from(out.cangNang).slice(0, 20), cangHa: Array.from(out.cangHa).slice(0, 20) };
    });
    log('Cảng nâng tokens:', portNames.cangNang);
    log('Cảng hạ tokens:', portNames.cangHa);

    await ctx.close();
  } finally {
    await browser.close();
  }
})();
