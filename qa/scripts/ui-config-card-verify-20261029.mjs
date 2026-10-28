// SIL-585 verify — /config/customers @390: the 978px catalogue board is gone;
// rows render as data-dense label/value cards (no whole-table horizontal
// scroll), every fact still present. @768 + @1280 keep the tabular frame.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7199';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };
let checks = 0; const fails = [];
const check = (name, ok, detail = '') => {
  checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 120000 });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'giamdoc');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1500));
  say(`login → ${new URL(page.url()).pathname}`);

  for (const width of [390, 768, 1280]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${FE}/config/customers`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.evaluate(() => { const w = document.querySelector('.record-table-wrap'); if (w) w.dataset.page = 'customers'; });
    await new Promise((r) => setTimeout(r, 2200));
    const m = await page.evaluate(() => {
      const wrap = document.querySelector('.record-table-wrap');
      const table = document.querySelector('table.record-table');
      const thead = table?.querySelector('thead');
      const rows = [...document.querySelectorAll('table.record-table tbody tr')].filter((r) => !r.classList.contains('cfg-empty-row'));
      const first = rows[0];
      const facts = first ? [...first.querySelectorAll('td')].filter((td) => (td.dataset.label || '') !== '').length : 0;
      const labels = first ? [...first.querySelectorAll('td')].slice(0, 3).map((td) => getComputedStyle(td, '::before').content) : [];
      return {
        wrapScrollW: wrap ? wrap.scrollWidth : null,
        wrapClientW: wrap ? wrap.clientWidth : null,
        tableDisplay: table ? getComputedStyle(table).display : null,
        theadDisplay: thead ? getComputedStyle(thead).display : null,
        rowCount: rows.length,
        factsPerRow: facts,
        beforeLabels: labels,
        rowH: first ? +first.getBoundingClientRect().height.toFixed(0) : 0,
        bodyScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    say(`@${width}: ${JSON.stringify(m)}`);
    if (width === 390) {
      check('@390 no whole-table horizontal scroll', m.wrapScrollW != null && m.wrapScrollW <= m.wrapClientW + 1, `scrollW=${m.wrapScrollW} clientW=${m.wrapClientW}`);
      check('@390 card mode (table block, thead hidden)', m.tableDisplay === 'block' && m.theadDisplay === 'none', `table=${m.tableDisplay} thead=${m.theadDisplay}`);
      check('@390 rows keep all labelled facts', m.rowCount > 0 && m.factsPerRow >= 5, `rows=${m.rowCount} facts=${m.factsPerRow}`);
      check('@390 labels ride the cells (::before)', m.beforeLabels.every((l) => l && l !== 'none'), JSON.stringify(m.beforeLabels));
      check('@390 no page-level horizontal overflow', !m.bodyScrollX);
      await page.evaluate(() => document.querySelector('.record-table-wrap')?.scrollIntoView({ block: 'start' }));
      await new Promise((r) => setTimeout(r, 400));
      await page.screenshot({ path: resolve(OUT, '2026-10-29_sil585_ui-config-390-cards.png') });
    } else {
      check(`@${width} tabular frame kept`, m.tableDisplay === 'table' && m.theadDisplay !== 'none', `table=${m.tableDisplay} thead=${m.theadDisplay}`);
      if (width === 768) await page.screenshot({ path: resolve(OUT, '2026-10-29_sil585_ui-config-768-table.png') });
      else await page.screenshot({ path: resolve(OUT, '2026-10-29_sil585_ui-config-1280-table.png') });
    }
  }
  // A shared-CrudTable catalog (ports) — the record-table--config family
  for (const width of [390, 768]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${FE}/config/ports`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2200));
    const m = await page.evaluate(() => {
      const table = document.querySelector('table.record-table');
      const wrap = document.querySelector('.record-table-wrap');
      const first = [...(table?.querySelectorAll('tbody tr') ?? [])].find((r) => !r.classList.contains('cfg-empty-row'));
      return {
        isConfig: table?.classList.contains('record-table--config') ?? false,
        display: table ? getComputedStyle(table).display : null,
        thead: (() => { const t = table?.querySelector('thead'); return t ? getComputedStyle(t).display : null; })(),
        wrapScrollW: wrap ? wrap.scrollWidth : null,
        wrapClientW: wrap ? wrap.clientWidth : null,
        rows: first ? 1 : 0,
      };
    });
    say(`ports @${width}: ${JSON.stringify(m)}`);
    if (width === 390) {
      check('@390 ports card mode (block, no thead)', m.isConfig && m.display === 'block' && m.thead === 'none', JSON.stringify(m));
      check('@390 ports no horizontal scroll', m.wrapScrollW != null && m.wrapScrollW <= m.wrapClientW + 1, `sw=${m.wrapScrollW} cw=${m.wrapClientW}`);
      await page.screenshot({ path: resolve(OUT, '2026-10-29_sil585_ui-ports-390-cards.png') });
    } else {
      check(`@768 ports tabular frame kept`, m.display === 'table' && m.thead !== 'none', JSON.stringify(m));
    }
  }
} finally {
  await browser.close();
  writeFileSync(resolve(OUT, '2026-10-29_sil585_ui-driver.log'), log.join('\n') + '\nTOTAL ' + (checks - fails.length) + '/' + checks + ' PASS\n');
  say(`TOTAL ${checks - fails.length}/${checks} PASS`);
  if (fails.length) process.exit(1);
}
