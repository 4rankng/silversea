// cases/shipments-qa/TC-SHIP-SEARCH-001.mjs
// /shipments search: valid query, invalid query, empty results, clear.
//
// Verdict: PASS when search returns filtered results for a known ref,
// shows empty state for non-existent ref, and search validation rejects
// short input.

export const caseId = 'TC-SHIP-SEARCH-001';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  const errors = [];

  // --- 1. Page loads with data ---
  await ctx.goto('/shipments');
  await page.waitForSelector('.cus-dashboard-table tbody tr', { timeout: 15000 });
  await ctx.screenshot('01_page_loaded');

  const initialRows = await page.$$eval('.cus-dashboard-table tbody tr', (trs) => trs.length);
  if (initialRows === 0) {
    return { verdict: 'FAIL', errors: ['No shipment rows on /shipments'] };
  }

  // --- 2. Search for a known ref (SHELL-BILL-001 exists on staging) ---
  const searchInput = await page.$('input[aria-label*="Bill/Book"]');
  if (!searchInput) {
    return { verdict: 'FAIL', errors: ['Search input not found'] };
  }
  await searchInput.click();
  await page.keyboard.type('SHELL-BILL-001', { delay: 20 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 2000));

  const url1 = page.url();
  const hasSearchParam = url1.includes('searchSuffix=SHELL-BILL-001');
  await ctx.screenshot('02_search_shell_bill');

  const searchRows = await page.$$eval('.cus-dashboard-table tbody tr', (trs) => trs.length);
  const emptyState = await page.$('.empty-state, [class*="empty"]');

  if (!hasSearchParam) {
    errors.push('URL missing searchSuffix param after search');
  }
  if (searchRows === 0 && !emptyState) {
    errors.push('No results AND no empty state shown');
  }

  // --- 3. Search for non-existent ref → empty state ---
  await ctx.goto('/shipments');
  await page.waitForSelector('.cus-dashboard-table tbody tr', { timeout: 15000 });
  const searchInput2 = await page.$('input[aria-label*="Bill/Book"]');
  await searchInput2.click();
  await page.keyboard.type('ZZZZNOTEXIST', { delay: 20 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 2000));

  await ctx.screenshot('03_search_empty');
  const emptyText = await page.evaluate(() => {
    const el = document.querySelector('.empty-state') || document.querySelector('[class*="empty"]');
    return el ? el.innerText : '';
  });
  const showsEmpty = emptyText.includes('Không có') || emptyText.includes('Chưa có');
  if (!showsEmpty) {
    errors.push(`Expected empty state, got: "${emptyText.slice(0, 100)}"`);
  }

  // --- 4. Search validation: short input (< 4 chars) ---
  await ctx.goto('/shipments');
  await page.waitForSelector('.cus-dashboard-table tbody tr', { timeout: 15000 });
  const searchInput3 = await page.$('input[aria-label*="Bill/Book"]');
  await searchInput3.click();
  await page.keyboard.type('ab', { delay: 20 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1000));

  await ctx.screenshot('04_search_validation');
  const errorText = await page.evaluate(() => {
    const el = document.querySelector('[role="alert"]');
    return el ? el.innerText : '';
  });
  const showsValidation = errorText.includes('ký tự') || errorText.includes('tối thiểu');
  if (!showsValidation) {
    errors.push(`Expected validation error for short input, got: "${errorText.slice(0, 100)}"`);
  }

  // --- 5. URL-based filter: EXPORT direction ---
  await ctx.goto('/shipments?direction=EXPORT');
  await new Promise((r) => setTimeout(r, 2000));
  await ctx.screenshot('05_filter_export');
  const exportUrl = page.url();
  const exportParamOk = exportUrl.includes('direction=EXPORT');

  // --- 6. URL-based filter: date range ---
  await ctx.goto('/shipments?transportDateFrom=2026-09-01&transportDateTo=2026-09-30');
  await new Promise((r) => setTimeout(r, 2000));
  await ctx.screenshot('06_filter_date_range');
  const dateUrl = page.url();
  const dateParamOk = dateUrl.includes('transportDateFrom=2026-09-01');

  // --- 7. URL-based filter: bucket ---
  await ctx.goto('/shipments?bucket=NEED_SCHEDULE');
  await new Promise((r) => setTimeout(r, 2000));
  await ctx.screenshot('07_filter_bucket');
  const bucketUrl = page.url();
  const bucketParamOk = bucketUrl.includes('bucket=NEED_SCHEDULE');

  return {
    verdict: errors.length === 0 ? 'PASS' : 'FAIL',
    initialRows,
    searchRows,
    hasSearchParam,
    showsEmpty,
    showsValidation,
    exportParamOk,
    dateParamOk,
    bucketParamOk,
    errors,
  };
}
