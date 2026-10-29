import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = join(process.cwd(), 'public');
const types = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const server = createServer((req, res) => {
  const path = req.url === '/' ? '/__sil562-fontcheck.html' : req.url.split('?')[0];
  const file = join(root, path);
  if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage();
await page.goto(base, { waitUntil: 'networkidle0' });
// Ensure BOTH faces finished loading before measuring.
await page.evaluate(async () => { await document.fonts.load("16px 'Inter Digits'"); await document.fonts.load("16px 'Be Vietnam Pro'"); await document.fonts.ready; });

const result = await page.evaluate(() => {
  const widths = {};
  for (const el of document.querySelectorAll('#digits .cell')) {
    widths[el.dataset.digit] = el.getBoundingClientRect().width;
  }
  const w = Object.values(widths);
  return {
    loaded: [...document.fonts].map((f) => `${f.family} ${f.status}`),
    widths,
    spread: Math.max(...w) - Math.min(...w),
  };
});
result.base = base;
console.log(JSON.stringify(result, null, 2));
writeFileSync(process.argv[2] ?? '/dev/stdout', JSON.stringify(result, null, 2));
await browser.close();
server.close();
