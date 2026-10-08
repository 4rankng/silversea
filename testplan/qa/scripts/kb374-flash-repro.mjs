// Card 051026230703 — reproduce the nav flash properly: wait for the workspace
// to mount, click 'Kiểm soát phơi phiếu', hold the lazy chunk ~1.8s, frames.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const EV = 'testplan/qa/evidence/2026-10-06_card051026230703-nav-flash';
fs.mkdirSync(EV, { recursive: true });
const r = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'ketoan', password: 'Abc123' }) });
const token = (await r.json()).token;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const client = await page.createCDPSession();
await client.send('Fetch.enable', { patterns: [{ urlPattern: '*PhoiPhieuControlPage*' }] });
let held = 0;
client.on('Fetch.requestPaused', async (e) => {
  held += 1;
  console.log('HELD', e.request.url.slice(0, 100));
  await new Promise((res) => setTimeout(res, 1800));
  try { await client.send('Fetch.continueRequest', { requestId: e.requestId }); } catch {}
});
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto('http://localhost:7175/accounting', { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('[data-testid="accounting-workspace"]', { timeout: 30000 });
await page.waitForSelector("a[href=\"/accounting/phoi-phieu\"]", { timeout: 15000 });
await new Promise((res) => setTimeout(res, 5000)); // the warm fetch (held 1.8s per dev-module request) completes before the click
console.log('WORKSPACE_MOUNTED, url:', page.url());
const frames = [];
for (let i = 0; i < 14; i += 1) {
  if (i === 0) { page.click('a[href="/accounting/phoi-phieu"]').catch(() => {}); console.log('clicked'); }
  await new Promise((res) => setTimeout(res, 200));
  const state = await page.evaluate(() => ({
    url: location.pathname,
    h1: document.querySelector('h1')?.textContent ?? null,
    loader: Boolean(document.querySelector('[data-page-loader="true"]')),
    board: Boolean(document.querySelector('.ppc-board-wrap, .ppc-board, .ppc-selection-hint')),
    workspace: Boolean(document.querySelector('[data-testid="accounting-workspace"]')),
  }));
  frames.push({ t: i * 200, ...state });
  await page.screenshot({ path: `${EV}/frame-${String(i).padStart(2, '0')}.png` });
}
console.log('HELD_COUNT', held);
console.log('FRAMES', JSON.stringify(frames));
await new Promise((res) => setTimeout(res, 2000));
await browser.close();
