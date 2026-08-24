// Verify customer feedback L2 - deep pass
// Run: cd frontend && node verify-feedback-l2-r2.mjs
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
fs.mkdirSync(SCREEN_DIR, { recursive: true });

const log = (...a) => console.log(...a);

async function login(page, username, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"], input[type="text"]:not([readonly])', username);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(800);
}

async function shot(page, name) {
  const file = path.join(SCREEN_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  log('📸', file);
}

(async () => {
  const browser = await chromium.launch();
  try {
    // ====== CUS: /shipments-detail with wide date range ======
    log('\n========== CUS /shipments-detail wide date ==========');
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await login(p, env.users.cus.username, env.users.cus.password);

    // /shipments-detail - clear date range
    await p.goto(`${baseUrl}/shipments-detail`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1000);
    // Look for date inputs
    const dateInputs = await p.$$('input[type="date"]');
    if (dateInputs.length >= 2) {
      await dateInputs[0].fill('2025-01-01');
      await dateInputs[1].fill('2027-12-31');
      await p.waitForTimeout(500);
      // Try a "Tất cả ngày" button if present
      const tatCaNgay = await p.$('button:has-text("Tất cả ngày")');
      if (tatCaNgay) await tatCaNgay.click();
      await p.waitForTimeout(1500);
    }
    await shot(p, 'cus-06-shipments-detail-wide');
    const detailCols = await p.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table thead th, [role="columnheader"]'));
      return headers.map((h) => {
        const r = h.getBoundingClientRect();
        return { text: (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim(), width: Math.round(r.width), x: Math.round(r.x) };
      });
    });
    log('Detail columns:', detailCols);
    const firstRow = await p.evaluate(() => {
      const row = document.querySelector('table tbody tr');
      if (!row) return null;
      return Array.from(row.querySelectorAll('td')).map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim());
    });
    log('Detail first row cells:', firstRow);

    // Check vendor cell formatting
    const vendorCells = await p.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      const out = [];
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td'));
        for (const c of cells) {
          const t = (c.innerText || '').replace(/\s+/g, ' ').trim();
          if (t.match(/Công ty|TNHH|Vận tải|Biển Đông|Đại Việt|Hoàng Long|Phú Thọ/)) {
            out.push(t.slice(0, 80));
          }
        }
      }
      return out.slice(0, 8);
    });
    log('Vendor cell examples:', vendorCells);

    // Open Tạo lô mới modal and check column order
    await p.goto(`${baseUrl}/shipments`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1000);
    const createBtn = await p.$('button:has-text("Tạo lô mới")');
    if (createBtn) {
      await createBtn.click();
      await p.waitForTimeout(800);
      await shot(p, 'cus-07-create-modal-r2');
      // Extract order of Hình thức vs Số Bill using bounding rects
      const order = await p.evaluate(() => {
        const labels = Array.from(document.querySelectorAll('label'));
        const find = (kw) => labels.find((l) => (l.innerText || '').includes(kw));
        const hinhThuc = find('Hình thức');
        const soBill = find('Số Bill');
        const soBooking = find('Số Booking');
        return {
          hinhThuc: hinhThuc ? { x: Math.round(hinhThuc.getBoundingClientRect().x), y: Math.round(hinhThuc.getBoundingClientRect().y), text: hinhThuc.innerText } : null,
          soBill: soBill ? { x: Math.round(soBill.getBoundingClientRect().x), y: Math.round(soBill.getBoundingClientRect().y), text: soBill.innerText } : null,
          soBooking: soBooking ? { x: Math.round(soBooking.getBoundingClientRect().x), y: Math.round(soBooking.getBoundingClientRect().y), text: soBooking.innerText } : null,
        };
      });
      log('Modal column order (x = left→right):', order);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(300);
    }

    // Test CUS edit on Phân xe (Silver Sea inline edit) - try with one row
    await p.goto(`${baseUrl}/shipments-detail`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1000);
    const dateInputs2 = await p.$$('input[type="date"]');
    if (dateInputs2.length >= 2) {
      await dateInputs2[0].fill('2025-01-01');
      await dateInputs2[1].fill('2027-12-31');
      await p.waitForTimeout(500);
      const tatCaNgay2 = await p.$('button:has-text("Tất cả ngày")');
      if (tatCaNgay2) await tatCaNgay2.click();
      await p.waitForTimeout(1500);
    }
    // Click on Phân xe cell
    const phanXeCell = await p.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table thead th'));
      const idx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('phân xe'));
      if (idx < 0) return null;
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      for (const r of rows) {
        const cells = r.querySelectorAll('td');
        if (cells[idx] && (cells[idx].innerText || '').toLowerCase().includes('silver')) {
          cells[idx].click();
          return { idx, clicked: true, text: (cells[idx].innerText || '').slice(0, 100) };
        }
      }
      return { idx, clicked: false };
    });
    log('Clicked Phân xe cell:', phanXeCell);
    await p.waitForTimeout(700);
    await shot(p, 'cus-08-phan-xe-editor');
    const editor = await p.evaluate(() => ({
      hasInput: !!document.querySelector('input[type="text"]:not([readonly]):not([disabled])'),
      hasSelect: !!document.querySelector('select:not([disabled])'),
      hasListbox: !!document.querySelector('[role="listbox"]'),
      hasCombobox: !!document.querySelector('[role="combobox"]'),
      dialog: (document.querySelector('[role="dialog"]')?.innerText || '').slice(0, 200),
    }));
    log('Editor opened:', editor);
    await p.keyboard.press('Escape');

    // Item 3: Date filter + Tổng quan hàng hóa
    await p.goto(`${baseUrl}/shipments`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1000);
    // Try filtering by a specific date 21/08/2026 - 21/08/2026
    const dateInputs3 = await p.$$('input[type="date"]');
    if (dateInputs3.length >= 2) {
      await dateInputs3[0].fill('2026-08-21');
      await dateInputs3[1].fill('2026-08-21');
      await p.waitForTimeout(1500);
    }
    await shot(p, 'cus-09-date-filter-21aug');
    const filtered = await p.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      const cells = [];
      for (const r of rows.slice(0, 3)) {
        const tds = Array.from(r.querySelectorAll('td'));
        cells.push(tds.map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 7));
      }
      return cells;
    });
    log('Filtered rows (date 21/08/2026):', filtered);

    // Delete-shipment eligibility text - check shipment detail page
    await p.goto(`${baseUrl}/shipments`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(800);
    const deleteText = await p.evaluate(() => {
      const t = document.body.innerText;
      return {
        hasDeleteHint: t.includes('Xóa'),
        deleteHints: (t.match(/xóa[^.]*\./gi) || []).slice(0, 3),
      };
    });
    log('Delete hints on /shipments:', deleteText);

    await ctx.close();

    // ====== DV: deep inspection ======
    log('\n========== DV deep ==========');
    const ctxDv = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pDv = await ctxDv.newPage();
    await login(pDv, env.users.dieuvan.username, env.users.dieuvan.password);

    await pDv.goto(`${baseUrl}/dispatch`, { waitUntil: 'networkidle' });
    await pDv.waitForTimeout(1500);

    // Check below "Sản lượng" for "Lạch Huyện" block
    const lachHuyen = await pDv.evaluate(() => {
      const t = document.body.innerText;
      // Get the text node right after "Sản lượng"
      const idx = t.indexOf('Sản lượng');
      return {
        hasSanLuong: idx >= 0,
        sliceAfter: idx >= 0 ? t.slice(idx, idx + 800) : null,
        hasLachHuyen: t.includes('Lạch Huyện'),
        hasXeDang: t.includes('xe đang nâng') || t.includes('xe đang hạ'),
        hasBangXe: /Bảng.*xe.*Lạch|Lạch.*Huyện/i.test(t),
      };
    });
    log('Lạch Huyện block:', lachHuyen);

    // Check Cảng nâng cell format - are tên ngắn shown or full names?
    const cangNames = await pDv.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table thead th'));
      const cangNangIdx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('cảng nâng'));
      const cangHaIdx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('cảng hạ'));
      if (cangNangIdx < 0 && cangHaIdx < 0) return null;
      const out = { cangNang: [], cangHa: [] };
      const rows = Array.from(document.querySelectorAll('table tbody tr')).slice(0, 4);
      for (const r of rows) {
        const tds = r.querySelectorAll('td');
        if (cangNangIdx >= 0 && tds[cangNangIdx]) out.cangNang.push((tds[cangNangIdx].innerText || '').replace(/\s+/g, ' ').trim());
        if (cangHaIdx >= 0 && tds[cangHaIdx]) out.cangHa.push((tds[cangHaIdx].innerText || '').replace(/\s+/g, ' ').trim());
      }
      return out;
    });
    log('Cảng nâng/hạ cell samples:', cangNames);

    // Check Phân bổ nhà xe vendor format - is tên ngắn or full shown?
    const phanBo = await pDv.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table thead th'));
      const idx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('phân bổ'));
      if (idx < 0) return null;
      const out = [];
      const rows = Array.from(document.querySelectorAll('table tbody tr')).slice(0, 4);
      for (const r of rows) {
        const tds = r.querySelectorAll('td');
        if (tds[idx]) out.push((tds[idx].innerText || '').replace(/\s+/g, ' ').trim());
      }
      return out;
    });
    log('Phân bổ nhà xe cells:', phanBo);

    // Item 19: date filter for /dispatch
    const dateInputsDv = await pDv.$$('input[type="date"]');
    log('Date input count on /dispatch =', dateInputsDv.length);
    if (dateInputsDv.length >= 2) {
      await dateInputsDv[0].fill('2026-08-21');
      await dateInputsDv[1].fill('2026-08-21');
      await pDv.waitForTimeout(1500);
    }
    await shot(pDv, 'dv-04-dispatch-date-filter');
    const dvFiltered = await pDv.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr')).slice(0, 3);
      return rows.map((r) => Array.from(r.querySelectorAll('td')).map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 8));
    });
    log('DV filtered rows (21/08):', dvFiltered);

    await ctxDv.close();
  } finally {
    await browser.close();
  }
})();
