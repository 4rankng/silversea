#!/usr/bin/env node
/** SIL-835 round-2 — measure the Lô cell overflow per row at 1440 (both sidebars, FCL+LCL tabs). */
import { login } from '../../../scripts/lib/http.mjs';
import { withSession, STANDARD_BROWSER_ARGS } from '../../../scripts/lib/ui-driver.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const DIR = 'qa/2026-11-17_sil835-round2';
mkdirSync(DIR, { recursive: true });

const MEASURE = () => {
  const table = document.querySelector('.debit-board');
  const out = { tableW: Math.round(table.getBoundingClientRect().width), rows: [], overflowRows: 0, minGap: Infinity, maxOverflow: -Infinity, docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth };
  for (const td of table.querySelectorAll('td.debit-col--lot')) {
    const tdR = td.getBoundingClientRect();
    const ref = td.querySelector('.debit-lot-ref');
    const codeSpan = ref?.querySelector('span:last-child');
    if (!codeSpan) continue;
    const codeR = codeSpan.getBoundingClientRect();
    const gap = Math.round((tdR.right - codeR.right) * 10) / 10;
    const code = codeSpan.textContent.trim();
    out.rows.push({ code: code.slice(0, 20), codeW: Math.round(codeR.width * 10) / 10, tdW: Math.round(tdR.width * 10) / 10, gap, overflows: gap < 0 });
    if (gap < 0) out.overflowRows += 1;
    if (gap < out.minGap) out.minGap = gap;
    if (gap > out.maxOverflow) out.maxOverflow = gap;
  }
  out.minGap = out.minGap === Infinity ? null : out.minGap;
  out.maxOverflow = out.maxOverflow === -Infinity ? null : out.maxOverflow;
  return out;
};

const token = await login('hoapt', { backend: 'http://localhost:3002/api', frontend: 'http://localhost:7175' });
const results = {};
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
      results[`${side}-${tab}`] = m;
      await page.screenshot({ path: `${DIR}/sil835-r2-${side}-${tab}.png` });
      console.log(`${side} ${tab}: rows=${m.rows.length} overflowRows=${m.overflowRows} minGap=${m.minGap} tableW=${m.tableW} docScroll=${m.docScrollW}/${m.docClientW}`);
      const worst = [...m.rows].sort((a, b) => a.gap - b.gap).slice(0, 3);
      for (const w of worst) console.log('   worst', JSON.stringify(w));
    }
  }
  writeFileSync(`${DIR}/measure.json`, JSON.stringify(results, null, 1));
}, { viewport: { width: 1440, height: 900 }, args: STANDARD_BROWSER_ARGS, artifactDir: 'qa', name: '2026-11-17_sil835-r2' });
