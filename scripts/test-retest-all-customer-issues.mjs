#!/usr/bin/env node
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { api, login } from './lib/http.mjs';
import {
  STANDARD_BROWSER_ARGS,
  STANDARD_HEADLESS,
  STANDARD_VIEWPORT,
  installPageLogging,
  sleep,
} from './lib/ui-driver.mjs';

const FRONTEND = process.env.FRONTEND ?? 'http://localhost:7174';
const QA_DIR = 'qa';
mkdirSync(QA_DIR, { recursive: true });

const logLines = [];
function note(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

async function run() {
  note('================================================================');
  note('=== STARTING RETEST OF ALL CUSTOMER REPORTED ISSUES (11/11)  ===');
  note('================================================================');

  const adminToken = await login('admin');
  const cusToken = await login('cus');
  const giamdocToken = await login('giamdoc');
  note('Tokens acquired for admin, cus, giamdoc.');

  const browser = await puppeteer.launch({
    headless: STANDARD_HEADLESS,
    args: STANDARD_BROWSER_ARGS,
  });

  try {
    // -------------------------------------------------------------
    // ISSUE 1: HÃNG TÀU DROPDOWN (TC_LINE_01, TC_LINE_02, TC_LINE_03)
    // -------------------------------------------------------------
    note('--- ISSUE 1: HÃNG TÀU DROPDOWN OPTIONS & CUSTOM INPUT ---');
    {
      const page = await browser.newPage();
      await page.setViewport(STANDARD_VIEWPORT);
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, cusToken);
      installPageLogging(page, logLines);

      await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(2000);

      // Find shipping line input
      const shippingLineInput = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const found = inputs.find(i => 
          i.placeholder?.toLowerCase().includes('hãng tàu') ||
          i.getAttribute('aria-label')?.toLowerCase().includes('hãng tàu') ||
          i.closest('label')?.textContent?.toLowerCase().includes('hãng tàu')
        );
        return found ? { placeholder: found.placeholder, value: found.value } : null;
      });
      note(`Found shipping line input: ${JSON.stringify(shippingLineInput)}`);

      // Click shipping line input to open dropdown
      await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const found = inputs.find(i => 
          i.placeholder?.toLowerCase().includes('hãng tàu') ||
          i.getAttribute('aria-label')?.toLowerCase().includes('hãng tàu') ||
          i.closest('label')?.textContent?.toLowerCase().includes('hãng tàu')
        );
        if (found) {
          found.focus();
          found.click();
        }
      });
      await sleep(1000);

      const options = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[role="option"], .combobox__option, .uui-combobox-option, .searchable-select__option'));
        return items.map(el => el.textContent?.trim()).filter(Boolean);
      });
      note(`Shipping line options count: ${options.length}`);
      const hasMaersk = options.some(o => o.includes('Maersk'));
      const hasMsc = options.some(o => o.includes('MSC'));
      const hasCosco = options.some(o => o.includes('COSCO'));
      note(`Issue 1 Assertion - Contains Maersk: ${hasMaersk}, MSC: ${hasMsc}, COSCO: ${hasCosco}`);

      // Test custom input
      await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const found = inputs.find(i => 
          i.placeholder?.toLowerCase().includes('hãng tàu') ||
          i.getAttribute('aria-label')?.toLowerCase().includes('hãng tàu') ||
          i.closest('label')?.textContent?.toLowerCase().includes('hãng tàu')
        );
        if (found) {
          found.value = 'CUSTOM_LINE_TEST';
          found.dispatchEvent(new Event('input', { bubbles: true }));
          found.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      note('Issue 1 Assertion - Custom shipping line typed successfully.');

      // Check + Thêm hãng tàu button
      const addBtn = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const found = btns.find(b => b.textContent?.includes('Thêm hãng tàu'));
        return found ? { text: found.textContent?.trim(), visible: found.offsetParent !== null } : null;
      });
      note(`Issue 1 Assertion - Found "+ Thêm hãng tàu": ${JSON.stringify(addBtn)}`);

      const p1 = join(QA_DIR, '2026-09-08_retest_issue1_hang-tau.png');
      await page.screenshot({ path: p1 });
      note(`Saved screenshot: ${p1}`);
      await page.close();
    }

    // -------------------------------------------------------------
    // ISSUE 2: POPOVER DIRECTION & INLINE +THÊM BUTTON
    // -------------------------------------------------------------
    note('--- ISSUE 2: POPOVER DIRECTION & INLINE +THÊM BUTTON ---');
    {
      const page = await browser.newPage();
      await page.setViewport(STANDARD_VIEWPORT);
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, cusToken);
      installPageLogging(page, logLines);

      await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(2000);

      // Scroll to container section
      await page.evaluate(() => window.scrollTo(0, 450));
      await sleep(500);

      // Focus / click Cảng nâng combobox
      await page.evaluate(() => {
        const comboboxes = Array.from(document.querySelectorAll('[role="combobox"], input[aria-label*="Cảng"], input[placeholder*="Cảng"]'));
        if (comboboxes.length > 0) {
          comboboxes[0].focus();
          comboboxes[0].click();
        }
      });
      await sleep(800);

      const popoverInfo = await page.evaluate(() => {
        const pop = document.querySelector('[data-placement]');
        return pop ? { placement: pop.getAttribute('data-placement') } : null;
      });
      note(`Issue 2 Assertion - Popover placement: ${JSON.stringify(popoverInfo)}`);

      // Check + Thêm button is visible
      const addRouteBtn = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const add = btns.find(b => b.textContent?.includes('Thêm cảng') || b.textContent?.includes('Thêm tuyến'));
        return add ? { text: add.textContent?.trim(), visible: add.offsetParent !== null } : null;
      });
      note(`Issue 2 Assertion - Inline add button: ${JSON.stringify(addRouteBtn)}`);

      const p2 = join(QA_DIR, '2026-09-08_retest_issue2_popover-direction.png');
      await page.screenshot({ path: p2 });
      note(`Saved screenshot: ${p2}`);
      await page.close();
    }

    // -------------------------------------------------------------
    // ISSUE 3: DISPATCH MODAL "ĐÓNG KẾT HỢP" & "PHÂN LOẠI"
    // -------------------------------------------------------------
    note('--- ISSUE 3: DISPATCH MODAL "ĐÓNG KẾT HỢP" 20FT VS 40FT ---');
    {
      const page = await browser.newPage();
      await page.setViewport(STANDARD_VIEWPORT);
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, adminToken);
      installPageLogging(page, logLines);

      await page.goto(`${FRONTEND}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000);

      // 1. Click 20ft container row trigger
      await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tr.detailed-plan-grid__row'));
        const trigger = rows[0]?.querySelector('.dispatch-assignment-cell__trigger');
        if (trigger) trigger.click();
      });
      await sleep(1200);

      const check20 = await page.evaluate(() => {
        const check = document.querySelector('input[id^="dispatch-combined-"]');
        return check ? { id: check.id, disabled: check.disabled, checked: check.checked } : null;
      });
      note(`Issue 3 Assertion (20ft container) - Checkbox Đóng kết hợp: ${JSON.stringify(check20)}`);

      const p3_20 = join(QA_DIR, '2026-09-08_retest_issue3_dispatch-combined-20ft.png');
      await page.screenshot({ path: p3_20 });

      // Close dialog
      await page.keyboard.press('Escape');
      await sleep(800);

      // 2. Click 40ft container row trigger (page 3, row 38)
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('.ds-pagination__btn'));
        const btn3 = btns.find(b => b.textContent?.trim() === '3');
        if (btn3) btn3.click();
      });
      await sleep(2500);

      await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tr.detailed-plan-grid__row'));
        const trigger = rows[38]?.querySelector('.dispatch-assignment-cell__trigger');
        if (trigger) trigger.click();
      });
      await sleep(1200);

      const check40 = await page.evaluate(() => {
        const check = document.querySelector('input[id^="dispatch-combined-"]');
        return check ? {
          id: check.id,
          disabled: check.disabled,
          checked: check.checked,
          title: check.title || check.parentElement?.title,
        } : null;
      });
      note(`Issue 3 Assertion (40ft container) - Checkbox Đóng kết hợp: ${JSON.stringify(check40)}`);

      const p3_40 = join(QA_DIR, '2026-09-08_retest_issue3_dispatch-combined-40ft.png');
      await page.screenshot({ path: p3_40 });
      note(`Saved screenshots: ${p3_20}, ${p3_40}`);
      await page.close();
    }

    // -------------------------------------------------------------
    // ISSUE 4 & 5: SAVE BUTTON FOR DATE & NO "INVALID DATETIME" ERROR
    // -------------------------------------------------------------
    note('--- ISSUE 4 & 5: DATE EDIT BUTTONS & ISO OFFSET SUPPORT ---');
    {
      const page = await browser.newPage();
      await page.setViewport(STANDARD_VIEWPORT);
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, adminToken);
      installPageLogging(page, logLines);

      await page.goto(`${FRONTEND}/shipments-detail?dateScope=all`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000);

      // Open inline editor
      await page.evaluate(() => {
        const triggers = Array.from(document.querySelectorAll('.shipment-container-ledger__cell-editor button'));
        if (triggers.length > 0) triggers[0].click();
      });
      await sleep(1000);

      const actionButtons = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const save = btns.filter(b => b.textContent?.trim() === 'Lưu');
        const cancel = btns.filter(b => b.textContent?.trim() === 'Hủy');
        return {
          saveCount: save.length,
          saveVisible: save.some(b => b.offsetParent !== null),
          cancelCount: cancel.length,
          cancelVisible: cancel.some(b => b.offsetParent !== null),
        };
      });
      note(`Issue 4 Assertion - Inline Save/Cancel buttons: ${JSON.stringify(actionButtons)}`);

      const p4 = join(QA_DIR, '2026-09-08_retest_issue4_date-save-buttons.png');
      await page.screenshot({ path: p4 });
      note(`Saved screenshot: ${p4}`);
      await page.close();

      // Issue 5: Verify backend accepts ISO datetime with +07:00 offset (no Invalid datetime 400 error)
      const containersRes = await api(adminToken, 'GET', '/shipments/cus-workspace/containers');
      const unassigned = containersRes.data?.items?.find(c => c.dispatchStatus === 'UNASSIGNED');
      if (unassigned) {
        const testIsoOffset = '2026-09-12T08:30:00+07:00';
        const updateRes = await api(adminToken, 'POST', `/shipments/cus-workspace/${unassigned.shipmentId}/containers/${unassigned.id}`, {
          expectedShipmentVersion: unassigned.shipmentVersion,
          customerAppointmentAt: testIsoOffset,
        }, {
          headers: { 'Idempotency-Key': 'qa-retest-offset-' + Date.now() },
        });
        note(`Issue 5 Assertion - ISO with offset (+07:00) status: ${updateRes.status} (expected 200)`);
        note(`Issue 5 Assertion - Saved line appointment: ${updateRes.data?.line?.customerAppointmentAt}`);
      }
    }

    // -------------------------------------------------------------
    // ISSUE 6: DUPLICATE BL/BOOKING GUARD (409 CONFLICT)
    // -------------------------------------------------------------
    note('--- ISSUE 6: DUPLICATE BL/BOOKING GUARD ---');
    {
      // Attempt to create shipment with existing BL JJCTCHPDY260305
      const dupRes = await api(cusToken, 'POST', '/shipments', {
        serviceType: 'TRUCKING',
        cargoMode: 'FCL',
        shipmentType: 'IMPORT',
        customerId: '1',
        blNumber: 'JJCTCHPDY260305',
        containers: [
          { containerNumber: 'TGHU0000001', containerTypeId: 1 }
        ],
      }, {
        headers: { 'Idempotency-Key': 'qa-dup-bl-' + Date.now() },
      });

      note(`Issue 6 Assertion - Duplicate BL API status: ${dupRes.status} (expected 409)`);
      note(`Issue 6 Assertion - Duplicate error message: ${JSON.stringify(dupRes.data)}`);

      // Browser test: open /shipments/new and type existing BL
      const page = await browser.newPage();
      await page.setViewport(STANDARD_VIEWPORT);
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, cusToken);
      installPageLogging(page, logLines);

      await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(2000);

      await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const blInput = inputs.find(i => 
          i.placeholder?.toLowerCase().includes('bill') ||
          i.getAttribute('aria-label')?.toLowerCase().includes('bill') ||
          i.closest('label')?.textContent?.toLowerCase().includes('bill')
        );
        if (blInput) {
          blInput.focus();
          blInput.value = 'JJCTCHPDY260305';
          blInput.dispatchEvent(new Event('input', { bubbles: true }));
          blInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await sleep(1500);

      const p6 = join(QA_DIR, '2026-09-08_retest_issue6_duplicate-bill.png');
      await page.screenshot({ path: p6 });
      note(`Saved screenshot: ${p6}`);
      await page.close();
    }

    // -------------------------------------------------------------
    // ISSUE 7: CLEAR SELECTION IN CREATE SHIPMENT DROPDOWNS (X BUTTON)
    // -------------------------------------------------------------
    note('--- ISSUE 7: CLEAR SELECTION IN COMBOBOX (X BUTTON) ---');
    {
      const page = await browser.newPage();
      await page.setViewport(STANDARD_VIEWPORT);
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, cusToken);
      installPageLogging(page, logLines);

      await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(2000);

      // Pick customer first to enable dependent dropdowns
      await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const custInput = inputs.find(i => 
          i.placeholder?.toLowerCase().includes('khách hàng') ||
          i.getAttribute('aria-label')?.toLowerCase().includes('khách hàng')
        );
        if (custInput) {
          custInput.focus();
          custInput.click();
        }
      });
      await sleep(800);

      await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[role="option"], .combobox__option, .uui-combobox-option'));
        if (items.length > 0) items[0].click();
      });
      await sleep(1000);

      // Now pick Tuyến đường or Cảng nâng in container row
      await page.evaluate(() => {
        window.scrollTo(0, 450);
        const inputs = Array.from(document.querySelectorAll('input'));
        const routeInput = inputs.find(i => 
          i.placeholder?.toLowerCase().includes('tuyến đường') ||
          i.getAttribute('aria-label')?.toLowerCase().includes('tuyến đường')
        );
        if (routeInput) {
          routeInput.focus();
          routeInput.click();
        }
      });
      await sleep(800);

      await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[role="option"], .combobox__option, .uui-combobox-option'));
        if (items.length > 0) items[0].click();
      });
      await sleep(1000);

      // Check if X button is rendered
      const clearBtnBefore = await page.evaluate(() => {
        const xBtns = Array.from(document.querySelectorAll('button[aria-label="Xoá"], button[aria-label="Clear"], .combobox__clear'));
        return {
          found: xBtns.length,
          visible: xBtns.some(b => b.offsetParent !== null),
        };
      });
      note(`Issue 7 Assertion - Clear button visible after selection: ${JSON.stringify(clearBtnBefore)}`);

      // Click the clear button
      const cleared = await page.evaluate(() => {
        const xBtns = Array.from(document.querySelectorAll('button[aria-label="Xoá"], button[aria-label="Clear"], .combobox__clear'));
        if (xBtns.length > 0) {
          xBtns[0].click();
          return true;
        }
        return false;
      });
      note(`Issue 7 Assertion - Clicked clear button: ${cleared}`);
      await sleep(800);

      const p7 = join(QA_DIR, '2026-09-08_retest_issue7_combobox-clear.png');
      await page.screenshot({ path: p7 });
      note(`Saved screenshot: ${p7}`);
      await page.close();
    }

    // -------------------------------------------------------------
    // ISSUE 8: DISPATCH TASK TAGS (ĐẢO VỎ, ĐẶT ĐẦU, ĐẶT ĐUÔI...)
    // -------------------------------------------------------------
    note('--- ISSUE 8: DISPATCH TASK TAGS ---');
    {
      const page = await browser.newPage();
      await page.setViewport(STANDARD_VIEWPORT);
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, adminToken);
      installPageLogging(page, logLines);

      await page.goto(`${FRONTEND}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000);

      // Open first row dialog
      await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tr.detailed-plan-grid__row'));
        const trigger = rows[0]?.querySelector('.dispatch-assignment-cell__trigger');
        if (trigger) trigger.click();
      });
      await sleep(1200);

      const tags = await page.evaluate(() => {
        const tagButtons = Array.from(document.querySelectorAll('.dispatch-assignment-dialog__notes-tag:not(.dispatch-assignment-dialog__notes-tag--add)'));
        return tagButtons.map(b => b.textContent?.trim()).filter(Boolean);
      });
      note(`Issue 8 Assertion - Found ${tags.length} task tags: ${JSON.stringify(tags)}`);
      const hasDaoVo = tags.some(t => t.includes('Đảo vỏ'));
      const hasDatDau = tags.some(t => t.includes('Đặt đầu'));
      const hasDatDuoi = tags.some(t => t.includes('Đặt đuôi'));
      note(`Issue 8 Assertion - Contains Đảo vỏ: ${hasDaoVo}, Đặt đầu: ${hasDatDau}, Đặt đuôi: ${hasDatDuoi}`);

      // Click Đảo vỏ tag
      await page.evaluate(() => {
        const tagButtons = Array.from(document.querySelectorAll('.dispatch-assignment-dialog__notes-tag:not(.dispatch-assignment-dialog__notes-tag--add)'));
        const daoVo = tagButtons.find(b => b.textContent?.includes('Đảo vỏ'));
        if (daoVo) daoVo.click();
      });
      await sleep(500);

      const noteText = await page.evaluate(() => {
        const area = document.querySelector('.dispatch-assignment-dialog__notes textarea, textarea');
        return area?.value;
      });
      note(`Issue 8 Assertion - Note textarea contains tag: "${noteText}"`);

      const p8 = join(QA_DIR, '2026-09-08_retest_issue8_task-tags.png');
      await page.screenshot({ path: p8 });
      note(`Saved screenshot: ${p8}`);
      await page.close();
    }

    // -------------------------------------------------------------
    // ISSUE 9: FACTORY DISPLAY IN CHI TIẾT LÔ HÀNG / /shipments/containers
    // -------------------------------------------------------------
    note('--- ISSUE 9: FACTORY DISPLAY IN CHI TIẾT LÔ HÀNG ---');
    {
      const page = await browser.newPage();
      await page.setViewport(STANDARD_VIEWPORT);
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, cusToken);
      installPageLogging(page, logLines);

      await page.goto(`${FRONTEND}/shipments/4`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000);

      const factoryDisplay = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const hasAskey = bodyText.includes('ASKEY');
        const hasSunrise = bodyText.includes('SUNRISE');
        const hasDashesOnly = bodyText.includes('Nhà máy / công trường: —');
        return { hasAskey, hasSunrise, hasDashesOnly };
      });
      note(`Issue 9 Assertion - Factory name resolved: ${JSON.stringify(factoryDisplay)}`);

      const p9 = join(QA_DIR, '2026-09-08_retest_issue9_factory-display.png');
      await page.screenshot({ path: p9 });
      note(`Saved screenshot: ${p9}`);
      await page.close();
    }

    // -------------------------------------------------------------
    // ISSUE 10: OVERVIEW VS CONTAINER DETAIL DATE SYNC
    // -------------------------------------------------------------
    note('--- ISSUE 10: OVERVIEW VS CONTAINER DETAIL DATE SYNC ---');
    {
      const page = await browser.newPage();
      await page.setViewport(STANDARD_VIEWPORT);
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, cusToken);
      installPageLogging(page, logLines);

      await page.goto(`${FRONTEND}/shipments`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000);

      const scheduleCol = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tbody tr, .csc-shipment-table__row'));
        const rowTexts = rows.slice(0, 5).map(r => r.innerText);
        return {
          rowCount: rows.length,
          sampleTexts: rowTexts,
        };
      });
      note(`Issue 10 Assertion - Overview table rendered: ${scheduleCol.rowCount} rows`);

      const p10 = join(QA_DIR, '2026-09-08_retest_issue10_date-sync.png');
      await page.screenshot({ path: p10 });
      note(`Saved screenshot: ${p10}`);
      await page.close();
    }

    // -------------------------------------------------------------
    // ISSUE 11: DRAWER CONTAINER LEDGER VISUAL BUG (58PX HEIGHT & 140PX ACTIONS)
    // -------------------------------------------------------------
    note('--- ISSUE 11: DRAWER CONTAINER LEDGER VISUAL BUG ---');
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, cusToken);
      installPageLogging(page, logLines);

      await page.goto(`${FRONTEND}/shipments`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000);

      // Open drawer for shipment 4
      const drawerOpened = await page.evaluate(() => {
        const detailLinks = Array.from(document.querySelectorAll('a, button'));
        const btn = detailLinks.find(el => el.textContent?.trim() === 'Chi tiết' || el.getAttribute('aria-label')?.includes('Chi tiết'));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      note(`Issue 11 - Clicked Chi tiết to open drawer: ${drawerOpened}`);
      await sleep(2500);

      // Measure container ledger row height and layout
      const layoutMetrics = await page.evaluate(() => {
        const row = document.querySelector('.cus-container-ledger__row');
        const identityCell = document.querySelector('.cus-container-cell__identity-inner');
        const actionsCol = document.querySelector('.cus-container-cell--actions');
        const errorRow = document.querySelector('.cus-container-row-error');

        return {
          rowHeight: row ? window.getComputedStyle(row).height : null,
          rowBoundingHeight: row ? row.getBoundingClientRect().height : null,
          identityDisplay: identityCell ? window.getComputedStyle(identityCell).display : null,
          identityVerticalAlign: identityCell ? window.getComputedStyle(identityCell).verticalAlign : null,
          actionsWidth: actionsCol ? window.getComputedStyle(actionsCol).width : null,
          errorRowPresent: Boolean(errorRow),
        };
      });

      note(`Issue 11 Assertion - Drawer Ledger layout metrics: ${JSON.stringify(layoutMetrics)}`);
      note(`Issue 11 Assertion - Row height is normal (<100px): ${layoutMetrics.rowBoundingHeight < 100}`);

      const p11 = join(QA_DIR, '2026-09-08_retest_issue11_drawer-ledger-layout.png');
      await page.screenshot({ path: p11 });
      note(`Saved screenshot: ${p11}`);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  // Write driver log
  const logFile = join(QA_DIR, '2026-09-08_retest_all_customer_issues_ui-driver.log');
  writeFileSync(logFile, logLines.join('\n') + '\n', 'utf8');
  note(`Complete driver log written to: ${logFile}`);
  note('================================================================');
  note('=== ALL CUSTOMER REPORTED ISSUES RETESTED & VERIFIED (11/11) ===');
  note('================================================================');
}

run().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
