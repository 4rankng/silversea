// Rung 321 (v2): master-plan PHÂN BỔ NHÀ XE + TỔNG QUAN HÀNG HÓA cells — density, single affordance, glyph-free chip.
// mutates: fixture row (shipment 51974) allocation SAVED locally (declared); logs save API responses.
import { launch, tap, probe, shot, setViewport } from './lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;
const { browser, page } = await launch({ width: 1440, height: 1000 });
const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
const { token } = await res.json();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('response', (r) => { if (/\/api\/(shipments|dispatch|fleet)/.test(r.url()) && r.request().method() !== 'GET') console.log('API', r.request().method(), r.status(), r.url().slice(-70)); });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE_ERR', m.text().slice(0, 120)); });
await page.goto(`${base}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3500));

// ---- A. compact census: every row, affordance counts
const census = await page.evaluate(() => [...document.querySelectorAll('.master-plan-grid tbody tr')].map((r, i) => {
  const t = r.innerText;
  const dir = (t.match(/Xuất|Nhập/) || ['-'])[0];
  const sum = (r.querySelector('.master-plan-grid__cargo-summary')?.innerText || '').replace(/\n/g, ' ');
  const det = [...r.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Chi tiết' && b.offsetParent !== null).length;
  const more = [...r.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Xem thêm').length;
  const chips = r.querySelectorAll('.master-plan-grid__chip').length;
  return `${i}|${dir}|cont:${sum.includes('Chưa có cont') ? 0 : 1}|det:${det}|more:${more}|chips:${chips}`;
}));
console.log('CENSUS', census.join('  '));

// ---- B. cargo-cell geometry (AC1): dead band + bottom-pin, on the seeded container-bearing row
const geo = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.master-plan-grid tbody tr')];
  const r = rows.find((x) => /5quiea 7/i.test(x.innerText));
  const cell = r.querySelector('[data-label="Tổng quan hàng hóa"]');
  const cr = cell.getBoundingClientRect();
  const sum = cell.querySelector('.master-plan-grid__cargo-summary');
  const det = [...cell.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Chi tiết');
  const sr = sum?.getBoundingClientRect(); const dr = det?.getBoundingClientRect();
  return {
    cellH: Math.round(cr.height),
    deadBand_summaryBottom_to_detailTop: sr && dr ? Math.round(dr.top - sr.bottom) : null,
    bottomPin_detailBottom_to_cellBottom: sr && dr ? Math.round(cr.bottom - dr.bottom) : null,
    detailTriggersInCargoCell: det ? 1 : 0,
  };
});
console.log('GEO_UNALLOC_CARGOCELL', JSON.stringify(geo));

// unalloc criterion crop (cargo + allocation cells) BEFORE any save
{
  const box = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.master-plan-grid tbody tr')];
    const r = rows.find((x) => /5quiea 7/i.test(x.innerText));
    const c = r.querySelector('[data-label="Tổng quan hàng hóa"]');
    const a = r.querySelector('[data-label="Phân bổ nhà xe"]');
    const cb = c.getBoundingClientRect(); const ab = a.getBoundingClientRect();
    return { x: cb.x - 6, y: cb.y - 8, width: (ab.right - cb.x) + 12, height: cb.height + 16 };
  });
  await page.screenshot({ path: `${E}/cells-unalloc-crop.png`, clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height: box.height } });
}

// ---- C. allocation save on the fixture (declared local mutation) with response + outcome check
let rowIdx = await page.evaluate(() => [...document.querySelectorAll('.master-plan-grid tbody tr')].findIndex((r) => /5quiea 7/i.test(r.innerText)));
const hadChip = await page.evaluate((i) => document.querySelectorAll('.master-plan-grid tbody tr')[i].querySelectorAll('.master-plan-grid__chip').length > 0, rowIdx);
if (!hadChip) {
  await tap(page, `.master-plan-grid tbody tr:nth-child(${rowIdx + 1}) .master-plan-grid__allocation-trigger`);
  await new Promise((r) => setTimeout(r, 1000));
  const inputs = await page.$$('input');
  for (const inp of inputs) {
    const aria = await inp.evaluate((e) => e.getAttribute('aria-label') || '');
    if (/Số container 20/.test(aria)) { await inp.click(); await page.keyboard.type('2', { delay: 40 }); }
    if (/Nhà xe/.test(aria)) { await inp.click(); await page.keyboard.type('SilverSea', { delay: 40 }); }
  }
  await new Promise((r) => setTimeout(r, 800));
  const afterFill = await page.evaluate(() => (document.querySelector('.dispatch-allocation-popover,[role=dialog]') || {}).innerText?.replace(/\n/g, ' | ').slice(-220));
  console.log('DIALOG_TAIL_AFTER_FILL', JSON.stringify(afterFill));
  for (const b of await page.$$('button')) {
    const txt = await b.evaluate((e) => e.innerText.trim());
    if (txt === 'Lưu phân bổ') { await b.click(); console.log('CLICKED Lưu phân bổ'); break; }
  }
  await new Promise((r) => setTimeout(r, 2500));
  const post = await page.evaluate(() => ({
    dialogOpen: !!document.querySelector('.dispatch-allocation-popover,[role=dialog]'),
    dialogTail: (document.querySelector('.dispatch-allocation-popover,[role=dialog]') || {}).innerText?.replace(/\n/g, ' | ').slice(-220),
    toast: [...document.querySelectorAll('[role=status],[role=alert],.toast,[class*=toast]')].map((e) => e.innerText.trim().slice(0, 80)).join(' / '),
  }));
  console.log('POST_SAVE', JSON.stringify(post));
  await page.goto(`${base}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));
  rowIdx = await page.evaluate(() => [...document.querySelectorAll('.master-plan-grid tbody tr')].findIndex((r) => /5quiea 7/i.test(r.innerText)));
}
const chipNow = await page.evaluate((i) => [...document.querySelectorAll('.master-plan-grid tbody tr')[i].querySelectorAll('.master-plan-grid__chip')].map((c) => c.innerText.trim()), rowIdx);
console.log('CHIPS_AFTER', JSON.stringify(chipNow));

// ---- D. allocated-cell geometry (AC3): chip inside column, glyph-free
const allocGeo = await page.evaluate((i) => {
  const r = document.querySelectorAll('.master-plan-grid tbody tr')[i];
  const cell = r.querySelector('[data-label="Phân bổ nhà xe"]');
  const cr = cell.getBoundingClientRect();
  const chips = [...cell.querySelectorAll('.master-plan-grid__chip')].map((c) => {
    const b = c.getBoundingClientRect();
    return { text: c.innerText.trim(), leftIn: Math.round(b.left - cr.left), rightGap: Math.round(cr.right - b.right), svgGlyphs: c.querySelectorAll('svg').length };
  });
  const btn = cell.querySelector('.master-plan-grid__allocation-trigger');
  const bb = btn?.getBoundingClientRect();
  return { allocText: cell.innerText.replace(/\n/g, ' ').slice(0, 40), chips, triggerInsideCell: bb ? Math.round(bb.right - cr.right) <= 1 && Math.round(bb.left - cr.left) >= -1 : null };
}, rowIdx);
console.log('GEO_ALLOC', JSON.stringify(allocGeo));
console.log('PROBE_SINCE_RELOAD', JSON.stringify(await probe(page)));

// ---- E. matrix + crops
for (const [w, h] of [[1280, 1000], [1440, 1000], [1920, 1200], [2560, 1400]]) {
  await setViewport(page, w, h);
  await shot(page, `${E}/grid-${w}-withdata.png`, { full: true });
}
await setViewport(page, 1440, 1000);
{
  const box = await page.evaluate((i) => {
    const rows = [...document.querySelectorAll('.master-plan-grid tbody tr')];
    const r = rows[i];
    const c = r.querySelector('[data-label="Tổng quan hàng hóa"]');
    const a = r.querySelector('[data-label="Phân bổ nhà xe"]');
    const cb = c.getBoundingClientRect(); const ab = a.getBoundingClientRect();
    return { x: cb.x - 6, y: cb.y - 8, width: (ab.right - cb.x) + 12, height: cb.height + 16 };
  }, rowIdx);
  await page.screenshot({ path: `${E}/cells-alloc-crop.png`, clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height: box.height } });
}
console.log('SHOTS done');
await browser.close();
