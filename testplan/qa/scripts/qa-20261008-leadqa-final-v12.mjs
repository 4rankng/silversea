// v12 — decisive VAT save: global select + button-by-text, hit-tested.
import { launch, login, shot, step, evidenceDir, BASE } from './lead-qa-harness.mjs';
const dir = evidenceDir('20261008-leadqa-final');
const log = `${dir}/driver-v12.log`;
const { browser, page } = await launch();
const writes = [];
page.on('request', (r) => { if (!['GET','OPTIONS'].includes(r.method())) writes.push(`${r.method()} ${r.url().slice(-70)}`); });
await login(page, 'admin');
await page.goto(`${BASE}/admin-center`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));
const state = () => page.evaluate(() => {
  const sel = document.querySelector('select');
  const btn = [...document.querySelectorAll('button')].find((b) => /Lưu thuế suất/.test(b.textContent || ''));
  return sel && btn ? { selected: sel.value, disabled: btn.disabled, aria: btn.getAttribute('aria-disabled') } : { missing: !sel, missingBtn: !btn };
});
step(log, { step: 'state-initial', ...(await state()) });
await page.select('select', '0.1');
await new Promise((r) => setTimeout(r, 600));
step(log, { step: 'state-after-select', ...(await state()) });
const geo = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Lưu thuế suất/.test(x.textContent || ''));
  b.scrollIntoView({ block: 'center' });
  const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await new Promise((r) => setTimeout(r, 300));
const hit = await page.evaluate(({ x, y }) => { const n = document.elementFromPoint(x, y); return n ? n.tagName + '|' + (n.textContent || '').trim().slice(0, 16) : null; }, geo);
step(log, { step: 'pre-click-hit', hit });
await page.mouse.move(geo.x, geo.y); await page.mouse.down(); await page.mouse.up();
await new Promise((r) => setTimeout(r, 2500));
step(log, { step: 'writes', writes: writes.slice(-5) });
await page.reload({ waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 2000));
const after = await state();
step(log, { step: 'after-reload', ...after, persisted: after.selected === '0.1' });
await shot(page, `${dir}/A6-vat-decisive.png`);
await browser.close();
step(log, { step: 'DONE' });
