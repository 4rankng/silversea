import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';

const OUT = 'qa/2026-11-07-lane-f2/';
const BASE = process.env.BASE_URL || 'http://localhost:7191';
const log = (msg) => {
  console.log(msg);
  appendFileSync(`${OUT}probe-707-434.log`, `${msg}\n`);
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
  await new Promise(r => setTimeout(r, 1500));

  // Find cell in Phân bổ nhà xe column
  const clickedCell = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('td'));
    const cell = cells.find(c => c.textContent.includes('Chưa chọn') || c.textContent.includes('SilverSea') || c.className.includes('carrier'));
    if (cell) {
      cell.click();
      return true;
    }
    return false;
  });
  log(`Clicked Phân bổ cell: ${clickedCell}`);
  await new Promise(r => setTimeout(r, 1000));

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

  // Check the select dropdown inside popover if opened
  const innerSelectClicked = await page.evaluate(() => {
    const selectTrigger = document.querySelector('.dispatch-allocation-popover [data-input-wrapper], .dispatch-allocation-popover select, .dispatch-allocation-popover button[aria-haspopup="listbox"]');
    if (selectTrigger) {
      selectTrigger.click();
      return true;
    }
    return false;
  });
  log(`SIL-707 inner select clicked: ${innerSelectClicked}`);
  await new Promise(r => setTimeout(r, 600));

  const innerSelectMenu = await page.evaluate(() => {
    const menu = document.querySelector('[role="listbox"], [role="presentation"] [data-popover-settle-gate], .ds-uui-select__popover');
    if (!menu) return { found: false };
    const popover = menu.closest('[data-popover-gate]') || menu.parentElement;
    const rect = (popover || menu).getBoundingClientRect();
    return {
      found: true,
      width: rect.width,
      height: rect.height,
    };
  });
  log(`SIL-707 inner select dropdown: ${JSON.stringify(innerSelectMenu)}`);

  await page.screenshot({ path: `${OUT}sil-707-probe-1440.png` });

  // -------------------------------------------------------------
  // Test SIL-434: Setting Từ trước trên /shipments (From-first)
  // -------------------------------------------------------------
  log('\n=== Testing SIL-434 on /shipments ===');
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  // Check filter bar for date inputs (Từ ngày, Đến ngày)
  const dateFilterState = await page.evaluate(() => {
    const fromInput = document.querySelector('input[aria-label*="Từ ngày"], input[id*="from"], [data-date-boundary] input');
    const toInput = document.querySelector('input[aria-label*="Đến ngày"], input[id*="to"], [data-date-boundary]:last-child input');
    return {
      hasFrom: !!fromInput,
      fromVal: fromInput ? fromInput.value : null,
      hasTo: !!toInput,
      toVal: toInput ? toInput.value : null,
    };
  });
  log(`Date filter initial: ${JSON.stringify(dateFilterState)}`);

  // Let's test what happens when we try to set From date ahead of To date
  // e.g. using page.evaluate or typing
  const fromFirstTest = await page.evaluate(() => {
    const fromGroup = document.querySelector('.date-range-fields__from') || document.querySelector('[aria-label="Khoảng ngày"] .date-seg-group');
    if (!fromGroup) return { found: false, error: 'no from group' };
    const inputs = fromGroup.querySelectorAll('input');
    // Day, Month, Year segments
    return {
      found: true,
      segments: Array.from(inputs).map(i => ({ label: i.getAttribute('aria-label') || i.name, val: i.value, max: i.max })),
    };
  });
  log(`SIL-434 fromGroup inspect: ${JSON.stringify(fromFirstTest)}`);

  // Try to set From date to a future date, say 25/11/2026 or 10/11/2026
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
    return { success: true };
  });
  log(`SIL-434 typing simulated: ${JSON.stringify(typingResult)}`);
  await new Promise(r => setTimeout(r, 1000));

  const afterTypingState = await page.evaluate(() => {
    const fromGroup = document.querySelector('.date-range-fields__from');
    const toGroup = document.querySelector('.date-range-fields__to');
    const getVals = (g) => g ? Array.from(g.querySelectorAll('input[type="text"]')).map(i => i.value).join('/') : '';
    return {
      from: getVals(fromGroup),
      to: getVals(toGroup),
      url: location.search,
    };
  });
  log(`SIL-434 after setting From: ${JSON.stringify(afterTypingState)}`);
  await page.screenshot({ path: `${OUT}sil-434-probe-1440.png` });

} catch (err) {
  log(`Error during probe: ${err.stack || err.message}`);
} finally {
  await browser.close();
  log('Probe finished.');
}
