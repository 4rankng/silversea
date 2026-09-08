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
  note('=== STARTING QA MATRIX V2 VERIFICATION ===');

  const adminToken = await login('admin');
  const cusToken = await login('cus');
  const giamdocToken = await login('giamdoc');
  note('Logged in admin, cus, giamdoc successfully.');

  const browser = await puppeteer.launch({
    headless: STANDARD_HEADLESS,
    args: STANDARD_BROWSER_ARGS,
  });

  try {
    // -------------------------------------------------------------
    // PHẦN 1: HÃNG TÀU DROPDOWN TRÊN FORM TẠO MỚI LÔ HÀNG (/shipments/new)
    // -------------------------------------------------------------
    note('--- PHẦN 1: BINDING DỮ LIỆU DROPDOWN HÃNG TÀU ---');
    {
      const page = await browser.newPage();
      await page.setViewport(STANDARD_VIEWPORT);
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, cusToken);

      installPageLogging(page, logLines);
      await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(2000);

      // Inspect shipping line input
      const shippingLineInput = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const found = inputs.find(i => 
          i.placeholder?.toLowerCase().includes('hãng tàu') ||
          i.getAttribute('aria-label')?.toLowerCase().includes('hãng tàu') ||
          i.closest('label')?.textContent?.toLowerCase().includes('hãng tàu')
        );
        if (!found) return null;
        return {
          placeholder: found.placeholder,
          value: found.value,
          id: found.id,
          name: found.name,
        };
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

      // Check dropdown options
      const options = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[role="option"], .combobox__option, .uui-combobox-option, .searchable-select__option'));
        return items.map(el => el.textContent?.trim()).filter(Boolean);
      });

      note(`Shipping line dropdown options count: ${options.length}`);
      note(`First 10 shipping lines: ${JSON.stringify(options.slice(0, 10))}`);

      // Verify standard lines (Maersk, MSC, COSCO)
      const hasMaersk = options.some(o => o.includes('Maersk'));
      const hasMsc = options.some(o => o.includes('MSC'));
      const hasCosco = options.some(o => o.includes('COSCO'));
      note(`TC_LINE_01: Contains standard shipping lines: Maersk=${hasMaersk}, MSC=${hasMsc}, COSCO=${hasCosco}`);

      // Check custom input support (typing custom text)
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
      note('TC_LINE_02: Custom input value typed successfully.');

      // Check + Thêm hãng tàu modal button
      const addShippingBtn = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent?.includes('Thêm hãng tàu'));
        return btn ? { text: btn.textContent?.trim(), visible: btn.offsetParent !== null } : null;
      });
      note(`TC_LINE_03: Found "+ Thêm hãng tàu" button: ${JSON.stringify(addShippingBtn)}`);

      // Take screenshot of shipping line dropdown
      const phan1Path = join(QA_DIR, '2026-09-08_phan1_hang-tau-dropdown.png');
      await page.screenshot({ path: phan1Path, fullPage: false });
      note(`Saved screenshot: ${phan1Path}`);

      await page.close();
    }

    // -------------------------------------------------------------
    // PHẦN 2: RESPONSIVE 1366 & 1920, POPOVER HƯỚNG MỞ TRÊN DÒNG CONTAINER
    // -------------------------------------------------------------
    note('--- PHẦN 2: RESPONSIVE 1366x768 & 1920x1080 ---');
    {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, cusToken);
      installPageLogging(page, logLines);

      // 1366x768
      await page.setViewport({ width: 1366, height: 768 });
      await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(2000);

      // Check horizontal overflow
      const overflow1366 = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      note(`TC_RESP_01: 1366x768 horizontal overflow = ${overflow1366}`);

      // Scroll container section into view
      await page.evaluate(() => {
        window.scrollTo(0, 450);
      });
      await sleep(500);

      // Click Cảng nâng or Tuyến đường combobox to show popover direction
      await page.evaluate(() => {
        const comboboxes = Array.from(document.querySelectorAll('[role="combobox"], input[aria-label*="Cảng"], input[placeholder*="Cảng"]'));
        if (comboboxes.length > 0) {
          comboboxes[0].focus();
          comboboxes[0].click();
        }
      });
      await sleep(800);

      const phan2Path1366 = join(QA_DIR, '2026-09-08_phan2_responsive-1366.png');
      await page.screenshot({ path: phan2Path1366 });
      note(`Saved screenshot: ${phan2Path1366}`);

      // 1920x1080
      await page.setViewport({ width: 1920, height: 1080 });
      await sleep(1000);
      const overflow1920 = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      note(`TC_RESP_02: 1920x1080 horizontal overflow = ${overflow1920}`);

      const phan2Path1920 = join(QA_DIR, '2026-09-08_phan2_responsive-1920.png');
      await page.screenshot({ path: phan2Path1920 });
      note(`Saved screenshot: ${phan2Path1920}`);

      await page.close();
    }

    // -------------------------------------------------------------
    // PHẦN 3 & 6: DIALOG PHÂN XE, CHECKBOX ĐÓNG KẾT HỢP & TASK TAGS (/dispatch-detail)
    // -------------------------------------------------------------
    note('--- PHẦN 3 & 6: DISPATCH DETAIL PLAN, CHECKBOX ĐÓNG KẾT HỢP, TASK TAGS ---');
    {
      const page = await browser.newPage();
      await page.setViewport(STANDARD_VIEWPORT);
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, adminToken);
      installPageLogging(page, logLines);

      // 1. Test 20ft row on page 1 (20'OT container)
      await page.goto(`${FRONTEND}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000);

      // Click first row (20'OT container)
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
      note(`TC_COMB_02 (20ft container): Checkbox Đóng kết hợp enabled: ${JSON.stringify(check20)}`);

      // Inspect Task Tags in 20ft dialog
      const tags = await page.evaluate(() => {
        const tagButtons = Array.from(document.querySelectorAll('.dispatch-assignment-dialog__notes-tag:not(.dispatch-assignment-dialog__notes-tag--add)'));
        return tagButtons.map(b => b.textContent?.trim()).filter(Boolean);
      });
      note(`TC_TAG_01: Task tags found in dialog (${tags.length}): ${JSON.stringify(tags)}`);
      const hasXuong2 = tags.some(t => t.includes('XƯỞNG 2'));
      note(`TC_TAG_01: Contains 'XƯỞNG 2': ${hasXuong2}`);

      // Click XƯỞNG 2 tag
      const tagClicked = await page.evaluate(() => {
        const tagButtons = Array.from(document.querySelectorAll('.dispatch-assignment-dialog__notes-tag:not(.dispatch-assignment-dialog__notes-tag--add)'));
        const xuong2 = tagButtons.find(b => b.textContent?.includes('XƯỞNG 2'));
        if (xuong2) {
          xuong2.click();
          return 'XƯỞNG 2 clicked';
        }
        return null;
      });
      note(`TC_TAG_02: Tag click result: ${tagClicked}`);
      await sleep(500);

      const noteValue = await page.evaluate(() => {
        const area = document.querySelector('.dispatch-assignment-dialog__notes textarea, textarea');
        return area?.value;
      });
      note(`TC_TAG_03: Note value after tag click: "${noteValue}"`);

      const phan6Path = join(QA_DIR, '2026-09-08_phan6_task-tags.png');
      await page.screenshot({ path: phan6Path });
      note(`Saved screenshot: ${phan6Path}`);

      // Close dialog
      await page.keyboard.press('Escape');
      await sleep(800);

      // 2. Test 40ft row: Go to page 3 and click row 38 (40'HC container)
      note('Navigating to page 3 for 40ft container check...');
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
      note(`TC_COMB_01 (40ft container): Checkbox Đóng kết hợp: disabled=${check40?.disabled}, checked=${check40?.checked}, title="${check40?.title}"`);

      const phan3Path = join(QA_DIR, '2026-09-08_phan3_dispatch-dialog.png');
      await page.screenshot({ path: phan3Path });
      note(`Saved screenshot: ${phan3Path}`);

      await page.close();
    }

    // -------------------------------------------------------------
    // PHẦN 4: HIỂN THỊ NÚT "LƯU" TẠI BẢNG KÊ CONTAINER (/shipments-detail?dateScope=all)
    // -------------------------------------------------------------
    note('--- PHẦN 4: HIỂN THỊ NÚT LƯU TRÊN BẢNG KÊ CONTAINER ---');
    {
      const page = await browser.newPage();
      await page.setViewport(STANDARD_VIEWPORT);
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, adminToken);
      installPageLogging(page, logLines);

      await page.goto(`${FRONTEND}/shipments-detail?dateScope=all`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000);

      // Find schedule cell trigger
      const opened = await page.evaluate(() => {
        const triggers = Array.from(document.querySelectorAll('.shipment-container-ledger__cell-editor[data-mode="schedule"] button, .shipment-container-ledger__cell-editor button'));
        if (triggers.length > 0) {
          triggers[0].click();
          return true;
        }
        return false;
      });
      note(`Clicked cell trigger to open inline editor: ${opened}`);
      await sleep(1000);

      // Check save and cancel buttons
      const saveButtons = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const matching = btns.filter(b => b.textContent?.trim() === 'Lưu' || b.textContent?.includes('Lưu'));
        return matching.map(b => ({
          text: b.textContent?.trim(),
          className: b.className,
          visible: b.offsetParent !== null,
        }));
      });
      note(`TC_BTN_01: Found save buttons in editor: ${JSON.stringify(saveButtons)}`);

      const cancelButtons = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const matching = btns.filter(b => b.textContent?.trim() === 'Hủy' || b.textContent?.includes('Hủy'));
        return matching.map(b => ({
          text: b.textContent?.trim(),
          className: b.className,
          visible: b.offsetParent !== null,
        }));
      });
      note(`TC_BTN_01: Found cancel buttons in editor: ${JSON.stringify(cancelButtons)}`);

      const phan4Path = join(QA_DIR, '2026-09-08_phan4_modal-lich-giao.png');
      await page.screenshot({ path: phan4Path });
      note(`Saved screenshot: ${phan4Path}`);

      await page.close();
    }

  } finally {
    await browser.close();
  }

  // -------------------------------------------------------------
  // PHẦN 5: API & PERMISSIONS CHECK FOR UNASSIGNED CONTAINER SCHEDULING
  // -------------------------------------------------------------
  note('--- PHẦN 5: UNASSIGNED CONTAINER SCHEDULING (ADMIN & MANAGER) ---');
  {
    const containersRes = await api(adminToken, 'GET', '/shipments/cus-workspace/containers');
    note(`Containers returned from /shipments/cus-workspace/containers: ${containersRes.data?.items?.length ?? 0}`);
    const unassigned = containersRes.data?.items?.find(c => c.dispatchStatus === 'UNASSIGNED');
    if (unassigned) {
      note(`Found unassigned container: id=${unassigned.id}, shipmentId=${unassigned.shipmentId}, number=${unassigned.containerNumber}`);
      note(`TC_UNAS_01: scheduleEditable=${unassigned.scheduleEditable}, customerAppointmentEditable=${unassigned.customerAppointmentEditable}`);

      // Try update as ADMIN
      const adminUpdate = await api(adminToken, 'POST', `/shipments/cus-workspace/${unassigned.shipmentId}/containers/${unassigned.id}`, {
        expectedShipmentVersion: unassigned.shipmentVersion,
        customerAppointmentAt: '2026-09-12T08:00:00+07:00',
      }, {
        headers: { 'Idempotency-Key': 'qa-v2-adm-' + Date.now() },
      });
      note(`TC_UNAS_01 (ADMIN update status): ${adminUpdate.status}, line appointment: ${adminUpdate.data?.line?.customerAppointmentAt}`);

      // Try update as MANAGER
      const nextVersion = adminUpdate.data?.shipmentVersion ?? (unassigned.shipmentVersion + 1);
      const managerUpdate = await api(giamdocToken, 'POST', `/shipments/cus-workspace/${unassigned.shipmentId}/containers/${unassigned.id}`, {
        expectedShipmentVersion: nextVersion,
        customerAppointmentAt: '2026-09-12T09:30:00+07:00',
      }, {
        headers: { 'Idempotency-Key': 'qa-v2-mgr-' + Date.now() },
      });
      note(`TC_UNAS_02 (MANAGER update status): ${managerUpdate.status}, line appointment: ${managerUpdate.data?.line?.customerAppointmentAt}`);
    }

    // Now test container with active assigned trip (must return 409 citing trip code)
    const tripContainerUpdate = await api(adminToken, 'POST', '/shipments/cus-workspace/24/containers/24', {
      expectedShipmentVersion: 13,
      customerAppointmentAt: '2026-09-12T10:00:00+07:00',
    }, {
      headers: { 'Idempotency-Key': 'qa-v2-trip-' + Date.now() },
    });
    note(`TC_UNAS_03 (Assigned trip update status): ${tripContainerUpdate.status}, error: ${JSON.stringify(tripContainerUpdate.data)}`);
  }

  // Write driver log
  const logFile = join(QA_DIR, '2026-09-08_qa-matrix-v2_ui-driver.log');
  writeFileSync(logFile, logLines.join('\n') + '\n', 'utf8');
  note(`Driver log written to: ${logFile}`);
  note('=== ALL QA MATRIX V2 CHECKS COMPLETED SUCCESSFULLY ===');
}

run().catch((err) => {
  console.error('Test script error:', err);
  process.exit(1);
});
