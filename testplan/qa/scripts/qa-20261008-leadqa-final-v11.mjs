// v11 — decisive VAT save test: dirty state + hit-tested click + network truth.
import { launch, login, shot, step, evidenceDir, BASE } from './lead-qa-harness.mjs';
const dir = evidenceDir('20261008-leadqa-final');
const log = `${dir}/driver-v11.log`;
const { browser, page } = await launch();
const writes = [];
page.on('request', (r) => { if (!['GET','OPTIONS'].includes(r.method())) writes.push(`${r.method()} ${r.url().slice(-70)}`); });
await login(page, 'admin');
await page.goto(`${BASE}/admin-center`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));
const state = () => page.evaluate(() => {
  const scope = document.querySelector('.vat-rate-config');
  const sel = scope?.querySelector('select');
  const btn = scope ? [...scope.querySelectorAll('button')].find((b) => /Lưu thuế suất/.test(b.textContent || '')) : null;
  return sel && btn ? { selected: sel.value, disabled: btn.disabled, ariaDisabled: btn.getAttribute('aria-disabled'), btnText: btn.textContent.trim() } : { missing: true };
});
step(log, { step: 'state-initial', ...(await state()) });
await page.select('.vat-rate-config select', '0.1');
await new Promise((r) => setTimeout(r, 500));
step(log, { step: 'state-after-select', ...(await state()) });
// hit-tested click
const geo = await page.evaluate(() => {
  const scope = document.querySelector('.vat-rate-config');
  const btn = [...scope.querySelectorAll('button')].find((b) => /Lưu thuế suất/.test(b.textContent || ''));
  btn.scrollIntoView({ block: 'center' });
  const r = btn.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await new Promise((r) => setTimeout(r, 300));
const hit = await page.evaluate(({ x, y }) => { const n = document.elementFromPoint(x, y); return n ? n.tagName + '|' + (n.textContent || '').trim().slice(0, 20) : null; }, geo);
step(log, { step: 'pre-click-hit', hit, geo });
await page.mouse.move(geo.x, geo.y); await page.mouse.down(); await page.mouse.up();
await new Promise((r) => setTimeout(r, 2500));
step(log, { step: 'writes', writes: writes.slice(-5) });
await page.reload({ waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 2000));
const after = await state();
step(log, { step: 'after-reload', ...after, persisted: after.selected === '0.1' });
await shot(page, `${dir}/A5-vat-decisive.png`);
// restore best-effort
if (after.selected === '0.1') {
  await page.select('.vat-rate-config select', '0.08');
  await new Promise((r) => setTimeout(r, 300));
  const g2 = await page.evaluate(() => {
    const b = [...document.querySelector('.vat-rate-config').querySelectorAll('button')].find((x) => /Lưu thuế suất/.test(x.textContent || ''));
    const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(g2.x, g2.y); await page.mouse.down(); await page.mouse.up();
  step(log, { step: 'restored', to: '0.08' });
}
await browser.close();
step(log, { step: 'DONE' });
