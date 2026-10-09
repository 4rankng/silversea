// v13 — decisive VAT save with render stabilization (waitForSelector + error retry).
import { launch, login, shot, step, evidenceDir, BASE } from './lead-qa-harness.mjs';
const dir = evidenceDir('20261008-leadqa-final');
const log = `${dir}/driver-v13.log`;
const { browser, page } = await launch();
const writes = [];
page.on('request', (r) => { if (!['GET','OPTIONS'].includes(r.method())) writes.push(`${r.method()} ${r.url().slice(-70)}`); });
await login(page, 'admin');
await page.goto(`${BASE}/admin-center`, { waitUntil: 'networkidle2', timeout: 60000 });
let attempts = 0;
while (attempts < 4) {
  attempts += 1;
  try { await page.waitForSelector('select', { timeout: 8000 }); break; }
  catch {
    const err = await page.evaluate(() => document.body.innerText.includes('Không đọc được thuế suất'));
    step(log, { step: 'render-wait', attempts, errorState: err });
    if (err) {
      const b = await page.$('xpath///button[contains(., "Thử lại")]');
      if (b) { const r = await b.boundingBox(); await page.mouse.move(r.x + r.width/2, r.y + r.height/2); await page.mouse.down(); await page.mouse.up(); }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}
const state = () => page.evaluate(() => {
  const sel = document.querySelector('select');
  const btn = [...document.querySelectorAll('button')].find((b) => /Lưu thuế suất/.test(b.textContent || ''));
  return sel && btn ? { selected: sel.value, disabled: btn.disabled, aria: btn.getAttribute('aria-disabled') } : { missing: true };
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
await new Promise((r) => setTimeout(r, 2500));
try { await page.waitForSelector('select', { timeout: 10000 }); } catch {}
const after = await state();
step(log, { step: 'after-reload', ...after, persisted: after.selected === '0.1' });
await shot(page, `${dir}/A7-vat-decisive.png`);
await browser.close();
step(log, { step: 'DONE' });
