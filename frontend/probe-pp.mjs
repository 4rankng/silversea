import fs from 'node:fs';
import puppeteer from '../node_modules/.pnpm/puppeteer-core@25.1.0/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const token = fs.readFileSync('/private/var/folders/8j/qs8k8y3n1hlfbl4q20k0hgjh0000gn/T/opencode/tok_ketoan.txt', 'utf8').trim();
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 300000, args: ['--window-size=1480,940'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (m.type() === 'error') console.log('PAGE-ERR:', m.text().slice(0, 200)); });
await page.evaluateOnNewDocument((jwt) => localStorage.setItem('token', jwt), token);
const t0 = Date.now();
await page.goto('http://localhost:7175/accounting/phoi-phieu', { waitUntil: 'domcontentloaded' });
console.log('loaded', Date.now() - t0);
for (const sel of ['.ppc-board', '.ppc-report-controls', '.ppc-report-tab']) {
  try { await page.waitForSelector(sel, { timeout: 120000 }); console.log('found', sel, Date.now() - t0); }
  catch { console.log('TIMEOUT', sel, Date.now() - t0); }
}
const alive = await page.evaluate(() => 1 + 1).catch(e => `dead:${e.message.slice(0, 80)}`);
console.log('alive:', alive);
await page.screenshot({ path: '/tmp/probe-pp.png' });
await browser.close();
