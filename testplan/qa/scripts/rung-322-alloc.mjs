// Rung 322 (alloc): dump dialog controls, allocate 2×20' to the internal fleet via real input,
// capture green-box seam + measure. mutates: none (draft-only, close via Huỷ)
import { launch, tap, probe, shot, setViewport } from './lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;
const { browser, page } = await launch({ width: 1440, height: 900 });
const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
const { token } = await res.json();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${base}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3500));

const rowIdx = await page.evaluate(() => [...document.querySelectorAll('.master-plan-grid tbody tr')].findIndex((r) => /5quiea 7/i.test(r.innerText)));
await tap(page, `.master-plan-grid tbody tr:nth-child(${rowIdx + 1}) .master-plan-grid__allocation-trigger`);
await new Promise((r) => setTimeout(r, 1200));

const controls = await page.evaluate(() => {
  const d = document.querySelector('.dispatch-allocation-popover,[role=dialog]');
  return [...d.querySelectorAll('input,button,select,[role=button],[role=checkbox],[role=switch]')].map((e, i) => ({
    i, tag: e.tagName, type: e.type || '', label: (e.getAttribute('aria-label') || e.innerText || e.placeholder || '').trim().slice(0, 50),
  }));
});
console.log('CONTROLS', JSON.stringify(controls));

// find the 20' count input on the first carrier row (skip the demand table's read-only cells)
const inputs = await page.$$('.dispatch-allocation-popover input, [role=dialog] input');
let filled = false;
for (const inp of inputs) {
  const meta = await inp.evaluate((e) => ({ type: e.type, dis: e.disabled, aria: e.getAttribute('aria-label') || '' }));
  if (!meta.dis && (meta.type === 'number' || meta.type === 'text') && /20/.test(meta.aria)) {
    await inp.click();
    await page.keyboard.type('2', { delay: 40 });
    filled = true;
    console.log('FILLED_INPUT', JSON.stringify(meta));
    break;
  }
}
if (!filled && inputs.length) {
  const inp = inputs[0];
  await inp.click();
  await page.keyboard.type('2', { delay: 40 });
  console.log('FILLED_FIRST_INPUT');
}
await new Promise((r) => setTimeout(r, 1000));

const after = await page.evaluate(() => {
  const leaf = [...document.querySelectorAll('*')].find((e) => /Đã phân bổ đủ số container/.test(e.textContent || '') && e.children.length === 0);
  const footBtn = [...document.querySelectorAll('button')].find((b) => /^Lưu phân bổ/.test(b.innerText.trim()));
  const foot = footBtn?.closest('div[class*=foot], div[class*=actions], footer') || footBtn?.parentElement;
  const lr = leaf?.getBoundingClientRect(); const fr = foot?.getBoundingClientRect();
  const d = document.querySelector('.dispatch-allocation-popover,[role=dialog]');
  return {
    green: !!leaf, greenText: leaf?.textContent?.trim(),
    seamPx: lr && fr ? Math.round(fr.top - lr.bottom) : null,
    text: d ? d.innerText.replace(/\n/g, ' | ').slice(0, 500) : '',
  };
});
console.log('AFTER_ALLOC', JSON.stringify(after));
console.log('PROBE', JSON.stringify(await probe(page)));

for (const [w, h] of [[1280, 900], [1440, 900], [1920, 1080], [2560, 1400]]) {
  await setViewport(page, w, h);
  await shot(page, `${E}/alloc-dialog-${w}.png`, { full: false });
}
await setViewport(page, 1440, 900);
const el = await page.$('.dispatch-allocation-popover,[role=dialog]');
const box = await el.boundingBox();
await page.screenshot({ path: `${E}/alloc-seam-crop.png`, clip: { x: box.x, y: Math.round(box.y + box.height * 0.5), width: box.width, height: Math.round(box.height * 0.5) } });
await setViewport(page, 390, 844);
await shot(page, `${E}/alloc-dialog-390.png`, { full: false });
for (const b of await page.$$('button')) {
  const txt = await b.evaluate((e) => e.innerText.trim());
  if (txt === 'Huỷ' || txt === 'Hủy') { await b.click(); break; }
}
await new Promise((r) => setTimeout(r, 800));
console.log('CLOSE', JSON.stringify({ dialogGone: await page.evaluate(() => !document.querySelector('.dispatch-allocation-popover,[role=dialog]')) }));
await browser.close();
