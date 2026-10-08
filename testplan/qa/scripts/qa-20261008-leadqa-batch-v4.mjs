// QA batch rung v4 — card 20261008_7 staging criterion: changing the topbar
// period re-numerals the assignment chips consistently (both branches follow).
import { launch, login, tap, shot, step, evidenceDir, BASE } from './lead-qa-harness.mjs';

const FREEZE = process.env.QA_FREEZE ?? '';
const dir = evidenceDir('20261008-leadqa-batch');
const log = `${dir}/driver-v4.log`;
const sha = (await (await fetch(`${BASE}/api/health`)).json()).buildHash;
step(log, { step: 'build-currency', served: sha, freeze: FREEZE });
if (FREEZE && !sha.startsWith(FREEZE)) {
  step(log, { step: 'FAIL', error: `stale build ${sha} != ${FREEZE} — refusing to score` });
  process.exit(2);
}

const { browser, page } = await launch();
await login(page, 'dungnv');
await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3500));

const readChips = () => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('button, [role="button"], label')) {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (/^(Chưa gán xe|Đã gán xe)\s*\d*$/.test(t)) out.push(t);
  }
  return out;
});

const before = await readChips();
step(log, { step: 'chips-before', before });
await shot(page, `${dir}/C4-chips-before-period.png`);

// change the period via the month control (month picker or period tabs)
let after = before;
for (const sel of [
  'xpath///button[contains(., "Tháng trước")]',
  'xpath///select[contains(@aria-label, "tháng")]',
  'xpath///button[contains(@aria-label, "tháng")]',
]) {
  try {
    await tap(page, sel, log, 'period-control');
    await new Promise((r) => setTimeout(r, 3000));
    after = await readChips();
    if (JSON.stringify(after) !== JSON.stringify(before)) break;
  } catch (e) { step(log, { step: 'period-control-miss', sel: sel.slice(0, 60) }); }
}
step(log, { step: 'chips-after', after, changed: JSON.stringify(after) !== JSON.stringify(before) });
await shot(page, `${dir}/C4-chips-after-period.png`);
await browser.close();
step(log, { step: 'DONE' });
