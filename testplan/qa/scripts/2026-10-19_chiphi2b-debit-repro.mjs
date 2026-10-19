// Card 191026160000 (2a/2b/2c/2e repro) — /accounting/chot-debit as ketoan.
// Step 1: load page with a NARROW date range set before the board renders, so
// the drive is deterministic and fast on the shared dev DB.
import { login, launch, makeLogger, tokenPage, clickButtonByText, sleep, BASE } from './2026-10-19_chiphi2b-lib.mjs';

const log = makeLogger('2026-10-19_chiphi2-b_repro/debit-before');

const token = await login('ketoan');
log('login ketoan OK');
const browser = await launch();
try {
  const page = await tokenPage(browser, token, `${BASE}/accounting/chot-debit`);
  log('page loaded, waiting for first paint…');
  await sleep(8000); // 8864-row initial board paint on the shared dev DB
  log(`URL: ${page.url()}`);
  // Narrow the period BEFORE interacting: type into the date inputs.
  const dateSet = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')];
    const from = inputs.find((i) => i.name?.includes('from') || i.id?.includes('from') || i.placeholder?.toLowerCase().includes('từ'));
    return { count: inputs.length, sample: inputs.slice(0, 8).map((i) => ({ id: i.id, name: i.name, type: i.type, ph: i.placeholder })) };
  });
  log(`inputs: ${JSON.stringify(dateSet)}`);
  await log.shot(page, '01-board-initial.png');

  // ── 2a: select-all ──
  const allBtnText = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    return btns.map((b) => b.textContent.trim()).filter((t) => t.includes('Chọn tất cả'))[0] ?? null;
  });
  log(`select-all button label: ${JSON.stringify(allBtnText)}`);
  if (allBtnText) {
    await clickButtonByText(page, 'Chọn tất cả');
    await sleep(2500);
    await log.shot(page, '02-after-select-all.png');
    const selCount = await page.evaluate(() => document.querySelectorAll('tr[data-selected]').length);
    const line = (await page.evaluate(() => document.body.innerText)).split('\n').find((l) => l.includes('Đã chọn')) ?? '(none)';
    log(`after select-all: ${line} · tr[data-selected]=${selCount}`);
  }

  // ── 2c: single row click → highlight visibility ──
  const firstRow = await page.$('table.debit-board tbody tr');
  if (firstRow) {
    await firstRow.click();
    await sleep(1200);
    await log.shot(page, '03-after-row-click.png');
    const style = await page.evaluate(() => {
      const tr = document.querySelector('tr[data-selected]');
      if (!tr) return 'NO tr[data-selected]';
      const td = tr.querySelector('td');
      return `bg=${getComputedStyle(td).backgroundColor}`;
    });
    log(`selected row td bg: ${style}`);
  }

  // ── 2e: Xuất Debit Note ──
  const respP = page.waitForResponse((r) => r.url().includes('debit-note'), { timeout: 25000 }).catch(() => null);
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const hit = btns.find((b) => (b.textContent ?? '').trim().includes('Xuất Debit Note') && !b.disabled);
    if (!hit) return null;
    hit.click();
    return hit.textContent.trim();
  });
  log(`export click: ${JSON.stringify(clicked)}`);
  if (clicked) {
    const resp = await respP;
    await sleep(2000);
    await log.shot(page, '04-after-export-click.png');
    if (resp) {
      log(`export API ${resp.request().method()} ${resp.url()} → ${resp.status()}`);
      let bodyText = '';
      try { bodyText = await resp.text(); } catch { /* empty */ }
      log(`export API body: ${bodyText.slice(0, 500)}`);
    } else log('export API: no debit-note request observed');
    const banner = await page.evaluate(() => document.querySelector('[role="alert"], [role="status"]')?.textContent ?? '(none)');
    log(`banner after export: ${banner}`);
  }
  log('REPRO DONE');
} finally {
  await browser.close();
}
