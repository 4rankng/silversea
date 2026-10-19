// Card 191026160000 (2b measure) — with the current-month default now in
// place, load /accounting/chot-debit and measure header-vs-body column
// alignment (x positions + widths) of the first board table.
import { login, launch, makeLogger, tokenPage, sleep, BASE } from './2026-10-19_chiphi2b-lib.mjs';

const log = makeLogger('2026-10-19_chiphi2-b_repro/debit-align');
const token = await login('ketoan');
const browser = await launch();
try {
  const page = await tokenPage(browser, token, `${BASE}/accounting/chot-debit`);
  await sleep(6000);
  await log.shot(page, '01-october-default.png');
  const report = await page.evaluate(() => {
    const table = document.querySelector('table.debit-board');
    if (!table) return { error: 'no table.debit-board' };
    const headRows = table.querySelectorAll('thead tr');
    const bodyFirstRow = table.querySelector('tbody tr');
    // Collect the SECOND header row cells (leaf headers) and body cells.
    const leafHeaderRow = headRows.length > 1 ? headRows[headRows.length - 1] : headRows[0];
    const headerCells = [...leafHeaderRow.querySelectorAll('th')].map((th) => {
      const r = th.getBoundingClientRect();
      return { label: th.textContent.trim().slice(0, 18), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
    });
    // For rowSpan=2 headers (first row), record them separately.
    const spanning = [...headRows[0].querySelectorAll('th[rowspan="2"]')].map((th) => {
      const r = th.getBoundingClientRect();
      return { label: th.textContent.trim().slice(0, 18), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
    });
    const bodyCells = [...bodyFirstRow.querySelectorAll('td')].map((td) => {
      const r = td.getBoundingClientRect();
      return { label: td.textContent.trim().slice(0, 18), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
    });
    // Match each body cell to the nearest header cell by left position and
    // report drift > 1px.
    const leaves = [...spanning, ...headerCells];
    const drift = bodyCells.map((td) => {
      const nearest = leaves.reduce((best, h) => (Math.abs(h.left - td.left) < Math.abs(best.left - td.left) ? h : best), leaves[0]);
      return { body: td.label, header: nearest.label, dLeft: Math.round(td.left - nearest.left), dWidth: Math.round(td.w - nearest.w) };
    });
    return {
      rows: document.querySelectorAll('table.debit-board tbody tr').length,
      selectAll: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => t.includes('Chọn tất cả')) ?? null,
      spanningCount: spanning.length, leafCount: headerCells.length, bodyCellCount: bodyCells.length,
      drift,
      tableWidth: Math.round(table.getBoundingClientRect().width),
      wrapScrollWidth: table.parentElement.scrollWidth,
    };
  });
  log(JSON.stringify(report, null, 1));
  log('MEASURE DONE');
} finally {
  await browser.close();
}
