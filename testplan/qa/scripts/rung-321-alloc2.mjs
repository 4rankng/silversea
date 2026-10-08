// Rung 321 (alloc pass): close-reopen per the 409 guidance, save allocation, verify chip state + crop.
import { launch, tap, shot, setViewport } from './lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;
const { browser, page } = await launch({ width: 1440, height: 1000 });
const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
const { token } = await res.json();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('response', (r) => { if (/carrier-allocations/.test(r.url()) && r.request().method() !== 'GET') console.log('API', r.request().method(), r.status(), r.url().slice(-60)); });
await page.goto(`${base}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3500));

async function fillAndSave() {
  await new Promise((r) => setTimeout(r, 1000));
  for (const inp of await page.$$('input')) {
    const aria = await inp.evaluate((e) => e.getAttribute('aria-label') || '');
    if (/Số container 20/.test(aria)) { await inp.click(); await page.keyboard.type('2', { delay: 40 }); }
  }
  await new Promise((r) => setTimeout(r, 600));
  for (const b of await page.$$('button')) {
    const txt = await b.evaluate((e) => e.innerText.trim());
    if (txt === 'Lưu phân bổ') { await b.click(); break; }
  }
  await new Promise((r) => setTimeout(r, 2200));
  return page.evaluate(() => (document.querySelector('.dispatch-allocation-popover,[role=dialog]') || {}).innerText?.replace(/\n/g, ' | ').slice(-260) || 'DIALOG_CLOSED');
}

let rowIdx = await page.evaluate(() => [...document.querySelectorAll('.master-plan-grid tbody tr')].findIndex((r) => /5quiea 7/i.test(r.innerText)));
await tap(page, `.master-plan-grid tbody tr:nth-child(${rowIdx + 1}) .master-plan-grid__allocation-trigger`);
console.log('ATTEMPT1', JSON.stringify(await fillAndSave()));

// close + reopen per the conflict guidance, retry once
for (const b of await page.$$('button')) {
  const txt = await b.evaluate((e) => e.innerText.trim());
  if (txt === 'Hủy' || txt === 'Huỷ') { await b.click(); break; }
}
await new Promise((r) => setTimeout(r, 1200));
rowIdx = await page.evaluate(() => [...document.querySelectorAll('.master-plan-grid tbody tr')].findIndex((r) => /5quiea 7/i.test(r.innerText)));
await tap(page, `.master-plan-grid tbody tr:nth-child(${rowIdx + 1}) .master-plan-grid__allocation-trigger`);
console.log('ATTEMPT2', JSON.stringify(await fillAndSave()));

await page.goto(`${base}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));
const state = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.master-plan-grid tbody tr')];
  const i = rows.findIndex((r) => /5quiea 7/i.test(r.innerText));
  const r = rows[i];
  const cell = r.querySelector('[data-label="Phân bổ nhà xe"]');
  const cr = cell.getBoundingClientRect();
  return {
    rowIdx: i,
    allocText: cell.innerText.replace(/\n/g, ' ').slice(0, 50),
    chips: [...cell.querySelectorAll('.master-plan-grid__chip')].map((c) => {
      const b = c.getBoundingClientRect();
      return { text: c.innerText.trim(), leftIn: Math.round(b.left - cr.left), rightGap: Math.round(cr.right - b.right), svgGlyphs: c.querySelectorAll('svg').length };
    }),
    triggerInsideCell: (() => { const bb = cell.querySelector('.master-plan-grid__allocation-trigger')?.getBoundingClientRect(); return bb ? Math.round(bb.right - cr.right) <= 1 && Math.round(bb.left - cr.left) >= -1 : null; })(),
  };
});
console.log('FINAL_STATE', JSON.stringify(state));

if (state.chips.length) {
  await setViewport(page, 1440, 1000);
  const box = await page.evaluate((i) => {
    const rows = [...document.querySelectorAll('.master-plan-grid tbody tr')];
    const r = rows[i];
    const c = r.querySelector('[data-label="Tổng quan hàng hóa"]');
    const a = r.querySelector('[data-label="Phân bổ nhà xe"]');
    const cb = c.getBoundingClientRect(); const ab = a.getBoundingClientRect();
    return { x: cb.x - 6, y: cb.y - 8, width: (ab.right - cb.x) + 12, height: cb.height + 16 };
  }, state.rowIdx);
  await page.screenshot({ path: `${E}/cells-alloc-crop.png`, clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height: box.height } });
  await shot(page, `${E}/grid-1440-withdata.png`, { full: true });
  console.log('ALLOC CROPS recaptured');
}
await browser.close();
