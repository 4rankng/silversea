#!/usr/bin/env node
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STANDARD_BROWSER_ARGS,
  STANDARD_HEADLESS,
  installPageLogging,
  sleep,
} from './lib/ui-driver.mjs';

const STAGING_FRONTEND = 'https://vantai.tingting.vip';
const STAGING_BACKEND = 'https://vantai.tingting.vip/api';
const QA_DIR = 'qa';
mkdirSync(QA_DIR, { recursive: true });

const logLines = [];
function note(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

async function loginStaging(identifier, password = 'Abc123') {
  const res = await fetch(`${STAGING_BACKEND}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${identifier}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.token;
}

async function run() {
  note('================================================================');
  note('=== STARTING AUTOMATED TESTING ON STAGING (vantai.tingting.vip) ===');
  note('================================================================');

  const adminToken = await loginStaging('admin');
  const cusToken = await loginStaging('tiepvv'); // Tiệp Vũ - customer who reported the issues!
  note('Successfully authenticated admin and tiepvv (CUS) on staging.');

  const browser = await puppeteer.launch({
    headless: STANDARD_HEADLESS,
    args: STANDARD_BROWSER_ARGS,
  });

  try {
    // -------------------------------------------------------------
    // CHECK 1: SHIPMENTS PAGE & DRAWER CONTAINER LEDGER (VISUAL BUG)
    // -------------------------------------------------------------
    note('--- CHECK 1: STAGING /shipments & DRAWER CONTAINER LEDGER ---');
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, cusToken);
      installPageLogging(page, logLines);

      await page.goto(`${STAGING_FRONTEND}/shipments`, { waitUntil: 'networkidle2', timeout: 35000 });
      await sleep(3000);

      // Take screenshot of overview table
      const p_overview = join(QA_DIR, '2026-09-08_staging_01_overview.png');
      await page.screenshot({ path: p_overview });
      note(`Saved overview screenshot: ${p_overview}`);

      // Search for JJCTCHPDY260305 or click first row Chi tiết
      const drawerOpened = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tbody tr, .csc-shipment-table__row'));
        const targetRow = rows.find(r => r.innerText.includes('JJCTCHPDY260305')) || rows[0];
        if (targetRow) {
          const detailBtn = targetRow.querySelector('a, button');
          const allBtns = Array.from(targetRow.querySelectorAll('a, button'));
          const btn = allBtns.find(b => b.textContent?.trim() === 'Chi tiết' || b.getAttribute('aria-label')?.includes('Chi tiết')) || detailBtn;
          if (btn) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      note(`Clicked Chi tiết button on staging: ${drawerOpened}`);
      await sleep(3000);

      // Measure container ledger layout
      const layoutMetrics = await page.evaluate(() => {
        const row = document.querySelector('.cus-container-ledger__row');
        const identityCell = document.querySelector('.cus-container-cell__identity-inner');
        const actionsCol = document.querySelector('.cus-container-cell--actions');
        const errorRow = document.querySelector('.cus-container-row-error');
        const errorBanners = Array.from(document.querySelectorAll('.cus-container-error-banner, [role="alert"]'));

        return {
          rowFound: Boolean(row),
          rowHeight: row ? window.getComputedStyle(row).height : null,
          rowBoundingHeight: row ? row.getBoundingClientRect().height : null,
          identityDisplay: identityCell ? window.getComputedStyle(identityCell).display : null,
          identityVerticalAlign: identityCell ? window.getComputedStyle(identityCell).verticalAlign : null,
          actionsWidth: actionsCol ? window.getComputedStyle(actionsCol).width : null,
          errorRowPresent: Boolean(errorRow),
          errorBannersCount: errorBanners.length,
        };
      });
      note(`Staging Drawer Ledger layout metrics: ${JSON.stringify(layoutMetrics)}`);

      const p_drawer = join(QA_DIR, '2026-09-08_staging_02_drawer_ledger.png');
      await page.screenshot({ path: p_drawer });
      note(`Saved drawer ledger screenshot: ${p_drawer}`);

      await page.close();
    }

    // -------------------------------------------------------------
    // CHECK 2: FORM TẠO LÔ MỚI (/shipments/new) - HÃNG TÀU & POPOVER
    // -------------------------------------------------------------
    note('--- CHECK 2: STAGING /shipments/new (HÃNG TÀU, POPOVER, CLEAR) ---');
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, cusToken);
      installPageLogging(page, logLines);

      await page.goto(`${STAGING_FRONTEND}/shipments/new`, { waitUntil: 'networkidle2', timeout: 35000 });
      await sleep(2500);

      // Check shipping line input
      const shippingLineInput = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const found = inputs.find(i => 
          i.placeholder?.toLowerCase().includes('hãng tàu') ||
          i.getAttribute('aria-label')?.toLowerCase().includes('hãng tàu') ||
          i.closest('label')?.textContent?.toLowerCase().includes('hãng tàu')
        );
        if (found) {
          found.focus();
          found.click();
          return { placeholder: found.placeholder, value: found.value };
        }
        return null;
      });
      note(`Staging shipping line input: ${JSON.stringify(shippingLineInput)}`);
      await sleep(1000);

      // Check dropdown options
      const shippingOptions = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[role="option"], .combobox__option, .uui-combobox-option, .searchable-select__option'));
        return items.map(el => el.textContent?.trim()).filter(Boolean);
      });
      note(`Staging shipping line options count: ${shippingOptions.length}`);
      note(`Staging shipping line sample: ${JSON.stringify(shippingOptions.slice(0, 8))}`);

      // Type custom shipping line
      await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const found = inputs.find(i => 
          i.placeholder?.toLowerCase().includes('hãng tàu') ||
          i.getAttribute('aria-label')?.toLowerCase().includes('hãng tàu')
        );
        if (found) {
          found.value = 'STAGING_CUSTOM_LINE';
          found.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await sleep(500);

      const p_new = join(QA_DIR, '2026-09-08_staging_03_hang-tau.png');
      await page.screenshot({ path: p_new });
      note(`Saved staging shipments/new screenshot: ${p_new}`);

      // Scroll to container section to check popover placement
      await page.evaluate(() => window.scrollTo(0, 450));
      await sleep(500);

      // Pick customer to enable container row
      await page.evaluate(() => {
        const custInput = Array.from(document.querySelectorAll('input')).find(i => 
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
        const item = document.querySelector('[role="option"], .combobox__option, .uui-combobox-option');
        if (item) item.click();
      });
      await sleep(1000);

      // Focus Tuyến đường / Cảng nâng combobox
      await page.evaluate(() => {
        window.scrollTo(0, 450);
        const routeInput = Array.from(document.querySelectorAll('input')).find(i => 
          i.placeholder?.toLowerCase().includes('tuyến đường') ||
          i.getAttribute('aria-label')?.toLowerCase().includes('tuyến đường')
        );
        if (routeInput) {
          routeInput.focus();
          routeInput.click();
        }
      });
      await sleep(800);

      const popoverInfo = await page.evaluate(() => {
        const pop = document.querySelector('[data-placement]');
        return pop ? { placement: pop.getAttribute('data-placement') } : null;
      });
      note(`Staging Popover placement: ${JSON.stringify(popoverInfo)}`);

      const p_popover = join(QA_DIR, '2026-09-08_staging_04_popover_placement.png');
      await page.screenshot({ path: p_popover });
      note(`Saved staging popover placement screenshot: ${p_popover}`);

      await page.close();
    }

    // -------------------------------------------------------------
    // CHECK 3: DISPATCH DETAIL (/dispatch-detail) - ĐÓNG KẾT HỢP & TAGS
    // -------------------------------------------------------------
    note('--- CHECK 3: STAGING /dispatch-detail (ĐÓNG KẾT HỢP & TASK TAGS) ---');
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, adminToken);
      installPageLogging(page, logLines);

      await page.goto(`${STAGING_FRONTEND}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 35000 });
      await sleep(3000);

      // Click first row trigger
      const triggerClicked = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tr.detailed-plan-grid__row'));
        const trigger = rows[0]?.querySelector('.dispatch-assignment-cell__trigger');
        if (trigger) {
          trigger.click();
          return true;
        }
        return false;
      });
      note(`Staging clicked dispatch trigger: ${triggerClicked}`);
      await sleep(1500);

      const dispatchDialogData = await page.evaluate(() => {
        const check = document.querySelector('input[id^="dispatch-combined-"]');
        const tagButtons = Array.from(document.querySelectorAll('.dispatch-assignment-dialog__notes-tag:not(.dispatch-assignment-dialog__notes-tag--add)'));
        return {
          checkboxCombined: check ? { id: check.id, disabled: check.disabled, checked: check.checked } : null,
          tags: tagButtons.map(b => b.textContent?.trim()).filter(Boolean),
        };
      });
      note(`Staging dispatch dialog data: ${JSON.stringify(dispatchDialogData)}`);

      const p_dispatch = join(QA_DIR, '2026-09-08_staging_05_dispatch_dialog.png');
      await page.screenshot({ path: p_dispatch });
      note(`Saved staging dispatch dialog screenshot: ${p_dispatch}`);

      await page.close();
    }

    // -------------------------------------------------------------
    // CHECK 4: CONTAINER LEDGER /shipments-detail?dateScope=all
    // -------------------------------------------------------------
    note('--- CHECK 4: STAGING /shipments-detail (DATE EDIT BUTTONS) ---');
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, adminToken);
      installPageLogging(page, logLines);

      await page.goto(`${STAGING_FRONTEND}/shipments-detail?dateScope=all`, { waitUntil: 'networkidle2', timeout: 35000 });
      await sleep(3000);

      // Click date editor
      const editorOpened = await page.evaluate(() => {
        const triggers = Array.from(document.querySelectorAll('.shipment-container-ledger__cell-editor button'));
        if (triggers.length > 0) {
          triggers[0].click();
          return true;
        }
        return false;
      });
      note(`Staging opened container schedule editor: ${editorOpened}`);
      await sleep(1000);

      const actionButtons = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const save = btns.filter(b => b.textContent?.trim() === 'Lưu');
        const cancel = btns.filter(b => b.textContent?.trim() === 'Hủy');
        return {
          saveFound: save.length > 0,
          cancelFound: cancel.length > 0,
        };
      });
      note(`Staging container ledger action buttons: ${JSON.stringify(actionButtons)}`);

      const p_containers = join(QA_DIR, '2026-09-08_staging_06_container_ledger.png');
      await page.screenshot({ path: p_containers });
      note(`Saved staging container ledger screenshot: ${p_containers}`);

      await page.close();
    }

    // -------------------------------------------------------------
    // CHECK 5: STAGING SHIPMENT DETAIL (/shipments/4) - FACTORY DISPLAY
    // -------------------------------------------------------------
    note('--- CHECK 5: STAGING /shipments/4 (FACTORY DISPLAY & DETAILS) ---');
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.evaluateOnNewDocument((token) => {
        localStorage.setItem('token', token);
      }, cusToken);
      installPageLogging(page, logLines);

      await page.goto(`${STAGING_FRONTEND}/shipments/4`, { waitUntil: 'networkidle2', timeout: 35000 });
      await sleep(3000);

      const factoryInfo = await page.evaluate(() => {
        const text = document.body.innerText;
        return {
          hasAskey: text.includes('ASKEY'),
          hasSunrise: text.includes('SUNRISE'),
          hasDashesOnly: text.includes('Nhà máy / công trường: —'),
        };
      });
      note(`Staging factory display check: ${JSON.stringify(factoryInfo)}`);

      const p_shipment4 = join(QA_DIR, '2026-09-08_staging_07_shipment_detail.png');
      await page.screenshot({ path: p_shipment4 });
      note(`Saved staging shipment 4 detail screenshot: ${p_shipment4}`);

      await page.close();
    }

    // -------------------------------------------------------------
    // CHECK 6: DUPLICATE BL API CHECK ON STAGING
    // -------------------------------------------------------------
    note('--- CHECK 6: STAGING DUPLICATE BL CHECK (API) ---');
    {
      const dupRes = await fetch(`${STAGING_BACKEND}/shipments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cusToken}`,
          'Idempotency-Key': 'staging-dup-test-' + Date.now(),
        },
        body: JSON.stringify({
          serviceType: 'TRUCKING',
          cargoMode: 'FCL',
          shipmentType: 'IMPORT',
          customerId: '1',
          blNumber: 'JJCTCHPDY260305',
          containers: [
            { containerNumber: 'TGHU0000001', containerTypeId: 1 }
          ],
        }),
      });

      const dupData = await dupRes.json();
      note(`Staging duplicate BL response status: ${dupRes.status} (expected 409)`);
      note(`Staging duplicate BL response body: ${JSON.stringify(dupData)}`);
    }

  } finally {
    await browser.close();
  }

  // Write driver log
  const logFile = join(QA_DIR, '2026-09-08_staging_all_checks_ui-driver.log');
  writeFileSync(logFile, logLines.join('\n') + '\n', 'utf8');
  note(`Staging driver log written to: ${logFile}`);
  note('================================================================');
  note('=== ALL STAGING VERIFICATION CHECKS COMPLETED                ===');
  note('================================================================');
}

run().catch((err) => {
  console.error('Staging test execution error:', err);
  process.exit(1);
});
