import puppeteer from 'puppeteer';
const r = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dvthuc', password: 'Abc123' }) });
const token = (await r.json()).token;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1400 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto('http://localhost:7175/my-trips/35381', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((res) => setTimeout(res, 4500));
const strip = await page.$('.dcc-photos');
if (!strip) throw new Error('photo strip not found');
await strip.scrollIntoView();
await new Promise((res) => setTimeout(res, 1200));
await strip.screenshot({ path: 'testplan/qa/evidence/2026-10-06_card051026230645-driver-note-multi/photo-strip-three-photos.png' });
const info = await page.evaluate(() => [...document.querySelectorAll('.dcc-photo-fig')].map((f) => ({
  caption: f.querySelector('figcaption')?.textContent,
  delete: f.querySelector('button')?.getAttribute('aria-label'),
  imgLoaded: Boolean(f.querySelector('img[src^="blob:"]')),
})));
console.log(JSON.stringify(info, null, 1));
await browser.close();
