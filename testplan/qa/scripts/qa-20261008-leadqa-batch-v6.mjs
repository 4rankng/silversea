// v6 — flip the period to 'Hôm nay' preset, chips must re-numeral.
import { launch, login, tap, shot, step, evidenceDir, BASE } from './lead-qa-harness.mjs';
const dir = evidenceDir('20261008-leadqa-batch');
const log = `${dir}/driver-v6.log`;
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
step(log, { step: 'chips-month', before });
await tap(page, 'xpath///button[normalize-space(.)="Hôm nay"]', log, 'preset-hom-nay');
await new Promise((r) => setTimeout(r, 3500));
const after = await readChips();
step(log, { step: 'chips-today', after, changed: JSON.stringify(after) !== JSON.stringify(before) });
await shot(page, `${dir}/C6-chips-today-period.png`);
await browser.close();
step(log, { step: 'DONE' });
