// FB-043 (card 141026001010) — /dispatch master-plan grid rows bound their own
// height. Read-only drive as DISPATCHER: measure every row's offsetHeight and
// the shared cell-body budget (96px) on real staging data.
import { assertBuild, login, launch, makeLogger, installIdempotency, sleep } from './w5w4-lib.mjs';

const log = makeLogger('2026-10-16_w5w4_fb043');
const expect = (cond, msg) => { if (!cond) throw new Error(`ASSERT FAIL: ${msg}`); };

await assertBuild(log);
const token = await login('dungnv');
log('login dungnv (DISPATCHER) OK');

const browser = await launch();
try {
  const page = await browser.newPage();
  installIdempotency(page);
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  await page.goto('https://vantai.tingting.vip/dispatch', { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('tr.master-plan-grid__row').length > 0, { timeout: 30000, polling: 200 });
  await sleep(1200);

  const m = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr.master-plan-grid__row')];
    const heights = rows.map((tr) => tr.offsetHeight);
    // The contract lives on the cell BODY (the budget owner), not the tr box:
    // collapsed borders/sub-pixel rounding make tr.offsetHeight wobble ±1px.
    const bodyHeights = rows.map((tr) => [...tr.querySelectorAll('.master-plan-grid__cell-body')].map((b) => b.offsetHeight));
    const bodies = rows.map((tr) => tr.querySelectorAll('.master-plan-grid__cell-body').length);
    const bodyH = document.querySelector('.master-plan-grid__cell-body')
      ? getComputedStyle(document.querySelector('.master-plan-grid__cell-body')).height
      : null;
    const lineCounts = rows.map((tr) => tr.querySelectorAll('.master-plan-grid__line').length);
    const gridVisible = !!document.querySelector('table.master-plan-grid');
    return { rowCount: rows.length, heights, bodyHeights, bodies, bodyH, lineCounts, gridVisible };
  });
  log(`FB-043: grid visible=${m.gridVisible}, rows=${m.rowCount}, cell-body computed height=${m.bodyH}`);
  log(`FB-043: tr offsetHeights=${JSON.stringify(m.heights)}`);
  log(`FB-043: cell-body offsetHeights per row=${JSON.stringify(m.bodyHeights)}`);
  log(`FB-043: cell-body count per row=${JSON.stringify(m.bodies)}`);
  log(`FB-043: .master-plan-grid__line count per row=${JSON.stringify(m.lineCounts)}`);

  expect(m.gridVisible, 'master-plan grid table rendered');
  expect(m.rowCount >= 1, `at least one data row (got ${m.rowCount})`);
  const flatBodies = m.bodyHeights.flat();
  const uniqBodies = [...new Set(flatBodies)];
  expect(uniqBodies.length === 1 && uniqBodies[0] === 96,
    `every cell-body clamps to exactly 96px (got ${JSON.stringify(uniqBodies)})`);
  const uniq = [...new Set(m.heights)];
  expect(uniq.length === 1 || (uniq.length === 2 && Math.max(...uniq) - Math.min(...uniq) <= 1),
    `all rows uniform within 1px rounding (got ${JSON.stringify(uniq)})`);
  expect(Math.max(...m.heights) < 200, `no row at defect-class scale (~2× budget; max ${Math.max(...m.heights)}px)`);
  expect(m.bodyH === '96px', `cell-body computed height is the --mpg-row-h 96px (got ${m.bodyH})`);
  const densest = Math.max(...m.lineCounts);
  log(`FB-043: densest row carries ${densest} value lines — ${densest > 8 ? 'multi-block content bounded at the same 96px body' : 'light content only'}`);
  expect(densest > 8, `staging exposes dense multi-block rows to prove the bound (densest=${densest})`);
  await log.shot(page, 'ui-01-masterplan-uniform-rows-1440');

  // Mobile/tablet band sanity (≤900px is a stacked record, height must reset):
  await page.setViewport({ width: 768, height: 1000 });
  await sleep(900);
  const cardBand = await page.evaluate(() => {
    const body = document.querySelector('.master-plan-grid__cell-body');
    return body ? getComputedStyle(body).height : null;
  });
  log(`FB-043: 768px card band — cell-body height=${cardBand} (desktop budget must NOT apply)`);
  expect(cardBand !== '96px', 'card band resets the row budget (height != 96px)');
  await log.shot(page, 'ui-02-masterplan-card-band-768');

  await browser.close();
  log('FB-043 ALL ASSERTIONS PASS');
  process.exit(0);
} catch (e) {
  log(`FAIL: ${e.message}`);
  try { await log.shot((await browser.pages()).slice(-1)[0], 'FAIL-last-state'); } catch {}
  await browser.close().catch(() => {});
  process.exit(1);
}
