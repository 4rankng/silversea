// F-3 retest: Ngày giao hàng must render exactly ONE required mark (the rose
// ds-field__required), no doubled asterisk — local frontend :7175 with fix.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const OUT = new URL('../1016-ui/', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const res = await fetch(API + '/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!res.ok) throw new Error('local admin login failed');
const token = (await res.json()).token;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(BASE + '/shipments/new', { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);

await page.evaluate(() => { const el = [...document.querySelectorAll('span')].find((n) => n.childElementCount === 0 && n.textContent.trim() === 'Hàng lẻ'); el?.scrollIntoView({ block: 'center' }); });
await sleep(300);
const btn = await page.evaluateHandle(() => [...document.querySelectorAll('span')].find((n) => n.childElementCount === 0 && n.textContent.trim() === 'Hàng lẻ'));
const b = await btn.asElement().evaluate((n) => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.up();
await sleep(1000);

const probe = await page.evaluate(() => {
  const label = [...document.querySelectorAll('label')].find((n) => n.textContent.includes('Ngày giao hàng'));
  return {
    labelHtml: label?.outerHTML ?? null,
    starCount: label ? (label.innerHTML.match(/\*/g) ?? []).length : null,
    brandStars: label?.querySelectorAll('.text-brand-tertiary').length ?? null,
    dsStars: label?.querySelectorAll('.ds-field__required').length ?? null,
  };
});
console.log('FIX-PROBE', JSON.stringify(probe, null, 1));
await page.evaluate(() => document.querySelector('label[for="shipment-expected-delivery"]')?.scrollIntoView({ block: 'center' }));
await page.mouse.move(2, 2);
await sleep(400);
await page.screenshot({ path: OUT + '1016_retest-fix_single-required-mark.png', fullPage: false });
await browser.close();
