// Rung 322 (with-demand): allocation dialog on a real 2-container lot — allocate via real taps,
// capture the green-box → footer seam + measure it in live layout. mutates: none (draft-only, close via Huỷ)
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

// locate the seeded demand row (shipment 51974 = "5quiea 7")
const rowSel = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.master-plan-grid tbody tr')];
  const i = rows.findIndex((r) => /5quiea 7/i.test(r.innerText));
  return i;
});
console.log('ROW_INDEX', rowSel);
if (rowSel < 0) { console.log('FAIL: demand row not in grid'); await browser.close(); process.exit(1); }

const trig = `.master-plan-grid tbody tr:nth-child(${rowSel + 1}) .master-plan-grid__allocation-trigger`;
const t1 = await tap(page, trig);
console.log('OPEN_TAP', JSON.stringify({ ev: t1.after }));
await new Promise((r) => setTimeout(r, 1200));

const before = await page.evaluate(() => {
  const d = document.querySelector('.dispatch-allocation-popover,[role=dialog]');
  return { text: d ? d.innerText.replace(/\n/g, ' | ').slice(0, 400) : '', green: [...document.querySelectorAll('*')].some((e) => /Đã phân bổ đủ số container/.test(e.textContent || '') && e.children.length === 0) };
});
console.log('DIALOG_BEFORE', JSON.stringify(before));

// allocate the whole lot to the internal fleet row ("Toàn bộ lô hàng")
const allocSel = 'button, [role=button], [role=checkbox], input[type=checkbox]';
const cands = await page.$$(allocSel);
let allocTap = null;
for (const c of cands) {
  const t = await c.evaluate((e) => (e.innerText || e.getAttribute('aria-label') || '').trim());
  if (t.startsWith('Toàn bộ lô hàng')) { allocTap = c; break; }
}
if (allocTap) {
  const box = await allocTap.boundingBox();
  await page.mouse.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  await page.mouse.down(); await page.mouse.up();
  console.log('ALLOC_TAP ok');
} else {
  console.log('ALLOC_TAP: control not found');
}
await new Promise((r) => setTimeout(r, 1000));

const after = await page.evaluate(() => {
  const d = document.querySelector('.dispatch-allocation-popover,[role=dialog]');
  const leaf = [...document.querySelectorAll('*')].find((e) => /Đã phân bổ đủ số container/.test(e.textContent || '') && e.children.length === 0);
  const foot = document.querySelector('.modal__foot') || [...document.querySelectorAll('button')].find((b) => /^Lưu phân bổ/.test(b.innerText.trim()))?.parentElement;
  const lr = leaf?.getBoundingClientRect(); const fr = foot?.getBoundingClientRect();
  return {
    green: !!leaf,
    greenText: leaf?.textContent?.trim(),
    seamPx: lr && fr ? Math.round(fr.top - lr.bottom) : null,
    text: d ? d.innerText.replace(/\n/g, ' | ').slice(0, 400) : '',
  };
});
console.log('DIALOG_AFTER', JSON.stringify(after));
console.log('PROBE', JSON.stringify(await probe(page)));

for (const [w, h] of [[1280, 900], [1440, 900], [1920, 1080], [2560, 1400]]) {
  await setViewport(page, w, h);
  await shot(page, `${E}/demand-dialog-${w}-full.png`, { full: false });
}
await setViewport(page, 1440, 900);
const el = await page.$('.dispatch-allocation-popover,[role=dialog]');
const box = await el.boundingBox();
await page.screenshot({ path: `${E}/demand-seam-crop.png`, clip: { x: box.x, y: Math.round(box.y + box.height * 0.5), width: box.width, height: Math.round(box.height * 0.5) } });
await setViewport(page, 390, 844);
await shot(page, `${E}/demand-dialog-390-bottomsheet.png`, { full: false });

for (const b of await page.$$('button')) {
  const txt = await b.evaluate((e) => e.innerText.trim());
  if (txt === 'Huỷ' || txt === 'Hủy') { await b.click(); break; }
}
await new Promise((r) => setTimeout(r, 800));
console.log('CLOSE', JSON.stringify({ dialogGone: await page.evaluate(() => !document.querySelector('.dispatch-allocation-popover,[role=dialog]')) }));
await browser.close();
