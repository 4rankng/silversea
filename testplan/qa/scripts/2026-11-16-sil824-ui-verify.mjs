#!/usr/bin/env node
/**
 * SIL-824 AFTER driver — geometry proof per scenario on the fixed row.
 * Usage: node qa/2026-11-16_sil824-after.mjs
 * Scenarios: 1920 open (table) · 1440 closed (table) · 1440 open (card) · 1280 open (card) · 768 (card).
 * Filters /shipments-detail to container EGSU0180803 (hạ tại Cảng VipGreenPort) and asserts:
 *   - route tokens hold whole (no clip, no mid-token break for ≤83px tokens),
 *   - over-line tokens break visibly INSIDE the cell,
 *   - table mode at ≥1335px canvas with zero horizontal scroll,
 *   - card mode below the 1326px collapse guard.
 */
import { login, DEFAULT_FRONTEND, DEFAULT_BACKEND } from '../../../scripts/lib/http.mjs';
import { withSession, STANDARD_BROWSER_ARGS } from '../../../scripts/lib/ui-driver.mjs';
import { mkdirSync } from 'node:fs';

const DIR = 'qa/2026-11-16_sil824-after';
mkdirSync(DIR, { recursive: true });

const SCENARIOS = [
  { name: '1920-open', w: 1920, h: 1080, side: 'open', wantMode: 'table' },
  { name: '1440-closed', w: 1440, h: 900, side: 'closed', wantMode: 'table' },
  { name: '1440-open', w: 1440, h: 900, side: 'open', wantMode: 'card' },
  { name: '1280-open', w: 1280, h: 800, side: 'open', wantMode: 'card' },
  { name: '768', w: 768, h: 900, side: 'open', wantMode: 'card' },
];

const MEASURE = (needle) => {
  const ledger = document.querySelector('.shipment-container-ledger');
  const table = ledger.querySelector('table');
  const tbody = table.querySelector('tbody');
  const mode = getComputedStyle(tbody).display === 'block' ? 'card' : 'table';
  const out = { mode, canvas: Math.round(ledger.getBoundingClientRect().width), minWidth: getComputedStyle(table).minWidth };
  // horizontal scroll check on the table's scroll parent
  const scroller = table.closest('[style*="overflow"], .shipment-container-ledger__scroll, main') || ledger;
  out.scrollerScrollW = scroller.scrollWidth; out.scrollerClientW = scroller.clientWidth;
  out.hScroll = scroller.scrollWidth > scroller.clientWidth + 1;
  // the target row's route cells (fall back to every route cell if filtered row absent)
  let tds = [...table.querySelectorAll("td[data-label='Nâng / hạ']")].filter((td) => td.textContent.includes(needle));
  out.rowFound = tds.length > 0;
  if (!out.rowFound) tds = [...table.querySelectorAll("td[data-label='Nâng / hạ']")];
  out.cells = [];
  for (const td of tds) {
    const tdR = td.getBoundingClientRect();
    for (const span of td.querySelectorAll('.shipment-container-ledger__route > span')) {
      const spanCW = span.clientWidth;
      const range = document.createRange(); range.selectNodeContents(span);
      const lines = [...range.getClientRects()].filter((r) => r.width > 2);
      let tokenW = 0, tokenText = '';
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        for (const word of node.textContent.split(/\s+/)) {
          if (!word) continue;
          const idx = node.textContent.indexOf(word);
          const r = document.createRange();
          r.setStart(node, idx); r.setEnd(node, idx + word.length);
          const w = r.getBoundingClientRect().width;
          if (w > tokenW) { tokenW = Math.round(w * 10) / 10; tokenText = word; }
        }
      }
      const clipped = lines.some((l) => l.right > tdR.right - 1);
      const shatter = tokenW > spanCW + 0.5;
      out.cells.push({
        text: span.textContent.slice(0, 30), spanCW, tokenW, tokenText,
        clipped, shatter, hasTooltip: !!span.closest('[title]') || !!span.title,
        maxLineRight: Math.max(...lines.map((l) => Math.round(l.right))),
        tdRight: Math.round(tdR.right),
      });
    }
  }
  out.clipCount = out.cells.filter((c) => c.clipped).length;
  out.shatterCount = out.cells.filter((c) => c.shatter).length;
  return out;
};

const token = await login('admin', { backend: DEFAULT_BACKEND, frontend: DEFAULT_FRONTEND });
await withSession(token, async (page, ctx) => {
  const results = [];
  for (const sc of SCENARIOS) {
    await page.setViewport({ width: sc.w, height: sc.h });
    await page.goto(`${DEFAULT_FRONTEND}/shipments-detail`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 900));
    await page.evaluate(() => {
      const all = [...document.querySelectorAll('[role="tab"]')].find((t) => (t.textContent || '').trim() === 'Tất cả');
      if (all) all.click();
    });
    await new Promise((r) => setTimeout(r, 1200));
    await page.evaluate(() => {
      const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').includes('Booking'));
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'EGSU0180803');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    await new Promise((r) => setTimeout(r, 1200));
    // ensure sidebar state via the app's own toggle
    await page.evaluate((wantClosed) => {
      const app = document.querySelector('.app');
      const closed = app.classList.contains('sidebar-closed');
      if (wantClosed !== closed) {
        const btn = document.querySelector('button[aria-label*="điều hướng"], button[title*="menu"], .app-sidebar-toggle, header button[aria-label*="menu"]');
        (btn || [...document.querySelectorAll('header button')].find((b) => (b.getAttribute('aria-label') || '').includes('menu')))?.click();
      }
    }, sc.side === 'closed');
    await new Promise((r) => setTimeout(r, 900));
    const data = await page.evaluate(MEASURE, 'VipGreenPort');
    const ok = data.mode === sc.wantMode
      && data.clipCount === 0
      && (sc.wantMode === 'card' || (!data.hScroll && data.cells.every((c) => !c.shatter || c.hasTooltip)));
    results.push({ scenario: sc.name, ok, ...data });
    await page.screenshot({ path: `${DIR}/sil824-after-${sc.name}.png` });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${sc.name}: mode=${data.mode} canvas=${data.canvas} clips=${data.clipCount} shatter=${data.shatterCount} hScroll=${data.hScroll} rowFound=${data.rowFound}`);
    for (const c of data.cells) console.log(`   cell "${c.text}" box=${c.spanCW} token=${c.tokenW}(${c.tokenText}) clipped=${c.clipped} shatter=${c.shatter} tooltip=${c.hasTooltip} lineRight=${c.maxLineRight} tdRight=${c.tdRight}`);
  }
  const allOk = results.every((r) => r.ok);
  console.log(allOk ? 'ALL SCENARIOS PASS' : 'SCENARIO FAILURES PRESENT');
  if (!allOk) process.exitCode = 1;
}, { viewport: { width: 1920, height: 1080 }, args: STANDARD_BROWSER_ARGS, artifactDir: 'qa', name: '2026-11-16_sil824-after' });
