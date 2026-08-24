// Verify customer feedback L2 - Item 3 & 17 deep check (FCL, cảng tên ngắn)
// Run: cd frontend && node verify-feedback-l2-r3.mjs
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
  await page.screenshot({ path: path.join(SCREEN_DIR, `${name}.png`), fullPage: true });
}

(async () => {
  const browser = await chromium.launch();
  try {
    // Find a FCL row with multi-cont multi-date to test Item 3
    log('========== Finding FCL multi-cont multi-date for Item 3 ==========');
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    await login(p, env.users.dieuvan.username, env.users.dieuvan.password);

    await p.goto(`${baseUrl}/dispatch`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);

    // Wide date range to find FCL
    const dateInputs = await p.$$('input[type="date"]');
    if (dateInputs.length >= 2) {
      await dateInputs[0].fill('2025-01-01');
      await dateInputs[1].fill('2027-12-31');
      const tatCa = await p.$('button:has-text("Tất cả các ngày")');
      if (tatCa) await tatCa.click();
      await p.waitForTimeout(1500);
    }
    await shot(p, 'dv-05-dispatch-wide');

    // Look for FCL entries (not LCL)
    const fclSamples = await p.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table thead th'));
      const cangNangIdx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('cảng nâng'));
      const cangHaIdx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('cảng hạ'));
      const tongQuanIdx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('tổng quan'));
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      const out = [];
      for (const r of rows) {
        const tds = r.querySelectorAll('td');
        const cangNang = cangNangIdx >= 0 ? (tds[cangNangIdx]?.innerText || '').replace(/\s+/g, ' ').trim() : '';
        const cangHa = cangHaIdx >= 0 ? (tds[cangHaIdx]?.innerText || '').replace(/\s+/g, ' ').trim() : '';
        const tongQuan = tongQuanIdx >= 0 ? (tds[tongQuanIdx]?.innerText || '').replace(/\s+/g, ' ').trim() : '';
        if (cangNang.includes('Cảng') && tongQuan.match(/\d+\s*x\s*\d/)) {
          out.push({ cangNang, cangHa, tongQuan });
        }
        if (out.length >= 6) break;
      }
      return out;
    });
    log('FCL samples (Cảng nâng / Cảng hạ / Tổng quan):', fclSamples);

    // Now filter 21/08 and check if values are day-specific
    if (dateInputs.length >= 2) {
      await dateInputs[0].fill('2026-08-21');
      await dateInputs[1].fill('2026-08-21');
      const tatCa2 = await p.$('button:has-text("Tất cả các ngày")');
      if (tatCa2) await tatCa2.click();
      await p.waitForTimeout(1500);
    }
    await shot(p, 'dv-06-dispatch-21aug-fcl');

    const fclFiltered = await p.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table thead th'));
      const cangNangIdx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('cảng nâng'));
      const cangHaIdx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('cảng hạ'));
      const tongQuanIdx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('tổng quan'));
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      const out = [];
      for (const r of rows) {
        const tds = r.querySelectorAll('td');
        const cangNang = cangNangIdx >= 0 ? (tds[cangNangIdx]?.innerText || '').replace(/\s+/g, ' ').trim() : '';
        const cangHa = cangHaIdx >= 0 ? (tds[cangHaIdx]?.innerText || '').replace(/\s+/g, ' ').trim() : '';
        const tongQuan = tongQuanIdx >= 0 ? (tds[tongQuanIdx]?.innerText || '').replace(/\s+/g, ' ').trim() : '';
        if (cangNang !== '—' || tongQuan !== '—') {
          out.push({ cangNang, cangHa, tongQuan });
        }
        if (out.length >= 6) break;
      }
      return out;
    });
    log('FCL on 21/08/2026:', fclFiltered);

    // Scroll to bottom and check for Lạch Huyện block
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(500);
    await shot(p, 'dv-07-dispatch-scrolled');

    // Look at the Lạch Huyện area more carefully - find any elements with text containing 'Lạch' or 'Huyện'
    const allText = await p.evaluate(() => {
      const all = document.body.innerText;
      return {
        lachIdx: all.indexOf('Lạch'),
        huyenIdx: all.indexOf('Huyện'),
        lachHuyIdx: all.indexOf('Lạch Huyện'),
        xeDangIdx: all.indexOf('xe đang'),
        xeSilverSea: all.indexOf('SilverSea'),
        sanLuongText: all.match(/Sản lượng[\s\S]{0,200}/)?.[0],
      };
    });
    log('Lạch Huyện search:', allText);

    // Test inline edit on Ghi chú as DIEUVAN
    const ghiChuHeader = await p.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table thead th'));
      const idx = headers.findIndex((h) => (h.innerText || '').toLowerCase().includes('ghi chú'));
      return idx;
    });
    log('Ghi chú col idx on /dispatch:', ghiChuHeader);
    if (ghiChuHeader >= 0) {
      const row = await p.$('table tbody tr');
      if (row) {
        const tds = await row.$$('td');
        if (tds[ghiChuHeader]) {
          await tds[ghiChuHeader].click();
          await p.waitForTimeout(500);
          await shot(p, 'dv-08-dispatch-ghichu-edit');
          const editorState = await p.evaluate(() => ({
            hasTextarea: !!document.querySelector('textarea:not([readonly]):not([disabled])'),
            hasInput: !!document.querySelector('input[type="text"]:not([readonly]):not([disabled])'),
            dialogText: (document.querySelector('[role="dialog"], .modal, [class*="modal"], [class*="popover"]')?.innerText || '').slice(0, 200),
          }));
          log('Ghi chú editor state:', editorState);
          await p.keyboard.press('Escape');
        }
      }
    }

    // /dispatch-detail - check first row in detail
    await p.goto(`${baseUrl}/dispatch-detail`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const dateInputsDd = await p.$$('input[type="date"]');
    if (dateInputsDd.length >= 1) {
      const tatCa = await p.$('button:has-text("Tất cả các ngày")');
      if (tatCa) await tatCa.click();
      await p.waitForTimeout(1000);
    }
    const detailCells = await p.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('table thead th'));
      const out = { headers: [] };
      headers.forEach((h, i) => {
        out.headers.push({ idx: i, text: (h.innerText || '').replace(/\s+/g, ' ').trim() });
      });
      const row = document.querySelector('table tbody tr');
      if (row) {
        const tds = row.querySelectorAll('td');
        out.cells = Array.from(tds).map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim());
      }
      return out;
    });
    log('dispatch-detail headers:', detailCells.headers);
    log('dispatch-detail first row cells:', detailCells.cells);
    await shot(p, 'dv-09-dispatch-detail-wide');

    // Test Item 22: Ghi chú position
    const ghiChuPos = detailCells.headers.findIndex((h) => h.text.toLowerCase().includes('ghi chú'));
    const lastHeader = detailCells.headers[detailCells.headers.length - 1];
    log('Item22: ghiChu idx=%s, last header text=%s', ghiChuPos, lastHeader?.text);

    // Test Item 21: Chứng từ → Tuyến đường
    const chungTuPos = detailCells.headers.findIndex((h) => h.text.toLowerCase().includes('chứng từ'));
    const tuyenDuongPos = detailCells.headers.findIndex((h) => h.text.toLowerCase().includes('tuyến đường'));
    log('Item21: chứng từ idx=%s, tuyến đường idx=%s', chungTuPos, tuyenDuongPos);

    // Test Item 20: Khách hàng & Lộ trình content (should show KH / Nhà máy / Bill)
    const khachHangPos = detailCells.headers.findIndex((h) => h.text.toLowerCase().includes('khách hàng') && h.text.toLowerCase().includes('lộ trình'));
    log('Item20: khach hang & lộ trình idx=%s, cell=%s', khachHangPos, detailCells.cells?.[khachHangPos]);

    await ctx.close();
  } finally {
    await browser.close();
  }
})();
