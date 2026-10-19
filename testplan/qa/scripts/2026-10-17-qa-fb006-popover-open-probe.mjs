// FB-006 verifyfail round-1 AC (card 121026185510) — opening the factory
// DETAIL popover (magnifier) must NOT reveal the cell editor. Staging probe.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb006pop';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (r, ok, d) => { const v = ok ? 'PASS' : 'FAIL'; results.push({ r, v }); console.log(`[${v}] ${r} — ${d}`); };

for (let i = 1; i <= 3; i++) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) });
  if (res.ok) { var { token } = await res.json(); break; }
  if (i === 3) throw new Error('login failed');
}
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2500);

  const pickIn = async (containerSelector, typed, wanted) => {
    const focused = await page.evaluate((sel) => {
      const host = document.querySelector(sel);
      const c = host?.querySelector('[role="combobox"]') ?? (host?.matches?.('[role="combobox"]') ? host : null);
      if (!c) return false;
      c.scrollIntoView({ block: 'center' }); c.focus(); return true;
    }, containerSelector);
    if (!focused) return false;
    await sleep(300);
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length > 0, { timeout: 10000 }).catch(() => {});
    await sleep(400);
    if (typed) { await page.keyboard.type(typed, { delay: 60 }); await sleep(900); }
    return page.evaluate((w) => {
      const o = [...document.querySelectorAll('[role="option"]')].find((el) => (el.innerText || '').trim().toLowerCase().includes(w.toLowerCase()));
      if (!o) return false;
      o.scrollIntoView({ block: 'nearest' }); o.click(); return true;
    }, wanted);
  };
  if (!await pickIn('[data-field-id="shipment-customer"]', 'LONG MINH', 'LONG MINH')) throw new Error('customer pick failed');
  await sleep(1200);
  // pick factory in container row 1 cell
  const focused = await page.evaluate(() => {
    const cell = document.querySelector('td.csc-container-cell[data-field-id$="-factory"]');
    const c = cell?.querySelector('[role="combobox"]');
    if (!c) return false;
    c.scrollIntoView({ block: 'center' }); c.focus(); return true;
  });
  if (!focused) throw new Error('factory combobox not found');
  await sleep(300);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length > 0, { timeout: 10000 }).catch(() => {});
  await sleep(400);
  await page.keyboard.type('LM', { delay: 60 });
  await sleep(900);
  const picked = await page.evaluate(() => {
    const o = [...document.querySelectorAll('[role="option"]')].find((el) => /LM Võ Cường/i.test(el.innerText || ''));
    if (!o) return false;
    o.scrollIntoView({ block: 'nearest' }); o.click(); return true;
  });
  if (!picked) throw new Error('factory pick failed');
  await sleep(600);

  // open the magnifier popover
  const magClicked = await page.evaluate(() => {
    const cell = document.querySelector('td.csc-container-cell[data-field-id$="-factory"]');
    const btn = [...(cell?.querySelectorAll('button') ?? [])].find((b) => /xem chi tiết nhà máy/i.test(b.getAttribute('aria-label') || '') && !b.disabled);
    if (!btn) return false;
    btn.click(); return true;
  });
  await sleep(1200);
  const state = await page.evaluate(() => {
    const cell = document.querySelector('td.csc-container-cell[data-field-id$="-factory"]');
    const editor = cell?.querySelector('.csc-container-cell__editor');
    const display = cell?.querySelector('.csc-container-cell__display');
    const dlg = document.querySelector('[role="dialog"]');
    const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0 && el.getClientRects().length > 0; };
    return {
      popoverOpen: !!dlg && /Hóa đơn cẩu phí|Số điện thoại/i.test(dlg.textContent || ''),
      popoverText: dlg ? (dlg.textContent || '').slice(0, 120) : null,
      nameVisible: vis(display), nameText: (display?.textContent || '').trim(),
      editorVis: editor ? getComputedStyle(editor).visibility : null,
      comboboxInCell: !!cell?.querySelector('[role="combobox"]'),
      cellPicked: cell?.classList.contains('csc-container-cell--picked') ?? false,
    };
  });
  await page.screenshot({ path: `${SHOTS}/01-popover-open-cell-giu-ten.png` });
  record('AC2-popover-open-keeps-name',
    state.popoverOpen && state.nameVisible && state.editorVis === 'hidden',
    JSON.stringify(state) + ` · ${SHOTS}/01-popover-open-cell-giu-ten.png`);
  await page.keyboard.press('Escape');
  await sleep(500);
  const after = await page.evaluate(() => {
    const cell = document.querySelector('td.csc-container-cell[data-field-id$="-factory"]');
    return { popoverGone: !document.querySelector('[role="dialog"]'), nameStill: (cell?.querySelector('.csc-container-cell__display')?.textContent || '').trim() };
  });
  record('AC2b-escape-restores', after.popoverGone && after.nameStill.length > 0, JSON.stringify(after));
} finally { await browser.close(); }
const fail = results.filter((r) => r.v === 'FAIL');
console.log(fail.length ? `=== ${fail.length} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fail.length ? 1 : 0);
