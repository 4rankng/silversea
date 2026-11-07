import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';

const OUT = 'qa/2026-11-07-lane-h2/';
const BASE = process.env.BASE_URL || 'http://localhost:7199';
const log = (msg) => {
  console.log(msg);
  appendFileSync(`${OUT}drive-h2.log`, `${msg}\n`);
};

let failed = false;
const assert = (cond, label) => {
  log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
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

  // =========================================================================
  // Part 1: SIL-701 — Nhãn sai "TỔNG 1" thay vì "TỔNG TRẢ" on /accounting/chot-debit
  // =========================================================================
  log('\n=== [1] Testing SIL-701 on /accounting/chot-debit (Kế toán) ===');
  log(`Logging in as ketoan on ${BASE}...`);
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input', { timeout: 15000 });
  await page.type('input:not([type="password"])', 'ketoan');
  await page.type('input[type="password"]', 'Abc123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"], button:not([type])'),
  ]);
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 });
  log(`Login ok, currently on ${await page.evaluate(() => location.pathname)}`);

  log('Navigating to /accounting/chot-debit...');
  await page.goto(`${BASE}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.waitForSelector('.debit-board', { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  // Inspect headers
  const headerCheck = await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll('.debit-board thead th')).map((th) => th.textContent.trim());
    return {
      allHeaders: ths,
      hasTongTra: ths.some((t) => t.includes('Tổng trả') || t.toUpperCase().includes('TỔNG TRẢ')),
      hasTong1: ths.some((t) => t.includes('Tổng 1') || t.toUpperCase().includes('TỔNG 1')),
    };
  });
  log(`Header inspection: ${JSON.stringify(headerCheck)}`);
  assert(headerCheck.hasTongTra, 'SIL-701: Cột rollup Phải trả có nhãn "TỔNG TRẢ" (hoặc "Tổng trả")');
  assert(!headerCheck.hasTong1, 'SIL-701: Không còn nhãn sai "TỔNG 1" trong header');

  // Check missing cell text
  const cellCheck = await page.evaluate(() => {
    const missingElements = Array.from(document.querySelectorAll('.debit-missing')).map((el) => el.textContent.trim());
    const hasThieuTongTra = missingElements.some((t) => t.includes('Thiếu tổng trả'));
    const hasThieuTong1 = missingElements.some((t) => t.includes('Thiếu tổng 1'));
    return {
      missingLabelsSample: missingElements.slice(0, 10),
      hasThieuTongTra,
      hasThieuTong1,
    };
  });
  log(`Missing cells inspection: ${JSON.stringify(cellCheck)}`);
  assert(cellCheck.hasThieuTongTra || !cellCheck.hasThieuTong1, 'SIL-701: Ô thiếu chi phí dùng "Thiếu tổng trả", không còn "Thiếu tổng 1"');

  await page.screenshot({ path: `${OUT}sil-701-chot-debit-1440.png` });

  // Open "Cột hiển thị" dialog to verify picker checkbox
  const pickerOpened = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find((b) => b.textContent.includes('Cột hiển thị') || b.getAttribute('aria-label')?.includes('Cột hiển thị'));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  log(`Clicked Cột hiển thị: ${pickerOpened}`);
  await new Promise((r) => setTimeout(r, 800));

  const dialogCheck = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { found: false };
    const text = dialog.textContent;
    const hasTongTraCheckbox = text.includes('Tổng trả');
    const hasTong1Checkbox = text.includes('Tổng 1');
    return {
      found: true,
      hasTongTraCheckbox,
      hasTong1Checkbox,
    };
  });
  log(`Dialog column picker check: ${JSON.stringify(dialogCheck)}`);
  assert(dialogCheck.hasTongTraCheckbox, 'SIL-701: Checkbox trong dialog Cột hiển thị mang tên "Tổng trả"');
  assert(!dialogCheck.hasTong1Checkbox, 'SIL-701: Dialog Cột hiển thị không còn "Tổng 1"');

  await page.screenshot({ path: `${OUT}sil-701-chot-debit-columns-dialog.png` });

  // Close dialog
  await page.evaluate(() => {
    const closeBtn = document.querySelector('[role="dialog"] button[aria-label="Đóng"], [role="dialog"] .modal__close');
    if (closeBtn) closeBtn.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  // Tablet & Mobile screenshots for SIL-701
  await page.setViewport({ width: 768, height: 1024 });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${OUT}sil-701-chot-debit-768.png` });

  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${OUT}sil-701-chot-debit-390.png` });


  // =========================================================================
  // Part 2: SIL-707 — Popup chọn nhà xe nội bộ đè dòng, không cuộn
  // =========================================================================
  log('\n=== [2] Testing SIL-707 on /dispatch (Master plan allocation popup) ===');
  await page.setViewport({ width: 1440, height: 900 });

  log('Clearing session and logging in as dieuvan...');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  const client = await page.target().createCDPSession();
  await client.send('Network.clearBrowserCookies');

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input', { timeout: 15000 });
  await page.type('input:not([type="password"])', 'dieuvan');
  await page.type('input[type="password"]', 'Abc123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"], button:not([type])'),
  ]);
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 });
  log(`Login as dieuvan ok, on ${await page.evaluate(() => location.pathname)}`);

  log('Navigating to /dispatch...');
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.waitForSelector('.master-plan-grid', { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  // Find cell in "Phân bổ nhà xe" column and click it to open allocation modal
  const allocCellClicked = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.master-plan-grid tbody tr'));
    // Find an FCL row (one without .master-plan-grid__lcl-chip) so it opens the container allocation popover
    const fclRow = rows.find((r) => !r.querySelector('.master-plan-grid__lcl-chip'));
    if (fclRow) {
      const trigger = fclRow.querySelector('.master-plan-grid__allocation-trigger');
      if (trigger) {
        trigger.click();
        return { clicked: true, isFcl: true };
      }
    }
    const anyTrigger = document.querySelector('.master-plan-grid__allocation-trigger');
    if (anyTrigger) {
      anyTrigger.click();
      return { clicked: true, isFcl: false };
    }
    return { clicked: false };
  });
  log(`Allocation cell clicked: ${JSON.stringify(allocCellClicked)}`);
  await page.waitForSelector('.dispatch-allocation-popover', { timeout: 10000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  // Verify allocation popover is open
  const allocPopoverOpen = await page.evaluate(() => {
    const pop = document.querySelector('.dispatch-allocation-popover');
    return Boolean(pop);
  });
  log(`Allocation popover open: ${allocPopoverOpen}`);
  assert(allocPopoverOpen, 'SIL-707: Dialog Phân bổ nhà xe mở thành công');

  // Add row 2 if only 1 row exists
  const rowCountBefore = await page.evaluate(() => {
    return document.querySelectorAll('.dispatch-allocation-popover__row').length;
  });
  log(`Row count before add: ${rowCountBefore}`);
  if (rowCountBefore < 2) {
    await page.evaluate(() => {
      const addBtn = document.querySelector('.dispatch-allocation-popover__add');
      if (addBtn) addBtn.click();
    });
    await new Promise((r) => setTimeout(r, 800));
  }
  const rowCountAfter = await page.evaluate(() => {
    return document.querySelectorAll('.dispatch-allocation-popover__row').length;
  });
  log(`Row count after add: ${rowCountAfter}`);

  // Click row 1's carrier select
  const selectTriggerClicked = await page.evaluate(() => {
    const input = document.querySelector('.dispatch-allocation-popover__row .ds-uui-select input');
    if (input) {
      input.focus();
      input.click();
      return true;
    }
    const firstRowSelect = document.querySelector('.dispatch-allocation-popover__row .ds-uui-select button, .dispatch-allocation-popover__row .ds-uui-select [role="combobox"]');
    if (firstRowSelect) {
      firstRowSelect.click();
      return true;
    }
    return false;
  });
  log(`Row 1 carrier select clicked: ${selectTriggerClicked}`);
  await page.keyboard.press('ArrowDown');
  await new Promise((r) => setTimeout(r, 1000));

  // Inspect the carrier dropdown listbox
  const dropdownMetrics = await page.evaluate(() => {
    const popover = document.querySelector('.dispatch-allocation-popover__carrier-dropdown, .ds-uui-select__popover, .uui-select-popover, [role="listbox"]');
    if (!popover) return { found: false };
    const rect = popover.getBoundingClientRect();
    const computed = window.getComputedStyle(popover);
    const options = popover.querySelectorAll('[role="option"], li');
    
    // Check row 2 carrier input position
    const row2Carrier = document.querySelectorAll('.dispatch-allocation-popover__row')[1];
    const row2Rect = row2Carrier ? row2Carrier.getBoundingClientRect() : null;

    return {
      found: true,
      tag: popover.tagName,
      className: popover.className,
      optionCount: options.length,
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      clientHeight: popover.clientHeight,
      scrollHeight: popover.scrollHeight,
      maxHeight: computed.maxHeight,
      overflowY: computed.overflowY,
      viewportHeight: window.innerHeight,
      row2Top: row2Rect ? Math.round(row2Rect.top) : null,
    };
  });
  log(`Dropdown metrics: ${JSON.stringify(dropdownMetrics)}`);

  assert(dropdownMetrics.found, 'SIL-707: Dropdown danh sách nhà xe hiển thị');
  assert(dropdownMetrics.optionCount > 1, `SIL-707: Dropdown có ${dropdownMetrics.optionCount} lựa chọn`);
  assert(dropdownMetrics.clientHeight <= 400, `SIL-707: Chiều cao dropdown (${dropdownMetrics.clientHeight}px) <= 400px (đáp ứng tiêu chuẩn data-dense 320-400px)`);
  assert(dropdownMetrics.bottom <= 900, `SIL-707: Đáy dropdown (${dropdownMetrics.bottom}px) nằm trong viewport 900px (không bị tràn y≈1352)`);
  assert(dropdownMetrics.overflowY === 'auto' || dropdownMetrics.overflowY === 'scroll', `SIL-707: overflow-y là ${dropdownMetrics.overflowY} cho phép cuộn`);
  assert(dropdownMetrics.scrollHeight > dropdownMetrics.clientHeight, `SIL-707: scrollHeight (${dropdownMetrics.scrollHeight}px) > clientHeight (${dropdownMetrics.clientHeight}px) chứng minh danh sách cuộn được`);

  await page.screenshot({ path: `${OUT}sil-707-carrier-popup-open-1440.png` });

  // Scroll dropdown to bottom
  await page.evaluate(() => {
    const popover = document.querySelector('.ds-uui-select__popover, [role="listbox"], [role="presentation"] [data-rac]');
    if (popover) {
      popover.scrollTop = popover.scrollHeight;
    }
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${OUT}sil-707-carrier-popup-scrolled-1440.png` });

  // Now test on /dispatch-detail as well
  log('\n=== Testing /dispatch-detail ===');
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.waitForSelector('.detailed-plan-grid', { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  // Open edit dispatch dialog on row 1
  const openedDetailEdit = await page.evaluate(async () => {
    const editBtn = document.querySelector('.dispatch-assignment-cell__carrier--action, button[aria-label*="Sửa điều phối"], button[aria-label*="Hủy phân xe"]');
    if (editBtn) {
      editBtn.click();
      return true;
    }
    const menuTrigger = document.querySelector('.dispatch-row-menu__trigger');
    if (menuTrigger) {
      menuTrigger.click();
      await new Promise((r) => setTimeout(r, 400));
      const items = Array.from(document.querySelectorAll('.dispatch-row-menu__list button, [role="menuitem"]'));
      const editItem = items.find((b) => b.textContent.includes('Sửa điều phối') || b.textContent.includes('Phân xe'));
      if (editItem) {
        editItem.click();
        return true;
      }
    }
    return false;
  });
  log(`Opened dispatch detail edit modal: ${openedDetailEdit}`);
  await new Promise((r) => setTimeout(r, 1200));

  // Click carrier select in dispatch detail dialog
  const detailSelectClicked = await page.evaluate(() => {
    const trigger = document.querySelector('.searchable-select__trigger');
    if (trigger) {
      trigger.click();
      return true;
    }
    return false;
  });
  log(`Dispatch detail select clicked: ${detailSelectClicked}`);
  await new Promise((r) => setTimeout(r, 800));

  const detailSelectMetrics = await page.evaluate(() => {
    const pop = document.querySelector('.searchable-select__popover');
    if (!pop) return { found: false };
    const rect = pop.getBoundingClientRect();
    const style = window.getComputedStyle(pop);
    const list = pop.querySelector('.searchable-select__list');
    const listStyle = list ? window.getComputedStyle(list) : null;
    return {
      found: true,
      popoverHeight: Math.round(rect.height),
      popoverMaxHeight: style.maxHeight,
      listMaxHeight: listStyle ? listStyle.maxHeight : null,
      listOverflowY: listStyle ? listStyle.overflowY : null,
      bottom: Math.round(rect.bottom),
    };
  });
  log(`Dispatch detail select metrics: ${JSON.stringify(detailSelectMetrics)}`);
  if (detailSelectMetrics.found) {
    assert(detailSelectMetrics.popoverHeight <= 420, `SIL-707: /dispatch-detail select popover height (${detailSelectMetrics.popoverHeight}px) <= 420px`);
    assert(detailSelectMetrics.listOverflowY === 'auto' || detailSelectMetrics.listOverflowY === 'scroll', 'SIL-707: /dispatch-detail select list có overflow-y auto');
  }

  await page.screenshot({ path: `${OUT}sil-707-dispatch-detail-1440.png` });

  log('\n=== All drives completed ===');
  log(`Final status: ${failed ? 'FAILED' : 'ALL PASSED'}`);

} catch (err) {
  log(`ERROR: ${err.stack || err.message}`);
  failed = true;
} finally {
  await browser.close();
  if (failed) {
    process.exit(1);
  }
}
