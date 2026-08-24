// Verify customer feedback L2 (24/08/2026) - CUS & DIEUVAN
// Run: cd frontend && node verify-feedback-l2.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const credPath = path.resolve('../prompts/qa-credentials.yaml');
// Parse just the `local:` block to avoid unrelated YAML parse issues later in the file
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

async function inspectGridColumns(page) {
  // Try to extract column headers + widths from the data grid header row.
  return page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('table thead th, [role="columnheader"]'));
    if (headers.length === 0) return { headers: [], widths: [] };
    const out = headers.map((h) => {
      const rect = h.getBoundingClientRect();
      return {
        text: (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim(),
        width: Math.round(rect.width),
        x: Math.round(rect.x),
      };
    });
    return { headers: out };
  });
}

async function inspectColumnOrder(page) {
  return page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('table thead th, [role="columnheader"]'));
    return headers.map((h) => (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  });
}

async function shot(page, name) {
  const file = path.join(SCREEN_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  log('📸', file);
}

(async () => {
  const browser = await chromium.launch();
  const findings = [];

  try {
    // ====== CUS role ======
    log('\n========== CUS ROLE ==========');
    const ctxCus = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pCus = await ctxCus.newPage();

    pCus.on('pageerror', (e) => findings.push({ role: 'CUS', kind: 'pageerror', msg: e.message }));
    pCus.on('console', (m) => {
      if (m.type() === 'error') findings.push({ role: 'CUS', kind: 'console.error', msg: m.text() });
    });

    await login(pCus, env.users.cus.username, env.users.cus.password);
    log('after login URL:', pCus.url());

    // ---- /shipments ----
    await pCus.goto(`${baseUrl}/shipments`, { waitUntil: 'networkidle' });
    await pCus.waitForTimeout(1500);
    await shot(pCus, 'cus-01-shipments-overview');
    const shipmentsCols = await inspectColumnOrder(pCus);
    const shipmentsDetail = await inspectGridColumns(pCus);
    log('CUS /shipments columns:', shipmentsCols);
    log('CUS /shipments widths:', shipmentsDetail.headers?.map(h => `${h.text}=${h.width}px`));

    // --- TỔNG QUAN LÔ HÀNG items ---
    // 1. Cột "Phân loại & Hãng tàu" thu nhỏ 2/3
    const phanLoai = shipmentsDetail.headers?.find((h) => h.text.toLowerCase().includes('phân loại') || h.text.toLowerCase().includes('hãng tàu'));
    const tongQuan = shipmentsDetail.headers?.find((h) => h.text.toLowerCase().includes('tổng quan'));
    log('Item1 (Phân loại & Hãng tàu) width=', phanLoai?.width);
    log('Item2 (Tổng quan hàng hóa) width=', tongQuan?.width);

    // --- Tạo lô mới modal ---
    // 5. Đổi cột "hình thức xnk" - "số bill/book"
    log('\n--- Create Shipment modal ---');
    const createBtn = await pCus.$('button:has-text("TẠO LÔ MỚI"), button:has-text("Tạo lô mới"), button:has-text("+ TẠO")');
    if (createBtn) {
      await createBtn.click();
      await pCus.waitForTimeout(800);
      await shot(pCus, 'cus-02-create-shipment-modal');
      // Inspect label order in first block
      const labels = await pCus.evaluate(() => {
        // Get the labels in form-block 1
        const blocks = Array.from(document.querySelectorAll('label, .label, [class*="label"]'));
        return blocks
          .map((l) => (l.innerText || l.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 12);
      });
      log('Modal labels (first 12):', labels);
      // Look at the order of Hình thức xnk vs Số bill in the DOM
      const order = await pCus.evaluate(() => {
        const html = document.body.innerText;
        const idxHinhThuc = html.indexOf('Hình thức');
        const idxSoBill = html.indexOf('Số Bill');
        const idxSoBooking = html.indexOf('Số Booking');
        return { idxHinhThuc, idxSoBill, idxSoBooking };
      });
      log('Order in body: Hình thức=%s, Số Bill=%s, Số Booking=%s', order.idxHinhThuc, order.idxSoBill, order.idxSoBooking);
      await pCus.keyboard.press('Escape');
      await pCus.waitForTimeout(300);
    } else {
      log('!! Create button not found');
    }

    // ---- /shipments-detail ----
    await pCus.goto(`${baseUrl}/shipments-detail`, { waitUntil: 'networkidle' });
    await pCus.waitForTimeout(1500);
    await shot(pCus, 'cus-03-shipments-detail');
    const detailCols = await inspectColumnOrder(pCus);
    const detailDetail = await inspectGridColumns(pCus);
    log('CUS /shipments-detail columns:', detailCols);
    log('CUS /shipments-detail widths:', detailDetail.headers?.map(h => `${h.text}=${h.width}px`));

    // Items 6-13 of CHI TIẾT LÔ HÀNG:
    const chungTuDetail = detailDetail.headers?.find((h) => h.text.toLowerCase().includes('chứng từ'));
    const thongSoCont = detailDetail.headers?.find((h) => h.text.toLowerCase().includes('thông số') || h.text.toLowerCase().includes('container'));
    const ghiChuDetail = detailDetail.headers?.find((h) => h.text.toLowerCase().includes('ghi chú'));
    const trangThaiDetail = detailDetail.headers?.find((h) => h.text.toLowerCase().includes('trạng thái'));
    const phanXe = detailDetail.headers?.find((h) => h.text.toLowerCase().includes('phân xe'));
    const diaDiem = detailDetail.headers?.find((h) => h.text.toLowerCase().includes('địa điểm'));
    log('Item6 (Chứng từ & Hãng tàu / Tuyến đường) width=%s', chungTuDetail?.width);
    log('Item7 (Thông số container) width=%s', thongSoCont?.width);
    log('Item8 Ghi chú idx=%s | Trạng thái idx=%s', ghiChuDetail?.x, trangThaiDetail?.x);
    log('Item10 (Địa điểm nâng/hạ) width=%s', diaDiem?.width);
    log('Item13 (Phân xe) width=%s', phanXe?.width);

    // Item 12: tên ngắn nhà xe ngoài - check cells
    const vendorShortName = await pCus.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('table tbody tr td, [role="row"] [role="gridcell"]'));
      const vendorCells = cells
        .map((c) => (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t.includes('Công ty') || t.includes('TNHH') || t.includes('Vận tải'));
      return vendorCells.slice(0, 6);
    });
    log('Item12 (Tên nhà xe ngoài in grid):', vendorShortName);

    // Item 11: CUS edit Silver Sea plate - check inline editor availability
    // Take a row and try opening inline edit on Phân xe
    let canEditSS = 'not-tested';
    const phanXeColIdx = detailDetail.headers?.findIndex((h) => h.text.toLowerCase().includes('phân xe'));
    if (phanXeColIdx >= 0) {
      const firstRow = await pCus.$('table tbody tr');
      if (firstRow) {
        const phanXeCell = await firstRow.$$('td');
        if (phanXeCell[phanXeColIdx]) {
          await phanXeCell[phanXeColIdx].click();
          await pCus.waitForTimeout(500);
          await shot(pCus, 'cus-04-shipment-detail-edit');
          canEditSS = await pCus.evaluate(() => {
            return {
              hasDropdown: !!document.querySelector('[role="listbox"], select, input[role="combobox"]'),
              hasInput: !!document.querySelector('input[type="text"]:not([readonly]):not([disabled])'),
              dialogText: (document.querySelector('[role="dialog"]')?.innerText || '').slice(0, 200),
            };
          });
          log('Item11 (Phân xe editor on detail):', canEditSS);
          await pCus.keyboard.press('Escape');
        }
      }
    }

    // Item 3: Tìm kiếm theo ngày - filter cột Tổng quan hàng hóa
    log('\n--- /shipments date filter test ---');
    await pCus.goto(`${baseUrl}/shipments`, { waitUntil: 'networkidle' });
    await pCus.waitForTimeout(1000);
    // Try to find date inputs in filter area
    const dateInputCount = await pCus.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="date"], input[placeholder*="/"], input[placeholder*="ngày" i]'));
      return inputs.length;
    });
    log('Date input count on /shipments:', dateInputCount);
    // Just snapshot of unfiltered view
    await shot(pCus, 'cus-05-shipments-unfiltered');

    await ctxCus.close();

    // ====== DIEUVAN role ======
    log('\n========== DIEUVAN ROLE ==========');
    const ctxDv = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pDv = await ctxDv.newPage();

    pDv.on('pageerror', (e) => findings.push({ role: 'DIEUVAN', kind: 'pageerror', msg: e.message }));
    pDv.on('console', (m) => {
      if (m.type() === 'error') findings.push({ role: 'DIEUVAN', kind: 'console.error', msg: m.text() });
    });

    await login(pDv, env.users.dieuvan.username, env.users.dieuvan.password);
    log('after login URL:', pDv.url());

    // ---- /dispatch ----
    await pDv.goto(`${baseUrl}/dispatch`, { waitUntil: 'networkidle' });
    await pDv.waitForTimeout(1500);
    await shot(pDv, 'dv-01-dispatch-overview');
    const dispatchCols = await inspectColumnOrder(pDv);
    const dispatchDetail = await inspectGridColumns(pDv);
    log('DV /dispatch columns:', dispatchCols);
    log('DV /dispatch widths:', dispatchDetail.headers?.map(h => `${h.text}=${h.width}px`));

    // Item 15: Khách hàng & Nhà máy contains Khách hàng / Nhà máy / Bill
    const khachHangCol = dispatchDetail.headers?.find((h) => h.text.toLowerCase().includes('khách hàng'));
    log('Item15 (Khách hàng & Nhà máy col) header text=%s width=%s', khachHangCol?.text, khachHangCol?.width);
    // Check first row cell content
    const firstRowContent = await pDv.evaluate(() => {
      const row = document.querySelector('table tbody tr');
      if (!row) return null;
      return Array.from(row.querySelectorAll('td')).map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 8);
    });
    log('First /dispatch row cells:', firstRowContent);

    // Item 16: Cột "Tuyến đường & Hãng Tàu" - đổi tên
    const tuyenDuongCol = dispatchDetail.headers?.find((h) => h.text.toLowerCase().includes('tuyến đường') || h.text.toLowerCase().includes('chứng từ'));
    log('Item16 (Tuyến đường & Hãng Tàu col) header=%s', tuyenDuongCol?.text);

    // Item 17: Cảng nâng / cảng hạ - tên ngắn
    const cangNang = dispatchDetail.headers?.find((h) => h.text.toLowerCase().includes('cảng nâng') || h.text.toLowerCase().includes('nâng'));
    const cangHa = dispatchDetail.headers?.find((h) => h.text.toLowerCase().includes('cảng hạ') || h.text.toLowerCase().includes('hạ'));
    log('Item17 (Cảng nâng) header=%s | (Cảng hạ) header=%s', cangNang?.text, cangHa?.text);
    // Sample cảng nâng cell content
    if (cangNang) {
      const cangNangIdx = dispatchDetail.headers.findIndex((h) => h.text === cangNang.text);
      const cangNangCell = await pDv.evaluate((idx) => {
        const row = document.querySelector('table tbody tr');
        if (!row) return null;
        const cell = row.querySelectorAll('td')[idx];
        return (cell?.innerText || '').replace(/\s+/g, ' ').trim();
      }, cangNangIdx);
      log('Item17 sample cảng nâng cell:', cangNangCell);
    }

    // Item 18: GHI CHÚ - dispatcher can edit
    const ghiChuDv = dispatchDetail.headers?.find((h) => h.text.toLowerCase().includes('ghi chú'));
    log('Item18 (Ghi chú) header=%s width=%s', ghiChuDv?.text, ghiChuDv?.width);
    if (ghiChuDv) {
      const ghiChuIdx = dispatchDetail.headers.findIndex((h) => h.text === ghiChuDv.text);
      const firstRow = await pDv.$('table tbody tr');
      if (firstRow) {
        const cells = await firstRow.$$('td');
        if (cells[ghiChuIdx]) {
          await cells[ghiChuIdx].click();
          await pDv.waitForTimeout(500);
          const editor = await pDv.evaluate(() => ({
            hasInput: !!document.querySelector('input[type="text"]:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled])'),
            hasDropdown: !!document.querySelector('[role="listbox"]'),
          }));
          log('Item18 (Ghi chú editor):', editor);
          await shot(pDv, 'dv-02-dispatch-ghichu-editor');
          await pDv.keyboard.press('Escape');
        }
      }
    }

    // Item 14: Bảng dưới "Sản lượng" thể hiện xe Silver Sea tại Lạch Huyện
    const hasSanLuong = await pDv.evaluate(() => {
      const t = document.body.innerText;
      return {
        hasSanLuong: t.includes('Sản lượng') || t.includes('sản lượng'),
        hasLachHuyen: t.includes('Lạch Huyện') || t.includes('Lach Huyen'),
        hasXeDangNangHa: t.includes('xe đang') || t.includes('đang nâng'),
      };
    });
    log('Item14 (Sản lượng / Lạch Huyện block):', hasSanLuong);

    // Item 19: Tìm kiếm theo ngày - cont chạy trong ngày
    const dateInputsDv = await pDv.evaluate(() => document.querySelectorAll('input[type="date"]').length);
    log('Item19: date input count on /dispatch =', dateInputsDv);

    // ---- /dispatch-detail ----
    await pDv.goto(`${baseUrl}/dispatch-detail`, { waitUntil: 'networkidle' });
    await pDv.waitForTimeout(1500);
    await shot(pDv, 'dv-03-dispatch-detail');
    const ddCols = await inspectColumnOrder(pDv);
    const ddDetail = await inspectGridColumns(pDv);
    log('DV /dispatch-detail columns:', ddCols);
    log('DV /dispatch-detail widths:', ddDetail.headers?.map(h => `${h.text}=${h.width}px`));

    // Item 20: KHÁCH HÀNG & LỘ TRÌNH contains Khách hàng / Nhà máy / Bill
    const khachHangLoiTrinh = ddDetail.headers?.find((h) => h.text.toLowerCase().includes('khách hàng') && h.text.toLowerCase().includes('lộ trình'));
    log('Item20 (Khách hàng & Lộ trình col) header=%s', khachHangLoiTrinh?.text);

    // Item 21: Chứng từ -> Tuyến đường
    const chungTuDd = ddDetail.headers?.find((h) => h.text.toLowerCase().includes('chứng từ'));
    const tuyenDuongDd = ddDetail.headers?.find((h) => h.text.toLowerCase().includes('tuyến đường'));
    log('Item21 (Chứng từ / Tuyến đường) chứng từ=%s, tuyến đường=%s', chungTuDd?.text, tuyenDuongDd?.text);

    // Item 22: Ghi chú move to end
    const ghiChuDd = ddDetail.headers?.find((h) => h.text.toLowerCase().includes('ghi chú'));
    const lastCol = ddDetail.headers?.[ddDetail.headers.length - 1];
    log('Item22 (Ghi chú position) ghiChu=%s, lastCol=%s', ghiChuDd?.text, lastCol?.text);

    // Dump first row of dispatch-detail
    const ddFirstRow = await pDv.evaluate(() => {
      const row = document.querySelector('table tbody tr');
      if (!row) return null;
      return Array.from(row.querySelectorAll('td')).map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 8);
    });
    log('First /dispatch-detail row cells:', ddFirstRow);

    await ctxDv.close();
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(SCREEN_DIR, '..', 'findings.json'), JSON.stringify(findings, null, 2));
  log('\nWrote findings.json, count=', findings.length);
})();
