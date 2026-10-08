// v5 — flip the period INSIDE the topbar date picker, then re-read chips.
import { launch, login, tap, shot, step, evidenceDir, BASE } from './lead-qa-harness.mjs';

const dir = evidenceDir('20261008-leadqa-batch');
const log = `${dir}/driver-v5.log`;
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
await tap(page, 'xpath///button[contains(@aria-label, "tháng") or contains(@class, "topbar-date__trigger")]', log, 'date-trigger');
await new Promise((r) => setTimeout(r, 1200));
await shot(page, `${dir}/C5-date-picker-open.png`);
const pickerBtns = await page.evaluate(() =>
  [...document.querySelectorAll('button')].map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 30));
step(log, { step: 'picker-buttons', pickerBtns });
// try a month-nav or previous-month option inside the popover
let after = before;
for (const pat of ['Tháng trước', 'tháng trước', '9/2026', 'Tháng 9']) {
  try {
    await tap(page, `xpath///button[contains(., "${pat}")]`, log, `pick-${pat}`);
    await new Promise((r) => setTimeout(r, 3000));
    after = await readChips();
    if (JSON.stringify(after) !== JSON.stringify(before)) break;
  } catch (e) { step(log, { step: 'pick-miss', pat }); }
}
step(log, { step: 'chips-after', after, changed: JSON.stringify(after) !== JSON.stringify(before) });
await shot(page, `${dir}/C5-chips-after-period.png`);
await browser.close();
step(log, { step: 'DONE' });
