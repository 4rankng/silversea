import puppeteer from 'puppeteer';
const r = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dvthuc', password: 'Abc123' }) });
const token = (await r.json()).token;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1400 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto('http://localhost:7175/my-trips/35381', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((res) => setTimeout(res, 4500));
// Per-key delete: remove ONLY photo 1, assert 2 remain with reindexed labels.
const del1 = await page.$('button[aria-label="Xóa ảnh biên bản 1"]');
await del1.click();
for (let i = 0; i < 15; i += 1) {
  await new Promise((res) => setTimeout(res, 1000));
  const n = await page.evaluate(() => document.querySelectorAll('.dcc-photo-fig').length);
  if (n === 2) break;
}
const afterOne = await page.evaluate(() => ({
  figures: document.querySelectorAll('.dcc-photo-fig').length,
  deletes: [...document.querySelectorAll('button[aria-label^="Xóa ảnh biên bản"]')].map((b) => b.getAttribute('aria-label')),
}));
console.log('AFTER-DELETE-1', JSON.stringify(afterOne));
if (afterOne.figures !== 2) throw new Error('per-key delete did not remove exactly one photo');
await page.screenshot({ path: 'testplan/qa/evidence/2026-10-06_card051026230645-driver-note-multi/after-per-key-delete.png', fullPage: true });
await browser.close();
console.log('DELETE PASS');
