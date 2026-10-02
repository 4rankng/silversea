// cases/shipments-qa/TC-SHIP-SEARCH-001.mjs
// /shipments search: valid query, invalid query, empty results, clear.
//
// Fixture discipline: the workboard is opened at `?limit=200` (the widest page
// size the app itself offers) and the "known ref" is READ off a rendered row.
// The old case typed the hardcoded `SHELL-BILL-001` and commented that it
// "exists on staging" — on any env without it the rung was a false FAIL, and
// the comment named an environment the run never touched. When no rendered row
// carries a searchable ref the case is BLOCKED, naming the env it ran against.
//
// The search field is addressed by its ACCESSIBLE NAME
// (ShipmentsPage.tsx:490 renders `ariaLabel: 'Tìm lô hàng'`), not by a
// placeholder substring: the old `input[placeholder*="Bill/Book"]` matched
// nothing, the placeholder now reading 'Bill, Book, Cont, Tờ khai...'.
//
// Verdict: PASS when search returns filtered results for a rendered ref,
// shows an empty state for a non-existent ref, and sub-minimum input is a no-op.

import { QE, SEL } from '../../lib/selectors.mjs';

export const caseId = 'TC-SHIP-SEARCH-001';
export const role = 'ADMIN';

const TABLE = '.cus-dashboard-table';
const SEARCH = SEL.searchInput('Tìm lô hàng');

export default async function (ctx) {
  const { page } = ctx;
  const errors = [];
  const envTag = `[${ctx.env.env}]`;

  // --- 1. Page loads with data ---
  await ctx.goto('/shipments?limit=200');
  await page.waitForSelector(`${TABLE} tbody tr`, { timeout: 15000 });
  await ctx.screenshot('01_page_loaded');

  const initialRows = await page.$$eval(`${TABLE} tbody tr`, (trs) => trs.length);
  if (initialRows === 0) {
    return { verdict: 'FAIL', errors: [`${envTag} no shipment rows on /shipments`] };
  }

  // --- 2. Search for a ref read off a rendered row (never a hardcoded one) ---
  const knownRef = await page.evaluate(QE.firstRenderedBillOrBookRef);
  if (!knownRef) {
    return {
      verdict: 'BLOCKED',
      initialRows,
      errors: [`${envTag} none of the ${initialRows} rendered /shipments rows carries a Bill/Booking ref — the valid-query rung needs one`],
    };
  }
  const searchInput = await page.$(SEARCH);
  if (!searchInput) {
    return { verdict: 'FAIL', knownRef, errors: [`${envTag} search input not found by accessible name (${SEARCH})`] };
  }
  await searchInput.click();
  await page.keyboard.type(knownRef, { delay: 20 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 2000));

  const url1 = page.url();
  const hasSearchParam = url1.includes(`searchSuffix=${encodeURIComponent(knownRef)}`);
  await ctx.screenshot('02_search_known_ref');

  const searchRows = await page.$$eval(`${TABLE} tbody tr`, (trs) => trs.length);
  if (!hasSearchParam) {
    errors.push(`${envTag} URL missing searchSuffix=${knownRef} after search (got ${url1})`);
  }
  // A ref the board itself renders must narrow the list to at least its own
  // row: zero rows means the search dropped the match, not an empty board.
  if (searchRows === 0) {
    errors.push(`${envTag} searching the rendered ref "${knownRef}" returned 0 rows`);
  }

  // --- 3. Search for non-existent ref → empty state ---
  await ctx.goto('/shipments?limit=200');
  await page.waitForSelector(`${TABLE} tbody tr`, { timeout: 15000 });
  const searchInput2 = await page.$(SEARCH);
  if (!searchInput2) {
    return { verdict: 'FAIL', knownRef, errors: [`${envTag} search input missing after re-navigation (${SEARCH})`] };
  }
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
    errors.push(`${envTag} expected an empty state for a non-existent ref, got: "${emptyText.slice(0, 100)}"`);
  }

  // --- 4. Short input (< 4 chars): silent no-op, list unchanged ---
  // Contract: a sub-minimum query never reaches the endpoint
  // (CUS_SEARCH_PATTERN is {4,64} — shared/src/schemas/cus-shipment-workspace.ts),
  // so the list must come back untouched.
  await ctx.goto('/shipments?limit=200');
  await page.waitForSelector(`${TABLE} tbody tr`, { timeout: 15000 });
  const searchInput3 = await page.$(SEARCH);
  if (!searchInput3) {
    return { verdict: 'FAIL', knownRef, errors: [`${envTag} search input missing on the third pass (${SEARCH})`] };
  }
  await searchInput3.click();
  await page.keyboard.type('ab', { delay: 20 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1500));

  await ctx.screenshot('04_search_validation');
  const rowsAfterShort = await page.$$eval(`${TABLE} tbody tr`, (trs) => trs.length);
  const noFilterApplied = rowsAfterShort === initialRows;
  if (!noFilterApplied) {
    errors.push(`${envTag} short input filtered the list (${rowsAfterShort} vs ${initialRows}) — expected a no-op`);
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
    knownRef,
    initialRows,
    searchRows,
    hasSearchParam,
    showsEmpty,
    noFilterApplied,
    rowsAfterShort,
    exportParamOk,
    dateParamOk,
    bucketParamOk,
    errors,
  };
}
