#!/usr/bin/env node
/** SIL-964 — measure the Lô cell per row at 1440 (both sidebars, FCL+LCL tabs)
 * after the r3 fix (Lô 16% + 11px face for 17+ char codes), plus an 18-char
 * worst-case probe: the staging FAIL row R4B-A14-EMPTY-8F29 measured with the
 * live code faces (canvas text metrics — the page itself is never altered),
 * projected onto the tightest selectable-row budget measured on the board. */
import { login } from '../../../scripts/lib/http.mjs';
import { withSession, STANDARD_BROWSER_ARGS } from '../../../scripts/lib/ui-driver.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const DIR = 'qa/2026-11-19_sil964';
mkdirSync(DIR, { recursive: true });

const MEASURE = () => {
  const table = document.querySelector('.debit-board');
  const out = { tableW: Math.round(table.getBoundingClientRect().width), rows: [], overflowRows: 0, minGap: Infinity, longFaceRows: 0, docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth };
  for (const td of table.querySelectorAll('td.debit-col--lot')) {
    const tdR = td.getBoundingClientRect();
    const ref = td.querySelector('.debit-lot-ref');
    const codeSpan = ref?.querySelector('span:last-child');
    if (!codeSpan) continue;
    const codeR = codeSpan.getBoundingClientRect();
    const gap = Math.round((tdR.right - codeR.right) * 10) / 10;
    const code = codeSpan.textContent.trim();
    const selectable = !!ref.querySelector('.debit-row-checkbox');
    out.rows.push({ code: code.slice(0, 24), codeLen: code.length, codeW: Math.round(codeR.width * 10) / 10, tdW: Math.round(tdR.width * 10) / 10, selectable, longFace: codeSpan.classList.contains('debit-lot-code--long'), gap, overflows: gap < 0 });
    if (codeSpan.classList.contains('debit-lot-code--long')) out.longFaceRows += 1;
    if (gap < 0) out.overflowRows += 1;
    if (gap < out.minGap) out.minGap = gap;
  }
  out.minGap = out.minGap === Infinity ? null : out.minGap;
  return out;
};

const PROBE18 = () => {
  // Text metrics only: measure the 18-char staging FAIL code with the exact
  // live faces (the inherited code face and the 11px long face).
  const sample = document.querySelector('.debit-lot-ref span:last-child');
  if (!sample) return null;
  const cs = getComputedStyle(sample);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = (px) => `${cs.fontStyle} ${cs.fontWeight} ${px}px ${cs.fontFamily}`;
  ctx.font = font(parseFloat(cs.fontSize));
  const wInherited = ctx.measureText('R4B-A14-EMPTY-8F29').width;
  ctx.font = font(11);
  const wLong = ctx.measureText('R4B-A14-EMPTY-8F29').width;
  return { face: `${parseFloat(cs.fontSize)}px ${cs.fontFamily.split(',')[0]}`, wInherited: Math.round(wInherited * 10) / 10, wLong: Math.round(wLong * 10) / 10 };
};

const token = await login('hoapt', { backend: 'http://localhost:3002/api', frontend: 'http://localhost:7175' });
const results = {};
let pass = true;
await withSession(token, async (page, ctx) => {
  for (const side of ['open', 'closed']) {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto('http://localhost:7175/accounting/chot-debit', { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1800));
    if (side === 'closed') {
      await page.evaluate(() => {
        const app = document.querySelector('.app');
        if (!app.classList.contains('sidebar-closed')) {
          const btn = document.querySelector('button[aria-label*="điều hướng"], header button[aria-label*="menu"]');
          (btn || [...document.querySelectorAll('header button')].find((b) => (b.getAttribute('aria-label') || '').includes('menu')))?.click();
        }
      });
      await new Promise((r) => setTimeout(r, 800));
    }
    for (const tab of ['FCL', 'LCL']) {
      await page.evaluate((tab) => {
        const tabs = [...document.querySelectorAll('[role="tab"], button')];
        const t = tabs.find((b) => (b.textContent || '').trim() === tab);
        if (t) t.click();
      }, tab);
      await new Promise((r) => setTimeout(r, 900));
      const m = await page.evaluate(MEASURE);
      const probe = await page.evaluate(PROBE18);
      // Worst-case projection for a SELECTABLE row carrying the 18-char code
      // on the long face: budget (= gap + measured code width of the tightest
      // selectable row) minus the 18-char long-face width.
      const selectable = m.rows.filter((r) => r.selectable);
      let projected = null;
      if (selectable.length && probe) {
        const tightest = selectable.reduce((a, b) => (a.gap + a.codeW <= b.gap + b.codeW ? a : b));
        projected = Math.round((tightest.gap + tightest.codeW - probe.wLong) * 10) / 10;
      }
      const ok = m.overflowRows === 0 && m.docScrollW <= m.docClientW && (projected === null || projected >= 0);
      pass = pass && ok;
      results[`${side}-${tab}`] = { ...m, probe, projected18Gap: projected, ok };
      await page.screenshot({ path: `${DIR}/sil964-${side}-${tab}.png` });
      console.log(`${side} ${tab}: rows=${m.rows.length} overflow=${m.overflowRows} minGap=${m.minGap} longFace=${m.longFaceRows} scroll=${m.docScrollW}/${m.docClientW} probe18=${probe ? `inh ${probe.wInherited} / long ${probe.wLong}` : 'n/a'} projectedGap18=${projected} → ${ok ? 'PASS' : 'FAIL'}`);
      const worst = [...m.rows].sort((a, b) => a.gap - b.gap).slice(0, 3);
      for (const w of worst) console.log('   worst', JSON.stringify(w));
    }
  }
  writeFileSync(`${DIR}/measure.json`, JSON.stringify(results, null, 1));
  console.log(`SIL-964 measure: ${pass ? 'PASS — every row gap ≥ 0, no horizontal scroll, 18-char worst case fits' : 'FAIL'}`);
  process.exitCode = pass ? 0 : 1;
}, { viewport: { width: 1440, height: 900 }, args: STANDARD_BROWSER_ARGS, artifactDir: 'qa', name: '2026-11-19_sil964' });
