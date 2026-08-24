// Item 12 & 17: vendor name display (tên ngắn) and cảng tên ngắn
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

    // Click Nhà xe dropdown to find options
    const dropdown = await p.$('select');
    if (dropdown) {
      const options = await p.evaluate((el) => Array.from(el.options).map((o) => o.text), dropdown);
      log('All selects options:', options);
    }
    // Look for the Nhà xe select by its placeholder
    const nhaXeSelect = await p.evaluate(() => {
      const sels = Array.from(document.querySelectorAll('select'));
      const nhaxe = sels.find((s) => Array.from(s.options).some((o) => /Silver|Vận tải|Biển|Đông/.test(o.text)));
      if (!nhaxe) return null;
      return Array.from(nhaxe.options).map((o) => ({ value: o.value, text: o.text }));
    });
    log('Nhà xe options:', nhaXeSelect);

    // Use Nhà xe filter to find a non-SilverSea vendor
    const nhaXeDropdown = await p.$('select');
    // Find the third select (Tìm kiếm, Chiều hàng, Phân xe, Nhà xe — try them all)
    const allSelects = await p.$$('select');
    for (const s of allSelects) {
      const opts = await p.evaluate((el) => Array.from(el.options).map((o) => o.text), s);
      if (opts.some((o) => /Vận tải|Biển|Đông|Hoàng|Long|Phú/.test(o))) {
        // Pick the first non-SilverSea option
        const target = opts.find((o) => !/Silver|—|Tất cả|Chọn/i.test(o) && o.length > 2);
        if (target) {
          const v = await p.evaluate((el, t) => {
            const opt = Array.from(el.options).find((o) => o.text === t);
            return opt ? opt.value : null;
          }, s, target);
          log('Selecting nhà xe:', target, 'value:', v);
          if (v) {
            await s.selectOption(v);
            await p.waitForTimeout(1500);
            await p.screenshot({ path: path.join(SCREEN_DIR, 'dv-10-vendor-filter.png'), fullPage: true });
            const phanBoCells = await p.evaluate(() => {
              const headers = Array.from(document.querySelectorAll('table thead th'));
              const idx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('phân bổ'));
              if (idx < 0) return [];
              return Array.from(document.querySelectorAll('table tbody tr')).slice(0, 4).map((r) => {
                const tds = r.querySelectorAll('td');
                return (tds[idx]?.innerText || '').replace(/\s+/g, ' ').trim();
              });
            });
            log('Vendor Phân bổ cells (after filter):', phanBoCells);
            break;
          }
        }
      }
    }

    // Also test CUS edit on Silver Sea plate by inspecting a row that has SilverSea
    await p.goto(`${baseUrl}/shipments-detail`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1000);
    // Switch to CUS context
    await ctx.close();
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p2 = await ctx2.newPage();
    await login(p2, env.users.cus.username, env.users.cus.password);
    await p2.goto(`${baseUrl}/shipments-detail`, { waitUntil: 'networkidle' });
    await p2.waitForTimeout(1000);
    const dateInputs = await p2.$$('input[type="date"]');
    if (dateInputs.length >= 2) {
      await dateInputs[0].fill('2025-01-01');
      await dateInputs[1].fill('2027-12-31');
      const tatCa = await p2.$('button:has-text("Tất cả ngày")');
      if (tatCa) await tatCa.click();
      await p2.waitForTimeout(1500);
    }
    // Find a row with SilverSea in Phân xe
    const silverRow = await p2.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table thead th'));
      const phanXeIdx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('phân xe'));
      if (phanXeIdx < 0) return null;
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const tds = r.querySelectorAll('td');
        if (tds[phanXeIdx] && (tds[phanXeIdx].innerText || '').toLowerCase().includes('silver')) {
          return { idx: i, phanXeIdx, text: (tds[phanXeIdx].innerText || '').slice(0, 100) };
        }
      }
      return { phanXeIdx, found: false };
    });
    log('SilverSea row in /shipments-detail:', silverRow);
    if (silverRow && silverRow.text) {
      const row = (await p2.$$('table tbody tr'))[silverRow.idx];
      const tds = await row.$$('td');
      const phanXeCell = tds[silverRow.phanXeIdx];
      await phanXeCell.click();
      await p2.waitForTimeout(800);
      await p2.screenshot({ path: path.join(SCREEN_DIR, 'cus-10-silver-phaedit.png'), fullPage: true });
      const editor = await p2.evaluate(() => {
        // Look at any popover / dialog
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [class*="popover"], [class*="Popover"], [class*="dropdown"]'));
        return {
          dialogCount: dialogs.length,
          dialogText: dialogs.map((d) => (d.innerText || '').slice(0, 200)),
          hasInput: !!document.querySelector('input[type="text"]:not([readonly]):not([disabled])'),
          hasCombobox: !!document.querySelector('[role="combobox"]'),
        };
      });
      log('CUS SilverSea phan-xe editor:', editor);
    }
    await ctx2.close();
  } finally {
    await browser.close();
  }
})();
