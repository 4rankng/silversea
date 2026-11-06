import puppeteer from 'puppeteer';
import { mkdirSync, appendFileSync } from 'node:fs';

const OUT = new URL('.', import.meta.url).pathname;
const BASE = process.env.CAPTURE_BASE || 'http://localhost:7191';
mkdirSync(OUT, { recursive: true });
const log = (line) => { console.log(line); appendFileSync(`${OUT}capture.log`, `${line}\n`); };

let failed = false;
const assert = (cond, label) => {
  log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failed = true;
  return cond;
};

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  log(`Navigating to ${BASE}/login`);
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('input', { timeout: 15000 });
  await page.type('input:not([type="password"])', 'dieuvan');
  await page.type('input[type="password"]', 'Abc123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"], button:not([type])'),
  ]);
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 });
  log(`login ok → ${await page.evaluate(() => location.pathname)}`);

  // ──────────────────────────────────────────────────────────────────────────
  // 1. SIL-711: /dispatch
  // - Cột "Chọn lô" mặc định ẨN
  // - Cột "Phân bổ nhà xe" LUÔN HIỆN
  // - Khi bật [Gộp hàng], cột "Chọn lô" HIỆN
  // ──────────────────────────────────────────────────────────────────────────
  log('Testing SIL-711 on /dispatch...');
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.master-plan-grid', { timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1000));

  const getMasterHeaders = () => page.evaluate(() => {
    return Array.from(document.querySelectorAll('.master-plan-grid thead th')).map(th => th.textContent.trim());
  });

  const headersDefault = await getMasterHeaders();
  log(`Default /dispatch headers: ${JSON.stringify(headersDefault)}`);
  const hasPhanBoDefault = headersDefault.some(h => h.includes('Phân bổ') || h.includes('nhà xe'));
  const hasChonLoDefault = headersDefault.some(h => h.includes('Chọn lô'));
  assert(hasPhanBoDefault, 'SIL-711: Cột "Phân bổ nhà xe" LUÔN HIỆN ở trạng thái mặc định');
  assert(!hasChonLoDefault, 'SIL-711: Cột "Chọn lô" mặc định ẨN khi chưa bật Gộp hàng');

  await page.screenshot({ path: `${OUT}sil-711-dispatch-default-1440.png` });

  // Toggle [Gộp hàng]
  const gopHangBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent.includes('Gộp hàng') || b.textContent.includes('Gom hàng'));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  log(`Clicked [Gộp hàng] button: ${gopHangBtn}`);
  await new Promise(r => setTimeout(r, 1000));

  const headersGrouped = await getMasterHeaders();
  log(`Grouped /dispatch headers: ${JSON.stringify(headersGrouped)}`);
  const hasChonLoGrouped = headersGrouped.some(h => h.includes('Chọn lô'));
  assert(hasChonLoGrouped, 'SIL-711: Cột "Chọn lô" HIỆN khi bật [Gộp hàng]');
  await page.screenshot({ path: `${OUT}sil-711-dispatch-grouped-1440.png` });

  // Mobile viewport 390
  await page.setViewport({ width: 390, height: 844 });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: `${OUT}sil-711-dispatch-390.png` });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. SIL-707: /dispatch Popover chọn nhà xe nội bộ
  // ──────────────────────────────────────────────────────────────────────────
  log('Testing SIL-707 Popover positioning & backdrop on /dispatch...');
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  // Find a cell in "Phân bổ nhà xe" column and click it to open allocation popover
  const popoverOpened = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('td'));
    const allocCell = cells.find(c => c.textContent.includes('Chưa chọn') || c.textContent.includes('SilverSea') || c.className.includes('carrier'));
    if (allocCell) {
      allocCell.click();
      return true;
    }
    return false;
  });
  log(`Allocation popover triggered: ${popoverOpened}`);
  await new Promise(r => setTimeout(r, 800));

  const popoverCheck = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"], .ds-modal__surface');
    if (!dialog) return { found: false };
    const rect = dialog.getBoundingClientRect();
    const zIndex = getComputedStyle(dialog).zIndex;
    return {
      found: true,
      zIndex,
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
  });
  log(`SIL-707 Popover Check: ${JSON.stringify(popoverCheck)}`);
  assert(popoverCheck.found, 'SIL-707: Popover phân bổ nhà xe mở thành công');
  await page.screenshot({ path: `${OUT}sil-707-dispatch-popover-1440.png` });

  // Test backdrop dismissal
  const dismissed = await page.evaluate(() => {
    const backdrop = document.querySelector('.ds-modal__backdrop') || document.querySelector('.ds-modal');
    if (backdrop) {
      backdrop.click();
      return true;
    }
    return false;
  });
  log(`SIL-707 Clicked backdrop: ${dismissed}`);
  await new Promise(r => setTimeout(r, 800));
  const popoverClosed = await page.evaluate(() => !document.querySelector('.ds-modal__surface'));
  assert(popoverClosed, 'SIL-707: Click backdrop đóng popover (backdropDismiss), bảo đảm nhìn thấy dòng bên dưới');
  await page.screenshot({ path: `${OUT}sil-707-dispatch-after-dismiss-1440.png` });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. SIL-713: /dispatch-detail - Cột THAO TÁC xếp dọc 44-48px
  // ──────────────────────────────────────────────────────────────────────────
  log('Testing SIL-713 on /dispatch-detail...');
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.detailed-plan-grid, table', { timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));

  const actionsColInfo = await page.evaluate(() => {
    const actionTh = document.querySelector('th.detailed-plan-grid__th--actions');
    const actionCells = Array.from(document.querySelectorAll('td.detailed-plan-grid__cell--actions'));
    const firstCell = actionCells[0];
    const actionsWrapper = firstCell?.querySelector('.detailed-plan-grid__row-actions');

    let thWidth = actionTh ? Math.round(actionTh.getBoundingClientRect().width) : null;
    let cellWidth = firstCell ? Math.round(firstCell.getBoundingClientRect().width) : null;
    let flexDirection = actionsWrapper ? getComputedStyle(actionsWrapper).flexDirection : null;

    return {
      thFound: !!actionTh,
      thWidth,
      cellFound: !!firstCell,
      cellWidth,
      flexDirection,
    };
  });
  log(`SIL-713 Actions column: ${JSON.stringify(actionsColInfo)}`);
  assert(actionsColInfo.thWidth != null && actionsColInfo.thWidth >= 44 && actionsColInfo.thWidth <= 52, `SIL-713: Cột Thao tác width ~44-48px (actual: ${actionsColInfo.thWidth}px)`);
  assert(actionsColInfo.flexDirection === 'column', 'SIL-713: Thao tác xếp dọc (flex-direction: column)');

  await page.screenshot({ path: `${OUT}sil-713-dispatch-detail-vertical-actions-1440.png` });

  // Mobile viewport 390
  await page.setViewport({ width: 390, height: 844 });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: `${OUT}sil-713-dispatch-detail-390.png` });
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise(r => setTimeout(r, 800));

  // ──────────────────────────────────────────────────────────────────────────
  // 4. SIL-712: Check Loại hàng filter
  // ──────────────────────────────────────────────────────────────────────────
  log('Testing SIL-712 Loại hàng filter...');
  // Open Bộ lọc dialog
  await page.evaluate(() => {
    const trigger = document.querySelector('.filter-dropdown__trigger');
    if (trigger) trigger.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  const filterDialogInfo = await page.evaluate(() => {
    const dialog = document.querySelector('.filter-dropdown__popover');
    if (!dialog) return { found: false };
    const text = dialog.textContent || '';
    const hasLoaiHang = text.includes('Loại hàng');
    return {
      found: true,
      hasLoaiHang,
      dialogText: text.slice(0, 300),
    };
  });
  log(`SIL-712 Filter Dialog Info: ${JSON.stringify(filterDialogInfo)}`);
  assert(filterDialogInfo.hasLoaiHang, 'SIL-712: Bộ lọc chứa trường "Loại hàng"');

  await page.screenshot({ path: `${OUT}sil-712-dispatch-detail-filter-dialog-1440.png` });

  // Close Bộ lọc
  await page.evaluate(() => {
    const applyBtn = document.querySelector('.filter-dropdown__apply');
    if (applyBtn) applyBtn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // ──────────────────────────────────────────────────────────────────────────
  // 5. SIL-708: Verify "Hủy phân xe" presence in row menu
  // ──────────────────────────────────────────────────────────────────────────
  log('Testing SIL-708 "Hủy phân xe" menu option...');
  // Search for SIL676QA (a shipment with an assigned live trip)
  await page.type('input[placeholder*="Bill, Cont"]', 'SIL676QA');
  await new Promise(r => setTimeout(r, 1500));

  // Click the row menu trigger
  const menuOpened = await page.evaluate(() => {
    const trigger = document.querySelector('button.dispatch-row-menu__trigger');
    if (trigger) {
      trigger.click();
      return true;
    }
    return false;
  });
  log(`SIL-708 Row menu trigger clicked: ${menuOpened}`);
  await new Promise(r => setTimeout(r, 1000));

  const menuItems = await page.evaluate(() => {
    const menu = document.querySelector('.dispatch-row-menu__list, [role="menu"]');
    if (!menu) return [];
    const items = Array.from(menu.querySelectorAll('[role="menuitem"], button'));
    return items.map(i => i.textContent?.trim()).filter(Boolean);
  });
  log(`SIL-708 Menu items: ${JSON.stringify(menuItems)}`);
  const hasHuyPhanXe = menuItems.some(m => m.includes('Hủy phân xe'));
  const hasPhanXeLai = menuItems.some(m => m.includes('Phân xe lại'));
  assert(hasHuyPhanXe, 'SIL-708: Menu chứa tùy chọn "Hủy phân xe"');
  assert(!hasPhanXeLai, 'SIL-708: Nút "Phân xe lại" ĐÃ ĐƯỢC GỠ BỎ hoàn toàn');

  await page.screenshot({ path: `${OUT}sil-708-dispatch-detail-cancel-menu-1440.png` });

  // Click "Hủy phân xe" to verify confirm dialog
  const cancelClicked = await page.evaluate(() => {
    const menu = document.querySelector('.dispatch-row-menu__list, [role="menu"]');
    if (!menu) return false;
    const items = Array.from(menu.querySelectorAll('[role="menuitem"], button'));
    const btn = items.find(i => i.textContent?.includes('Hủy phân xe'));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  log(`SIL-708 Clicked "Hủy phân xe": ${cancelClicked}`);
  await new Promise(r => setTimeout(r, 800));

  const confirmDialogInfo = await page.evaluate(() => {
    const modal = document.querySelector('[role="dialog"], .confirm-dialog');
    if (!modal) return { found: false };
    const text = modal.textContent || '';
    return {
      found: true,
      hasCancelConfirmText: text.includes('Hủy phân xe') && text.includes('trạng thái Chưa phân xe'),
      textSnippet: text.slice(0, 200),
    };
  });
  log(`SIL-708 Confirm Dialog: ${JSON.stringify(confirmDialogInfo)}`);
  assert(confirmDialogInfo.hasCancelConfirmText, 'SIL-708: Hộp thoại xác nhận Hủy phân xe xuất hiện');
  await page.screenshot({ path: `${OUT}sil-708-dispatch-detail-confirm-dialog-1440.png` });

  log(`ALL CHECKS COMPLETED: failed=${failed}`);
  if (failed) {
    process.exitCode = 1;
  }
} catch (err) {
  log(`Error driving UI: ${err.message}\n${err.stack}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
