// Rung 321 (alloc3): create a fixture through the REAL write path (POST /shipments/quick),
// then allocation-save on it. Verdict fork: works → earlier 409 was the raw-SQL fixture;
// 409 again → allocation save is broken at HEAD (product bug).
import { launch, tap, shot, setViewport } from './lead-qa-lib.mjs';
import { randomUUID } from 'node:crypto';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;

const loginRes = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
const { token } = await res2json(loginRes);

async function res2json(r) { return r.json(); }

const created = process.env.SHIP_ID
  ? { id: Number(process.env.SHIP_ID) }
  : await (async () => {
      const r = await fetch(`${base}/api/shipments/quick`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({
          customerId: Number(process.env.CUST_ID || 24885),
          isAdHoc: false,
          bookingRef: 'QA321-ALLOC-01',
          tradeDirection: 'EXPORT',
          cargoMode: 'FCL',
          expectedDeliveryDate: '2026-10-20',
          containers: [{ containerNumber: 'MSCU5678907', containerTypeId: 1 }, { containerNumber: 'TGHU6789017', containerTypeId: 1 }],
        }),
      });
      const j = await r.json();
      console.log('CREATE', r.status, JSON.stringify(j).slice(0, 160));
      return j;
    })();
console.log('FIXTURE', created.id || created.shipment?.id);
const shipId = created.id || created.shipment?.id;
if (!shipId) { console.log('FAIL: no shipment id'); process.exit(1); }

const { browser, page } = await launch({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('response', (r) => { if (/carrier-allocations/.test(r.url()) && r.request().method() !== 'GET') console.log('API', r.request().method(), r.status(), r.url().slice(-60)); });
await page.goto(`${base}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3500));

// filter the grid to the fixture (it sorts beyond the initially loaded rows)
{
  const search = await page.$('input[aria-label="Tìm kiếm lô hàng"]');
  if (search) { await search.click(); await page.keyboard.type('QA321', { delay: 35 }); }
  await new Promise((r) => setTimeout(r, 1800));
}
const rowIdx = await page.evaluate(() => [...document.querySelectorAll('.master-plan-grid tbody tr')].findIndex((r) => /MSCU5678907|TGHU6789017|QA321|SHP-2610-0108/i.test(r.innerText)));
console.log('ROW_INDEX', rowIdx);
if (rowIdx < 0) { console.log('FAIL: fixture row not in grid'); await browser.close(); process.exit(1); }

await tap(page, `.master-plan-grid tbody tr:nth-child(${rowIdx + 1}) .master-plan-grid__allocation-trigger`);
await new Promise((r) => setTimeout(r, 1200));
for (const inp of await page.$$('input')) {
  const aria = await inp.evaluate((e) => e.getAttribute('aria-label') || '');
  if (/Số container 20/.test(aria)) { await inp.click(); await page.keyboard.type('2', { delay: 40 }); }
}
await new Promise((r) => setTimeout(r, 600));
for (const b of await page.$$('button')) {
  const txt = await b.evaluate((e) => e.innerText.trim());
  if (txt === 'Lưu phân bổ') { await b.click(); break; }
}
await new Promise((r) => setTimeout(r, 2500));
const post = await page.evaluate(() => (document.querySelector('.dispatch-allocation-popover,[role=dialog]') || {}).innerText?.replace(/\n/g, ' | ').slice(-240) || 'DIALOG_CLOSED');
console.log('POST_SAVE', JSON.stringify(post));

await page.goto(`${base}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));
const state = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.master-plan-grid tbody tr')];
  const i = rows.findIndex((r) => /QA321-ALLOC-01|QA321BL001/i.test(r.innerText));
  const cell = rows[i].querySelector('[data-label="Phân bổ nhà xe"]');
  const cr = cell.getBoundingClientRect();
  return {
    rowIdx: i,
    allocText: cell.innerText.replace(/\n/g, ' ').slice(0, 50),
    chips: [...cell.querySelectorAll('.master-plan-grid__chip')].map((c) => {
      const b = c.getBoundingClientRect();
      return { text: c.innerText.trim(), leftIn: Math.round(b.left - cr.left), rightGap: Math.round(cr.right - b.right), svgGlyphs: c.querySelectorAll('svg').length };
    }),
  };
});
console.log('FINAL_STATE', JSON.stringify(state));

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
console.log('CROPS recaptured');
await browser.close();
