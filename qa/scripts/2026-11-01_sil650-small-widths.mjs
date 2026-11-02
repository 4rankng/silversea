// SIL-650 — small-width verification (320/360/768) after the fix: overflow,
// counter clipping, card-band integrity.
import puppeteer from 'puppeteer-core';
import { appendFileSync } from 'node:fs';
const LOG = 'qa/2026-11-01_sil650-factories-after_ui-driver.log';
const log = (l) => { const t = `${new Date().toISOString()} ${l}`; console.log(t); appendFileSync(LOG, `${t}\n`); };
const login = await fetch('http://localhost:3002/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const { token } = await login.json();
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
for (const [width, height] of [[320, 700], [360, 740], [768, 900]]) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto('http://localhost:7175/config/factories', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.cfg-page--factories', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 700));
  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const summary = document.querySelector('.cfg-page--factories .cfg-page__summary');
    const bar = document.querySelector('.cfg-page--factories .filter-bar');
    const table = document.querySelector('.factories-table');
    const rows = document.querySelectorAll('.factories-table tbody tr').length;
    const sr = summary?.getBoundingClientRect();
    const br = bar?.getBoundingClientRect();
    return {
      pageOver: doc.scrollWidth - doc.clientWidth,
      summaryText: summary?.textContent.trim(),
      summaryFlush: sr && br ? br.right - sr.right : null,
      tableW: table ? Math.round(table.getBoundingClientRect().width) : null,
      rows,
    };
  });
  await page.screenshot({ path: `testplan/assets/sil650-after-${width}.png` });
  log(`w${width}: pageOver=${m.pageOver} summary="${m.summaryText}" slackToCardEdge=${m.summaryFlush}px table=${m.tableW} rows=${m.rows}`);
  await page.close();
}
await browser.close();
log('small-width pass done');
process.exit(0);
