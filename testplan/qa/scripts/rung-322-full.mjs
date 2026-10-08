// Rung 322 (full): allocation-dialog footer seam — real taps, state matrix, seam crop.
// mutates: none (draft-only dialog interactions; closed via Huỷ)
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
await new Promise((r) => setTimeout(r, 3000));

const trig = '.master-plan-grid tbody tr:nth-child(2) .master-plan-grid__allocation-trigger';
const t1 = await tap(page, trig);
console.log('OPEN_TAP', JSON.stringify({ hit: t1.hit, ev: t1.after }));
await new Promise((r) => setTimeout(r, 1200));

const dlg = await page.evaluate(() => {
  const d = document.querySelector('.dispatch-allocation-popover,[role=dialog]');
  return {
    exists: !!d,
    text: d ? d.innerText : '',
    greenBox: [...document.querySelectorAll('*')].some((e) => /Đã phân bổ đủ số container/.test(e.textContent || '') && e.children.length === 0),
    cls: d ? d.className.toString().slice(0, 80) : '',
  };
});
console.log('DIALOG', JSON.stringify({ exists: dlg.exists, greenBox: dlg.greenBox, cls: dlg.cls }));
console.log('DIALOG_TEXT', dlg.text.replace(/\n/g, ' | ').slice(0, 500));

if (!dlg.exists) { console.log('FAIL: dialog did not open'); await browser.close(); process.exit(1); }

const matrix = [[1280, 900], [1440, 900], [1920, 1080], [2560, 1400]];
for (const [w, h] of matrix) {
  await setViewport(page, w, h);
  await shot(page, `${E}/dialog-${w}-open${dlg.greenBox ? '-full' : ''}.png`, { full: false });
  const el = await page.$('.dispatch-allocation-popover,[role=dialog]');
  const box = await el.boundingBox();
  // seam crop: dialog bottom half (content-end → footer)
  await page.screenshot({
    path: `${E}/seam-${w}.png`,
    clip: { x: box.x, y: Math.round(box.y + box.height * 0.45), width: box.width, height: Math.round(box.height * 0.55) },
  });
  console.log('SHOT', w, JSON.stringify({ box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } }));
}

await setViewport(page, 390, 844);
await shot(page, `${E}/dialog-390-bottomsheet.png`, { full: false });
console.log('SHOT 390 bottomsheet');

const cancelSel = [...await page.$$('button')];
let closed = false;
for (const b of cancelSel) {
  const txt = await b.evaluate((e) => e.innerText.trim());
  if (txt === 'Huỷ' || txt === 'Hủy') { await b.click(); closed = true; break; }
}
await new Promise((r) => setTimeout(r, 800));
const afterClose = await page.evaluate(() => !document.querySelector('.dispatch-allocation-popover,[role=dialog]'));
console.log('CLOSE', JSON.stringify({ tappedCancel: closed, dialogGone: afterClose, probe: await probe(page) }));
await browser.close();
