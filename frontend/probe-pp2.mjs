import fs from 'node:fs';
import puppeteer from '../node_modules/.pnpm/puppeteer-core@25.1.0/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const token = fs.readFileSync('/private/var/folders/8j/qs8k8y3n1hlfbl4q20k0hgjh0000gn/T/opencode/tok_ketoan.txt', 'utf8').trim();
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 300000, args: ['--window-size=1480,940'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => console.log('CONSOLE', m.type(), m.text().slice(0, 160)));
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 300)));
page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('NAV', f.url()); });
page.on('requestfailed', r => console.log('REQFAIL', r.url().slice(0, 100), r.failure()?.errorText));
await page.evaluateOnNewDocument((jwt) => localStorage.setItem('token', jwt), token);
const t0 = Date.now();
await page.goto('http://localhost:7175/accounting/phoi-phieu', { waitUntil: 'domcontentloaded' });
for (let i = 1; i <= 6; i++) {
  await new Promise(r => setTimeout(r, 10000));
  const state = await page.evaluate(() => ({
    url: location.pathname,
    board: !!document.querySelector('.ppc-board'),
    bodyLen: document.body.textContent.length,
    h2: Array.from(document.querySelectorAll('h2,h1')).slice(0, 4).map(h => h.textContent),
  })).catch(e => `evalfail: ${String(e).slice(0, 100)}`);
  console.log(`t+${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(state).slice(0, 220));
  if (state && state.board) break;
}
await page.screenshot({ path: '/tmp/probe-pp2.png' }).catch(e => console.log('shot fail', e.message.slice(0, 80)));
await browser.close();
