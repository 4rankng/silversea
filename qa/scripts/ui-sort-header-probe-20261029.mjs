// SIL-571 probe — measure every sortable header on /shipments across
// 1024/1280/1366/1440/1920: th box vs .table-sort-button one-line width,
// computed type, and pairwise intersections. Output drives the min-width law.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7285';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new' });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'admin');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));
  await page.goto(`${FE}/shipments`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  for (const width of [1024, 1280, 1366, 1440, 1920]) {
    await page.setViewport({ width, height: 800 });
    await new Promise((r) => setTimeout(r, 700));
    const data = await page.evaluate(() => {
      const ths = [...document.querySelectorAll('.cus-dashboard-table thead th')];
      const cells = ths.map((th) => {
        const btn = th.querySelector('.table-sort-button');
        const b = th.getBoundingClientRect();
        const r = btn ? btn.getBoundingClientRect() : null;
        const cs = btn ? getComputedStyle(btn) : null;
        return {
          text: (btn?.textContent ?? th.textContent).trim().replace(/\s+/g, ' ').slice(0, 26),
          thW: +b.width.toFixed(1), thX: +b.x.toFixed(1),
          btnW: r ? +r.width.toFixed(1) : null,
          btnRight: r ? +r.right.toFixed(1) : null,
          fontSize: cs?.fontSize, letterSpacing: cs?.letterSpacing,
          scrollW: btn ? btn.scrollWidth : null,
        };
      });
      // pairwise intersections between adjacent sort buttons
      const inter = [];
      for (let i = 0; i < cells.length - 1; i += 1) {
        const a = cells[i]; const b = cells[i + 1];
        if (a.btnRight != null && b.btnW != null && a.btnRight > b.thX + 0.5) {
          inter.push(`${a.text} → ${b.text}: ${+(a.btnRight - b.thX).toFixed(1)}px`);
        }
      }
      const table = document.querySelector('.cus-dashboard-table');
      return { cells, inter, tableW: +table.getBoundingClientRect().width.toFixed(1) };
    });
    say(`@${width} table=${data.tableW}px intersections=${data.inter.length ? data.inter.join(' | ') : 'none'}`);
    for (const c of data.cells) say(`   ${c.text.padEnd(28)} th=${String(c.thW).padStart(7)} btn=${String(c.btnW).padStart(7)} scroll=${String(c.scrollW).padStart(7)} fs=${c.fontSize} ls=${c.letterSpacing}`);
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/2026-10-29_sil571_probe.log`, log.join('\n') + '\n');
