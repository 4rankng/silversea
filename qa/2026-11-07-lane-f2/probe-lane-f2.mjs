import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';

const OUT = 'qa/2026-11-07-lane-f2/';
const BASE = process.env.BASE_URL || 'http://localhost:7191';
const log = (msg) => {
  console.log(msg);
  appendFileSync(`${OUT}probe-lane-f2.log`, `${msg}\n`);
};

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  log(`[1] Login as dieuvan on ${BASE}...`);
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input');
  await page.type('input:not([type="password"])', 'dieuvan');
  await page.type('input[type="password"]', 'Abc123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    page.click('button[type="submit"], button:not([type])'),
  ]);
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
  log(`Login ok, on ${await page.evaluate(() => location.pathname)}`);

  // -------------------------------------------------------------
  // Test SIL-707: Popover chọn nhà xe nội bộ on /dispatch
  // -------------------------------------------------------------
  log('\n=== Testing SIL-707 on /dispatch ===');
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  const clickedCell = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('td'));
    const cell = cells.find(
      (c) =>
        c.textContent.includes('Chưa chọn') ||
        c.textContent.includes('SilverSea') ||
        c.className.includes('carrier'),
    );
    if (cell) {
      cell.click();
      return true;
    }
    return false;
  });
  log(`Clicked Phân bổ cell: ${clickedCell}`);
  await new Promise((r) => setTimeout(r, 1000));

  const popoverDims = await page.evaluate(() => {
    const pop = document.querySelector('.dispatch-allocation-popover');
    if (!pop) return { found: false };
    const rect = pop.getBoundingClientRect();
    const style = window.getComputedStyle(pop);
    return {
      found: true,
      width: rect.width,
      height: rect.height,
      maxHeight: style.maxHeight,
      overflowY: style.overflowY,
      top: rect.top,
      bottom: rect.bottom,
    };
  });
  log(`SIL-707 .dispatch-allocation-popover: ${JSON.stringify(popoverDims)}`);
  await page.screenshot({ path: `${OUT}sil707-popover-height.png` });

  // -------------------------------------------------------------
  // Test SIL-434: Setting Từ trước trên /shipments (From-first)
  // -------------------------------------------------------------
  log('\n=== Testing SIL-434 on /shipments ===');
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  // Set From date to 15/11/2026
  const typingResult = await page.evaluate(() => {
    const fromGroup = document.querySelector('.date-range-fields__from');
    if (!fromGroup) return { success: false, reason: 'fromGroup not found' };
    const inputs = Array.from(fromGroup.querySelectorAll('input[type="text"]'));
    if (inputs.length < 3) return { success: false, reason: `only ${inputs.length} inputs found` };
    const [dayIn, monthIn, yearIn] = inputs;
    dayIn.value = '15';
    dayIn.dispatchEvent(new Event('input', { bubbles: true }));
    dayIn.dispatchEvent(new Event('change', { bubbles: true }));
    monthIn.value = '11';
    monthIn.dispatchEvent(new Event('input', { bubbles: true }));
    monthIn.dispatchEvent(new Event('change', { bubbles: true }));
    yearIn.value = '2026';
    yearIn.dispatchEvent(new Event('input', { bubbles: true }));
    yearIn.dispatchEvent(new Event('change', { bubbles: true }));
    dayIn.focus();
    dayIn.blur();
    return { success: true };
  });
  log(`SIL-434 typing simulated: ${JSON.stringify(typingResult)}`);
  await new Promise((r) => setTimeout(r, 1000));

  const afterTypingState = await page.evaluate(() => {
    const fromGroup = document.querySelector('.date-range-fields__from');
    const toGroup = document.querySelector('.date-range-fields__to');
    const getVals = (g) =>
      g
        ? Array.from(g.querySelectorAll('input[type="text"]'))
            .map((i) => i.value)
            .join('/')
        : '';
    return {
      from: getVals(fromGroup),
      to: getVals(toGroup),
    };
  });
  log(`SIL-434 after setting From: ${JSON.stringify(afterTypingState)}`);
  await page.screenshot({ path: `${OUT}sil434-from-first-ok.png` });

  // -------------------------------------------------------------
  // Test SIL-653: Container number disabled on dispatched lot
  // -------------------------------------------------------------
  log('\n=== Testing SIL-653 on /shipments ===');
  // Find a dispatched shipment or inspect edit page
  const editDispatched = await page.evaluate(() => {
    // Look for rows with "Đã điều xe" or "Hoàn thành"
    const rows = Array.from(document.querySelectorAll('tr'));
    for (const tr of rows) {
      if (tr.textContent.includes('Đã điều xe') || tr.textContent.includes('Hoàn thành')) {
        const editBtn = tr.querySelector('button[aria-label*="Sửa"], button:has(svg), a[href*="edit"]');
        if (editBtn) {
          editBtn.click();
          return { found: true, text: tr.textContent.slice(0, 100) };
        }
      }
    }
    return { found: false };
  });
  log(`SIL-653 edit dispatched clicked: ${JSON.stringify(editDispatched)}`);
  await new Promise((r) => setTimeout(r, 1500));

  // If inside edit modal or page, inspect container inputs
  const contInputsInfo = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[id*="container-"][id*="-number"]'));
    return inputs.map((inp) => ({
      id: inp.id,
      disabled: inp.disabled,
      title: inp.title || inp.parentElement?.title,
      value: inp.value,
    }));
  });
  log(`SIL-653 container inputs: ${JSON.stringify(contInputsInfo)}`);
  await page.screenshot({ path: `${OUT}sil653-cont-disabled.png` });

  // -------------------------------------------------------------
  // Test SIL-718: Kẹp pair plate mismatch confirm on /dispatch-detail
  // -------------------------------------------------------------
  log('\n=== Testing SIL-718 on /dispatch-detail ===');
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 2000));

  // Find a Kẹp row (classification DOUBLE / "Kẹp")
  const openedEditor = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.dispatch-assignment-cell__carrier--action'));
    if (cells.length > 0) {
      cells[0].click();
      return true;
    }
    return false;
  });
  log(`SIL-718 opened editor: ${openedEditor}`);
  await new Promise((r) => setTimeout(r, 1000));

  await page.screenshot({ path: `${OUT}sil718-dispatch-editor-open.png` });

  // Verify modal is open
  const modalOpen = await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    return !!modal;
  });
  log(`SIL-718 modal open: ${modalOpen}`);

} catch (err) {
  log(`Error during probe: ${err.stack || err.message}`);
} finally {
  await browser.close();
  log('Probe finished.');
}
