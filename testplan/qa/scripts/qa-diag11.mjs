import puppeteer from 'puppeteer';
const BASE = 'https://vantai.tingting.vip';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

// TAB A: login (input works here)
const a = await browser.newPage();
await a.setViewport({ width: 1440, height: 900 });
await a.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 60000 });
await a.waitForSelector('#password-input', { timeout: 30000 });
const idSel = 'input:not([type="password"]):not([type="submit"]):not([type="checkbox"])';
await a.click(idSel); await a.type(idSel, 'dungnv', { delay: 10 });
await a.click('#password-input'); await a.type('#password-input', 'Abc123', { delay: 10 });
await a.click('button[type="submit"]');
await new Promise(r => setTimeout(r, 6000));

// TAB B (fresh): dispatch trực tiếp — cookie auth có sẵn
const b = await browser.newPage();
await b.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
await b.goto(BASE + '/dispatch', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 6000));
console.log('tabB url:', b.url());

await b.evaluate(() => { window.__evts = 0; document.addEventListener('mousedown', () => window.__evts++, true); });
const r = await b.evaluate(() => {
  const boxes = document.querySelectorAll('.ops-lcl-check');
  if (!boxes.length) return null;
  boxes[0].scrollIntoView({ block: 'center' });
  const rect = boxes[0].getBoundingClientRect();
  return { x: Math.round(rect.x + 9), y: Math.round(rect.y + 9), n: boxes.length };
});
console.log('tabB target:', JSON.stringify(r));
if (r) {
  await new Promise(r2 => setTimeout(r2, 500));
  await b.bringToFront();
  await b.mouse.move(r.x, r.y);
  await new Promise(r2 => setTimeout(r2, 300));
  await b.mouse.click(r.x, r.y);
  await new Promise(r2 => setTimeout(r2, 1000));
  const st = await b.evaluate(() => ({
    evts: window.__evts,
    checked: document.querySelectorAll('.ops-lcl-check')[0].getAttribute('aria-checked'),
    bar: document.querySelector('.lcl-selection-bar')?.innerText.replace(/\n/g, ' | ').slice(0, 150) || null,
  }));
  console.log('FRESH-TAB RESULT:', JSON.stringify(st));
  await b.screenshot({ path: '/tmp/e2e-lcl/freshtab-1ticked.png' });
}
await browser.close();
