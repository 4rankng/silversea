// Card 191026160000 (2a/2b/2c/2e repro, bounded) — set the period to the
// current month first, then: select-all, row-click highlight, Xuất Debit Note.
import { login, launch, makeLogger, tokenPage, sleep, BASE } from './2026-10-19_chiphi2b-lib.mjs';

const log = makeLogger('2026-10-19_chiphi2-b_repro/debit-before2');

async function typeInto(page, sel, value) {
  await page.click(sel, { clickCount: 3 });
  await page.type(sel, value, { delay: 20 });
}

const token = await login('ketoan');
log('login ketoan OK');
const browser = await launch();
try {
  const page = await tokenPage(browser, token, `${BASE}/accounting/chot-debit`);
  await sleep(9000); // initial full-board paint (8864 rows, shared dev DB)
  // Narrow to current month: DD / MM / YYYY segmented inputs.
  await typeInto(page, '#debit-board-date-range', '01');
  await typeInto(page, '#debit-board-date-range-to + input, input[placeholder="MM"]', '10');
  log('typed from-day + month (segments auto-advance)');
  await sleep(600);
  // The year segment: find sibling inputs inside the "to" field group.
  const groups = await page.evaluate(() => {
    const el = document.getElementById('debit-board-date-range');
    const wrap = el?.closest('div');
    return [...(wrap?.querySelectorAll('input') ?? [])].map((i) => ({ id: i.id, ph: i.placeholder, v: i.value }));
  });
  log(`from group inputs: ${JSON.stringify(groups)}`);
  await sleep(3500);
  await log.shot(page, '01-board-october.png');
  const counts = await page.evaluate(() => ({
    rows: document.querySelectorAll('table.debit-board tbody tr').length,
    selectAll: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => t.includes('Chọn tất cả')) ?? null,
  }));
  log(`board: ${JSON.stringify(counts)}`);

  // ── 2a: select-all ──
  if (counts.selectAll) {
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Chọn tất cả'));
      hit.scrollIntoView({ block: 'center' });
      hit.click();
    });
    await sleep(2000);
    await log.shot(page, '02-after-select-all.png');
    const state = await page.evaluate(() => ({
      selectedRows: document.querySelectorAll('tr[data-selected]').length,
      note: [...document.querySelectorAll('.debit-note')].map((e) => e.textContent.trim()).join(' | '),
      chooseDebit: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => t.includes('Chọn Debit')) ?? null,
    }));
    log(`after select-all: ${JSON.stringify(state)}`);
  }

  // ── 2c: single row click → highlight visibility ──
  const firstRow = await page.$('table.debit-board tbody tr');
  if (firstRow) {
    await firstRow.click();
    await sleep(900);
    await log.shot(page, '03-after-row-click.png');
    const style = await page.evaluate(() => {
      const tr = document.querySelector('tr[data-selected]');
      if (!tr) return 'NO tr[data-selected]';
      const td = tr.querySelector('td');
      return `bg=${getComputedStyle(td).backgroundColor} rowText=${tr.innerText.slice(0, 60).replace(/\n/g, '/')}`;
    });
    log(`selected row: ${style}`);
  }

  // ── 2e: Xuất Debit Note ──
  const respP = page.waitForResponse((r) => r.url().includes('debit-note'), { timeout: 25000 }).catch(() => null);
  const clicked = await page.evaluate(() => {
    const hit = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Xuất Debit Note') && !b.disabled);
    if (!hit) return null;
    hit.click();
    return hit.textContent.trim();
  });
  log(`export click: ${JSON.stringify(clicked)}`);
  if (clicked) {
    const resp = await respP;
    await sleep(2500);
    await log.shot(page, '04-after-export-click.png');
    if (resp) {
      log(`export API ${resp.request().method()} ${resp.url()} → ${resp.status()}`);
      let bodyText = '';
      try { bodyText = await resp.text(); } catch { /* empty */ }
      log(`export API body: ${bodyText.slice(0, 500)}`);
    } else log('export API: no debit-note request observed');
    const banner = await page.evaluate(() => [...document.querySelectorAll('[role="alert"], [role="status"], .debit-note')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 3).join(' | '));
    log(`banner after export: ${banner}`);
  }
  log('REPRO DONE');
} finally {
  await browser.close();
}
