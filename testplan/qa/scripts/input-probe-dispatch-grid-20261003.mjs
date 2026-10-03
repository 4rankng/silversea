import puppeteer from 'puppeteer';
const BASE = 'https://vantai.tingting.vip';
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.type('input', 'admin');
await (await page.$('input[type="password"]')).type('Abc123');
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {}), page.keyboard.press('Enter')]);
await new Promise(r => setTimeout(r, 2500));
await page.evaluateOnNewDocument(() => {
  window.__probe = { pointerdown: 0, click: 0, keydown: 0 };
  for (const t of ['pointerdown', 'click', 'keydown']) document.addEventListener(t, e => { if (e.isTrusted) window.__probe[t] += 1; }, { capture: true, passive: true });
});
await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 5000));
// Census: a grid DATA cell + a row action button.
const cell = await page.evaluate(() => {
  const td = document.querySelector('.master-plan-grid tbody td, table tbody td, [class*=grid] td, [class*=row] td');
  if (!td) return null;
  const r = td.getBoundingClientRect();
  return { x: Math.round(r.x + Math.min(40, r.width / 2)), y: Math.round(r.y + r.height / 2), cls: String(td.className).slice(0, 40), text: td.textContent.slice(0, 20) };
});
console.log('cell:', JSON.stringify(cell));
if (cell) {
  await page.mouse.move(cell.x, cell.y); await page.mouse.down(); await page.mouse.up();
  await new Promise(r => setTimeout(r, 500));
  await page.keyboard.type('x', { delay: 30 });
  await new Promise(r => setTimeout(r, 800));
}
const rowAction = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => /Chi tiết|Gán xe|Điều phối/.test(b.innerText) && b.getBoundingClientRect().width > 0);
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: btn.innerText.trim().slice(0, 20) };
});
console.log('rowAction:', JSON.stringify(rowAction));
if (rowAction) {
  await page.mouse.move(rowAction.x, rowAction.y); await page.mouse.down(); await page.mouse.up();
  await new Promise(r => setTimeout(r, 1200));
}
const counts = await page.evaluate(() => window.__probe);
console.log('counts-after-grid-probe:', JSON.stringify(counts));
await page.screenshot({ path: 'qa/2026-10-03_card313/grid-probe-1440.png' });
await browser.close();
