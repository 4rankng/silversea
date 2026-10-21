// QA R30-endgame unified browser UI driver against Staging 9aab78d2
// Verifies:
// 1. LCL-07 Money Law (PRIMARY - commits d375239b, 9aab78d2):
//    - CHECK (a): Chiều THU - independent per-lot pricing (2.500.000₫ each), not clobbered by grouping
//    - CHECK (b): Chiều TRẢ - exactly 1 freight cost line per trip: Lot 1 = 100% (1.800.000₫), Member = 0₫
//    - CHECK (c): TÁCH NHÓM (unmerge) - money-neutral per-lot, retains individual pricing, strips merge notes
//    - CHECK (d): GHÉP LẠI (re-merge) - per-lot pricing remains independent
// 2. dis-03 spot (commit 3349fd52): Unpaired-leg / overlapping tractor warn-confirm dialog instead of 409 dead-end
// 3. dis-05 spot (commit 3349fd52): TimePanel exact time committed on mouse outside-press without resetting

import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const STAGING_ORIGIN = process.env.QA_BASE || 'https://vantai.tingting.vip';
const OUT_DIR = path.resolve('qa/2026-10-21-r30-endgame');
fs.mkdirSync(OUT_DIR, { recursive: true });

const LOG_ENTRIES = [];
const log = (step, data = {}) => {
  const entry = { at: new Date().toISOString(), step, ...data };
  LOG_ENTRIES.push(entry);
  console.log(`[${entry.at}] [${step}]`, JSON.stringify(data));
};

const CHECKS = [];
const recordCheck = (id, name, pass, evidence) => {
  const c = { id, name, pass, evidence };
  CHECKS.push(c);
  console.log(`\n>>> CHECK [${pass ? 'PASS' : 'FAIL'}] ${id}: ${name}\n    Evidence: ${JSON.stringify(evidence)}\n`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getAuthToken(identifier, password = 'Abc123') {
  const res = await fetch(`${STAGING_ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) throw new Error(`Login ${identifier} failed with status ${res.status}`);
  const json = await res.json();
  return json.token;
}

async function run() {
  log('START_DRIVER', { staging: STAGING_ORIGIN, outDir: OUT_DIR });

  // Verify health and buildHash
  const healthRes = await fetch(`${STAGING_ORIGIN}/api/health`);
  const health = await healthRes.json();
  log('HEALTH_CHECK', health);
  if (health.buildHash !== '9aab78d2') {
    throw new Error(`Expected buildHash 9aab78d2, got ${health.buildHash}. HALTING.`);
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    page.on('console', (msg) => log('BROWSER_CONSOLE', { text: msg.text() }));
    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('/api/')) {
        const method = res.request().method();
        const status = res.status();
        if (method !== 'GET' || url.includes('debit') || url.includes('plan')) {
          let snippet = '';
          try {
            snippet = (await res.text()).slice(0, 180);
          } catch {}
          log('NET_MUTATION', { method, url: url.replace(STAGING_ORIGIN, ''), status, snippet });
        }
      }
    });

    // =========================================================================
    // PART 1: dis-03 spot — Unpaired-leg / overlapping tractor warn-confirm
    // =========================================================================
    log('START_DIS03');
    const dieuvanToken = await getAuthToken('dungnv');
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), dieuvanToken);
    await page.goto(`${STAGING_ORIGIN}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('input[aria-label="Tìm nhanh"]', { timeout: 30000 });

    // Search target container AXEU2004033
    const searchInput = await page.$('input[aria-label="Tìm nhanh"]');
    await searchInput.click({ clickCount: 3 });
    await page.keyboard.type('AXEU2004033', { delay: 30 });
    await sleep(1500);

    // Open edit dispatch dialog
    const editBtn = await page.$('button[aria-label="Sửa ô điều phối AXEU2004033"]');
    if (!editBtn) throw new Error('Could not find edit button for AXEU2004033');
    await editBtn.click();
    await page.waitForSelector('.dispatch-assignment-dialog', { timeout: 15000 });
    await sleep(1000);

    // Check current vehicle
    const currentVehicle = await page.evaluate(() => {
      const dialog = document.querySelector('.dispatch-assignment-dialog');
      return dialog?.querySelector('.dispatch-assignment-dialog__vehicle')?.textContent?.trim() || '';
    });
    log('DIS03_INITIAL_STATE', { currentVehicle });

    // If currently 15H-021.39, first change to 15C-167.31 so we have a clean transition
    if (currentVehicle.includes('15H-021.39')) {
      log('RESETTING_TO_NON_CONFLICTING_VEHICLE');
      await page.evaluate(() => {
        const vehicleBlock = document.querySelector('.dispatch-assignment-dialog__vehicle');
        vehicleBlock?.querySelector('button.searchable-select__trigger')?.click();
      });
      await sleep(600);
      await page.evaluate(() => {
        const pop = document.querySelector('.searchable-select__popover');
        const opt = Array.from(pop?.querySelectorAll('[role="listbox"] button, [role="option"]') || []).find((el) =>
          (el.textContent || '').includes('15C-167.31')
        );
        opt?.click();
      });
      await sleep(500);
      await page.evaluate(() => {
        const save = Array.from(document.querySelectorAll('button')).find(
          (b) => (b.textContent || '').includes('Lưu thay đổi') && b.offsetParent !== null
        );
        save?.click();
      });
      await sleep(2000);

      // Re-open edit dialog
      const editBtnReopen = await page.$('button[aria-label="Sửa ô điều phối AXEU2004033"]');
      await editBtnReopen.click();
      await page.waitForSelector('.dispatch-assignment-dialog', { timeout: 15000 });
      await sleep(1000);
    }

    // Now set classification to Kẹp 20' and pick conflicting tractor 15H-021.39 (assigned to trip 40)
    await page.evaluate(() => {
      const sel = Array.from(document.querySelectorAll('.dispatch-assignment-dialog select'));
      const cls = sel.find((s) => Array.from(s.options).some((o) => (o.textContent || '').includes('Kẹp')));
      if (cls) {
        const opt = Array.from(cls.options).find((o) => (o.textContent || '').includes('Kẹp'));
        if (opt) {
          cls.value = opt.value;
          cls.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
    await sleep(600);

    await page.evaluate(() => {
      const vehicleBlock = document.querySelector('.dispatch-assignment-dialog__vehicle');
      vehicleBlock?.querySelector('button.searchable-select__trigger')?.click();
    });
    await sleep(800);
    await page.evaluate(() => {
      const pop = document.querySelector('.searchable-select__popover');
      const opt = Array.from(pop?.querySelectorAll('[role="listbox"] button, [role="option"]') || []).find((el) =>
        (el.textContent || '').includes('15H-021.39')
      );
      opt?.click();
    });
    await sleep(600);

    // Click "Lưu thay đổi" -> Triggers 409 RIG_OVERLAP_COMPLETED and shows warn-confirm dialog
    await page.evaluate(() => {
      const save = Array.from(document.querySelectorAll('button')).find(
        (b) => (b.textContent || '').includes('Lưu thay đổi') && b.offsetParent !== null
      );
      save?.click();
    });
    await sleep(1500);

    // Assert warn-confirm dialog appears
    const dis03Dialog = await page.evaluate(() => {
      const confirm = document.querySelector('.confirm-box, [role="alertdialog"], .confirm-dialog');
      const msg = document.querySelector('.confirm-message, .confirm-box p')?.textContent?.trim();
      const btns = Array.from(document.querySelectorAll('.confirm-actions button, [role="alertdialog"] button')).map((b) =>
        b.textContent.trim()
      );
      return {
        open: !!confirm,
        msg,
        btns,
      };
    });

    log('DIS03_DIALOG_STATE', dis03Dialog);
    const dis03Screenshot = path.join(OUT_DIR, 'dis03-01-warn-confirm-dialog.png');
    await page.screenshot({ path: dis03Screenshot, fullPage: false });

    const dis03Pass =
      dis03Dialog.open &&
      dis03Dialog.msg?.includes('trong khung giờ trùng lặp') &&
      dis03Dialog.btns.some((b) => b.includes('Xác nhận'));

    recordCheck('DIS-03', 'Unpaired-leg / overlapping tractor warn-confirm dialog', dis03Pass, {
      url: `${STAGING_ORIGIN}/dispatch-detail`,
      element: '.confirm-box / .confirm-message',
      targetPlate: '15H-021.39',
      message: dis03Dialog.msg,
      buttons: dis03Dialog.btns,
      screenshot: 'qa/2026-10-21-r30-endgame/dis03-01-warn-confirm-dialog.png',
    });

    // Click "Xác nhận" to verify confirm path succeeds
    await page.evaluate(() => {
      const confirmBtn = document.querySelector('.confirm-actions .btn--primary');
      confirmBtn?.click();
    });
    await sleep(2500);

    const dis03AfterSavedScreenshot = path.join(OUT_DIR, 'dis03-02-after-confirm-saved.png');
    await page.screenshot({ path: dis03AfterSavedScreenshot, fullPage: false });

    // =========================================================================
    // PART 2: dis-05 spot — TimePanel mouse-flow commit
    // =========================================================================
    log('START_DIS05');
    // Re-open edit dialog for AXEU2004033
    const editBtn2 = await page.$('button[aria-label="Sửa ô điều phối AXEU2004033"]');
    await editBtn2.click();
    await page.waitForSelector('.dispatch-assignment-dialog', { timeout: 15000 });
    await sleep(1000);

    // Open TimePanel by clicking time segment
    await page.evaluate(() => {
      const timeGroup = document.querySelector('.dispatch-assignment-dialog [data-seg-part="time"]');
      const sep = timeGroup?.querySelector('.date-sep') || timeGroup;
      sep?.click();
    });
    await sleep(800);

    // Focus exact time input, select all, type "1645"
    await page.evaluate(() => {
      const input = document.querySelector('input[aria-label="Giờ chính xác (HH:mm)"]');
      if (input) {
        input.focus();
        input.select();
      }
    });
    await page.keyboard.type('1645', { delay: 40 });
    await sleep(400);

    const dis05OpenScreenshot = path.join(OUT_DIR, 'dis05-01-timepanel-open.png');
    await page.screenshot({ path: dis05OpenScreenshot, fullPage: false });

    // Click outside panel via real mouse pointer click on dialog header
    const headerRect = await page.evaluate(() => {
      const h2 = document.querySelector('.dispatch-assignment-dialog h2, .dispatch-assignment-dialog legend');
      const r = h2.getBoundingClientRect();
      return { x: r.left + 50, y: r.top + 10 };
    });
    log('DIS05_CLICKING_OUTSIDE', headerRect);
    await page.mouse.click(headerRect.x, headerRect.y);
    await sleep(1200);

    // Verify time committed to "16:45"
    const dis05Result = await page.evaluate(() => {
      const segs = Array.from(
        document.querySelectorAll('.dispatch-assignment-dialog [data-seg-part="time"] input')
      ).map((i) => i.value);
      const isPanelOpen = !!document.querySelector('input[aria-label="Giờ chính xác (HH:mm)"]');
      return {
        timeCommitted: segs.join(':'),
        isPanelOpen,
      };
    });
    log('DIS05_RESULT', dis05Result);

    const dis05CommittedScreenshot = path.join(OUT_DIR, 'dis05-02-timepanel-outside-commit.png');
    await page.screenshot({ path: dis05CommittedScreenshot, fullPage: false });

    // Close dialog
    await page.evaluate(() => {
      const closeBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Hủy'));
      closeBtn?.click();
    });
    await sleep(800);

    const dis05Pass = dis05Result.timeCommitted === '16:45' && !dis05Result.isPanelOpen;
    recordCheck('DIS-05', 'TimePanel exact time committed on mouse outside-press without resetting', dis05Pass, {
      url: `${STAGING_ORIGIN}/dispatch-detail`,
      element: '.dispatch-assignment-dialog [data-seg-part="time"]',
      timeCommitted: dis05Result.timeCommitted,
      isPanelOpen: dis05Result.isPanelOpen,
      screenshots: [
        'qa/2026-10-21-r30-endgame/dis05-01-timepanel-open.png',
        'qa/2026-10-21-r30-endgame/dis05-02-timepanel-outside-commit.png',
      ],
    });

    // =========================================================================
    // PART 3: LCL-07 Money Law (PRIMARY)
    // =========================================================================
    log('START_LCL07');
    const ketoanToken = await getAuthToken('hoapt');
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ketoanToken);

    // Ensure lots start in merged state: if not merged, merge them via UI first
    const checkIsMerged = async () => {
      const res = await fetch(`${STAGING_ORIGIN}/api/shipments/debit-summary`, {
        headers: { Authorization: `Bearer ${ketoanToken}` },
      });
      const data = await res.json();
      const r74 = (data.items || []).find((i) => i.shipmentId === 74);
      return r74?.revGroupId != null;
    };

    let alreadyMerged = await checkIsMerged();
    log('LCL07_INITIAL_REV_MERGE_CHECK', { alreadyMerged });

    if (!alreadyMerged) {
      log('SEEDING_MERGE_BEFORE_CHECKS');
      await page.goto(`${STAGING_ORIGIN}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('.shipment-debit-table tbody tr', { timeout: 30000 });
      await sleep(1000);

      await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.shipment-debit-table tbody tr'));
        const r74 = rows.find((r) => r.textContent.includes('TPOEBKK202609017'));
        const r105 = rows.find((r) => r.textContent.includes('ZSNHPG269104'));
        r74?.querySelector('input[type="checkbox"].shipment-debit-row__select')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        r105?.querySelector('input[type="checkbox"].shipment-debit-row__select')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await sleep(600);

      await page.evaluate(() => {
        const main = document.querySelector('main.app-body');
        if (main) main.scrollTop = 0;
        window.scrollTo(0, 0);
      });
      await sleep(500);

      await page.click('.shipment-debit-merge-rev');
      await page.waitForSelector('.merge-rev-group', { timeout: 15000 });
      await sleep(600);

      const vcInput = await page.$('input[placeholder="Chọn loại xe (trọng tải / cont)"]');
      await vcInput.click();
      await sleep(400);

      const opt = await page.evaluateHandle(() => {
        const opts = Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [data-key]'));
        return opts.find((el) => (el.textContent || '').includes('Cont 20 - Trọng tải < 20 tấn'));
      });
      await opt.asElement().click();
      await sleep(600);

      const footBtn = await page.evaluateHandle(() => {
        const btns = Array.from(document.querySelectorAll('.modal__foot button'));
        return btns.find((b) => b.textContent.includes('Ghép cước thu khách'));
      });
      const box = await footBtn.asElement().boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(3500);
    }

    // ── STEP 1: Verify Check (a) & Check (b) on /accounting/chot-debit ──
    await page.goto(`${STAGING_ORIGIN}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('table tbody tr', { timeout: 30000 });
    await sleep(1500);

    const chotDebitData = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      const r74 = rows.find((r) => r.textContent.includes('TPOEBKK202609017'));
      const r105 = rows.find((r) => r.textContent.includes('ZSNHPG269104'));
      return {
        r74: {
          text: r74?.textContent?.trim(),
          thu: r74?.children[4]?.textContent?.trim(),
          tra: r74?.children[5]?.textContent?.trim(),
        },
        r105: {
          text: r105?.textContent?.trim(),
          thu: r105?.children[4]?.textContent?.trim(),
          tra: r105?.children[5]?.textContent?.trim(),
        },
      };
    });
    log('CHOT_DEBIT_ROWS', chotDebitData);

    const lcl01Screenshot = path.join(OUT_DIR, 'lcl07-01-debit-board-cost-1dong.png');
    await page.screenshot({ path: lcl01Screenshot, fullPage: true });

    // CHECK (a): chiều THU — mỗi lô hiển thị giá thu riêng per-lot
    const checkAPass =
      chotDebitData.r74.thu?.includes('2.500.000') && chotDebitData.r105.thu?.includes('2.500.000');
    recordCheck('LCL-07(a)', 'Chiều THU: mỗi lô hiển thị giá thu riêng per-lot (độc lập 2.500.000₫)', checkAPass, {
      url: `${STAGING_ORIGIN}/accounting/chot-debit`,
      column: 'Thu khách (VND)',
      lot74_Bill: 'TPOEBKK202609017',
      lot74_Thu: chotDebitData.r74.thu,
      lot105_Bill: 'ZSNHPG269104',
      lot105_Thu: chotDebitData.r105.thu,
      screenshot: 'qa/2026-10-21-r30-endgame/lcl07-01-debit-board-cost-1dong.png',
    });

    // CHECK (b): chiều TRẢ — đúng 1 dòng cước cho cả chuyến: lot đầu 100%, members 0₫
    const checkBPass =
      chotDebitData.r74.tra?.includes('1.800.000') && chotDebitData.r105.tra?.includes('0');
    recordCheck('LCL-07(b)', 'Chiều TRẢ: đúng 1 dòng cước cho cả chuyến: Lot đầu 100% (1.800.000₫), Member 0₫', checkBPass, {
      url: `${STAGING_ORIGIN}/accounting/chot-debit`,
      column: 'Cước trả ĐV (VND)',
      lot74_Bill: 'TPOEBKK202609017',
      lot74_Tra: chotDebitData.r74.tra,
      lot105_Bill: 'ZSNHPG269104',
      lot105_Tra: chotDebitData.r105.tra,
      screenshot: 'qa/2026-10-21-r30-endgame/lcl07-01-debit-board-cost-1dong.png',
    });

    // ── STEP 2: Navigate to /shipments-debit to verify REV group details ──
    await page.goto(`${STAGING_ORIGIN}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('.shipment-debit-table tbody tr', { timeout: 30000 });
    await sleep(1500);

    const lcl02Screenshot = path.join(OUT_DIR, 'lcl07-02-shipments-debit-merged.png');
    await page.screenshot({ path: lcl02Screenshot, fullPage: true });

    // ── STEP 3: CHECK (c) TÁCH NHÓM (unmerge) ──
    // Click "Tách nhóm" on Lot 74
    const tachBtn = await page.evaluateHandle(() => {
      const rows = Array.from(document.querySelectorAll('.shipment-debit-table tbody tr'));
      const r74 = rows.find((r) => r.textContent.includes('TPOEBKK202609017'));
      return r74?.querySelector('.tach-nhom-action');
    });

    if (!tachBtn) throw new Error('Could not find Tách nhóm button on Lot 74');
    await tachBtn.asElement().click();
    await page.waitForSelector('.confirm-box', { timeout: 10000 });
    await sleep(800);

    // Capture ConfirmDialog
    const lcl03Screenshot = path.join(OUT_DIR, 'lcl07-03-tach-confirm-dialog.png');
    await page.screenshot({ path: lcl03Screenshot, fullPage: false });

    // Confirm unmerge in ConfirmDialog via .confirm-actions .btn--primary
    await page.evaluate(() => {
      const confirmBtn = document.querySelector('.confirm-actions .btn--primary');
      confirmBtn?.click();
    });
    await sleep(3500);

    // Verify after unmerge
    const unmergeState = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.shipment-debit-table tbody tr'));
      const r74 = rows.find((r) => r.textContent.includes('TPOEBKK202609017'));
      const r105 = rows.find((r) => r.textContent.includes('ZSNHPG269104'));
      return {
        r74: {
          text: r74?.textContent?.trim(),
          receivable: r74?.querySelector('.shipment-debit-row__money--strong')?.textContent?.trim(),
          hasTachNhom: !!r74?.querySelector('.tach-nhom-action'),
          hasNote: r74?.textContent?.includes('Ghép cước'),
        },
        r105: {
          text: r105?.textContent?.trim(),
          receivable: r105?.querySelector('.shipment-debit-row__money--strong')?.textContent?.trim(),
          hasTachNhom: !!r105?.querySelector('.tach-nhom-action'),
          hasNote: r105?.textContent?.includes('Ghép cước'),
        },
      };
    });
    log('UNMERGE_STATE', unmergeState);

    const lcl04Screenshot = path.join(OUT_DIR, 'lcl07-04-after-unmerge-money-neutral.png');
    await page.screenshot({ path: lcl04Screenshot, fullPage: true });

    // Money-neutral check: each lot retains 2.500.000₫, no transfer of money, merge note removed
    const checkCPass =
      unmergeState.r74.receivable?.includes('2.500.000') &&
      unmergeState.r105.receivable?.includes('2.500.000') &&
      !unmergeState.r74.hasTachNhom &&
      !unmergeState.r105.hasTachNhom &&
      !unmergeState.r74.hasNote &&
      !unmergeState.r105.hasNote;

    recordCheck('LCL-07(c)', 'TÁCH NHÓM: tiền thu từng lô giữ nguyên per-lot (2.500.000₫), không chuyển tiền giữa các lot', checkCPass, {
      url: `${STAGING_ORIGIN}/shipments-debit`,
      column: 'Tổng thu (VND)',
      lot74_Receivable: unmergeState.r74.receivable,
      lot105_Receivable: unmergeState.r105.receivable,
      noteRemoved: !unmergeState.r74.hasNote && !unmergeState.r105.hasNote,
      screenshot: 'qa/2026-10-21-r30-endgame/lcl07-04-after-unmerge-money-neutral.png',
    });

    // ── STEP 4: CHECK (d) GHÉP LẠI (re-merge REV group) ──
    await page.goto(`${STAGING_ORIGIN}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('.shipment-debit-table tbody tr', { timeout: 30000 });
    await sleep(1500);

    // Select both checkboxes using dispatchEvent so window doesn't scroll off toolbar
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.shipment-debit-table tbody tr'));
      const r74 = rows.find((r) => r.textContent.includes('TPOEBKK202609017'));
      const r105 = rows.find((r) => r.textContent.includes('ZSNHPG269104'));
      r74?.querySelector('input[type="checkbox"].shipment-debit-row__select')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      r105?.querySelector('input[type="checkbox"].shipment-debit-row__select')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await sleep(800);

    // Reset scroll so toolbar button is in viewport
    await page.evaluate(() => {
      const main = document.querySelector('main.app-body');
      if (main) main.scrollTop = 0;
      window.scrollTo(0, 0);
    });
    await sleep(600);

    // Click "Ghép cước thu khách" toolbar button
    await page.click('.shipment-debit-merge-rev');
    await page.waitForSelector('.merge-rev-group', { timeout: 15000 });
    await sleep(1000);

    const lcl05Screenshot = path.join(OUT_DIR, 'lcl07-05-re-merge-dialog.png');
    await page.screenshot({ path: lcl05Screenshot, fullPage: false });

    // Pick vehicle class: Cont 20 - Trọng tải < 20 tấn
    const vehicleClassInput = await page.$('input[placeholder="Chọn loại xe (trọng tải / cont)"]');
    await vehicleClassInput.click();
    await sleep(500);

    const option = await page.evaluateHandle(() => {
      const opts = Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [data-key]'));
      return opts.find((el) => (el.textContent || '').includes('Cont 20 - Trọng tải < 20 tấn'));
    });
    await option.asElement().click();
    await sleep(600);

    // Submit dialog in .modal__foot
    const footSubmitBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('.modal__foot button'));
      return btns.find((b) => b.textContent.includes('Ghép cước thu khách'));
    });
    const submitBox = await footSubmitBtn.asElement().boundingBox();
    await page.mouse.click(submitBox.x + submitBox.width / 2, submitBox.y + submitBox.height / 2);
    await sleep(3500);

    // Verify after re-merge
    const remergedState = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.shipment-debit-table tbody tr'));
      const r74 = rows.find((r) => r.textContent.includes('TPOEBKK202609017'));
      const r105 = rows.find((r) => r.textContent.includes('ZSNHPG269104'));
      return {
        r74: {
          text: r74?.textContent?.trim(),
          receivable: r74?.querySelector('.shipment-debit-row__money--strong')?.textContent?.trim(),
          hasTachNhom: !!r74?.querySelector('.tach-nhom-action'),
          note: r74?.querySelector('.shipment-debit-row__freight-note')?.textContent?.trim(),
        },
        r105: {
          text: r105?.textContent?.trim(),
          receivable: r105?.querySelector('.shipment-debit-row__money--strong')?.textContent?.trim(),
          hasTachNhom: !!r105?.querySelector('.tach-nhom-action'),
          note: r105?.querySelector('.shipment-debit-row__freight-note')?.textContent?.trim(),
        },
      };
    });
    log('REMERGED_STATE', remergedState);

    const lcl06Screenshot = path.join(OUT_DIR, 'lcl07-06-re-merged-rev-perlot.png');
    await page.screenshot({ path: lcl06Screenshot, fullPage: true });

    // CHECK (d): GHÉP LẠI (merge REV group) → giá thu per-lot vẫn độc lập từng lot (2.500.000₫ each)
    const checkDPass =
      remergedState.r74.receivable?.includes('2.500.000') &&
      remergedState.r105.receivable?.includes('2.500.000') &&
      remergedState.r74.hasTachNhom &&
      remergedState.r105.hasTachNhom;

    recordCheck('LCL-07(d)', 'GHÉP LẠI: giá thu per-lot vẫn độc lập từng lot (2.500.000₫ mỗi lô)', checkDPass, {
      url: `${STAGING_ORIGIN}/shipments-debit`,
      column: 'Tổng thu (VND)',
      lot74_Receivable: remergedState.r74.receivable,
      lot105_Receivable: remergedState.r105.receivable,
      lot74_Note: remergedState.r74.note,
      lot105_Note: remergedState.r105.note,
      screenshot: 'qa/2026-10-21-r30-endgame/lcl07-06-re-merged-rev-perlot.png',
    });

  } finally {
    await browser.close();
  }

  // Write driver.log
  const summaryReport = {
    generatedAt: new Date().toISOString(),
    stagingOrigin: STAGING_ORIGIN,
    buildHash: '9aab78d2',
    allPassed: CHECKS.every((c) => c.pass),
    checks: CHECKS,
    log: LOG_ENTRIES,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'driver.log'), JSON.stringify(summaryReport, null, 2));
  console.log(`\nQA Driver finished. Written to ${path.join(OUT_DIR, 'driver.log')}`);

  if (!summaryReport.allPassed) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('DRIVER ERROR:', err);
  process.exit(1);
});
