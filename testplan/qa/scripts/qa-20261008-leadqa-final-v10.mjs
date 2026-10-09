// v10 — scoped VAT save + network truth (did a write fire at all?).
import { launch, login, tap, shot, step, evidenceDir, BASE } from './lead-qa-harness.mjs';
const dir = evidenceDir('20261008-leadqa-final');
const log = `${dir}/driver-v10.log`;
const { browser, page } = await launch();
const writes = [];
page.on('request', (r) => { if (r.method() !== 'GET' && r.method() !== 'OPTIONS') writes.push(`${r.method()} ${r.url().slice(-60)}`); });
await login(page, 'admin');
writes.length = 0;
await page.goto(`${BASE}/admin-center`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));
const probe = await page.evaluate(() => {
  const card = document.querySelector('.vat-rate-config, .vat-rate-config__controls')?.closest('section,div[class*="vat"]');
  const btns = card ? [...card.querySelectorAll('button')].map((b) => ({ t: (b.textContent || '').trim(), cls: b.className })) : [];
  const all = [...document.querySelectorAll('button')].filter((b) => /Lưu/.test(b.textContent || '')).map((b) => ({ t: (b.textContent || '').trim().slice(0, 30), cls: b.className }));
  return { cardBtns: btns, allSave: all };
});
step(log, { step: 'buttons', probe });
await page.select('select', '0.1');
step(log, { step: 'selected', v: await page.$eval('select', (e) => e.value) });
// tap the VAT-card-scoped save
const tapped = await page.evaluate(() => {
  const scope = document.querySelector('.vat-rate-config') || document.querySelector('.vat-rate-config__controls')?.parentElement;
  const b = scope ? [...scope.querySelectorAll('button')].find((x) => /Lưu/.test(x.textContent || '')) : null;
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { t: b.textContent.trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
step(log, { step: 'scoped-save', tapped });
if (tapped) {
  await page.mouse.move(tapped.x, tapped.y);
  await page.mouse.down(); await page.mouse.up();
  await new Promise((r) => setTimeout(r, 2500));
}
step(log, { step: 'writes-after-save', writes: writes.slice(-5) });
await page.reload({ waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 1500));
const after = await page.$eval('select', (e) => e.value);
step(log, { step: 'after-reload', after, persisted: after === '0.1' });
await shot(page, `${dir}/A4-vat-scoped-save.png`);
await browser.close();
step(log, { step: 'DONE' });
