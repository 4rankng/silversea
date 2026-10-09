import puppeteer from 'puppeteer';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const health = await fetch(`${API}/health`).then((r) => r.json());
console.log('build', health.buildHash);
const token = (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) })).json()).token;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 90000 });
await new Promise((r) => setTimeout(r, 4500));
const info = await page.evaluate(() => {
  const root = document.querySelector('[data-split-datetime]');
  const r = root.getBoundingClientRect();
  const x = r.right - 8, y = r.y + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  const chain = [];
  let n = hit; while (n && chain.length < 6) { chain.push(n.tagName + '.' + String(n.className).slice(0, 40)); n = n.parentElement; }
  const inRoot = root.contains(hit);
  return { x: Math.round(x), y: Math.round(y), hit: chain, inRoot, rootTag: root.tagName, rootCls: String(root.className).slice(0, 60) };
});
console.log('pre-click', JSON.stringify(info));
await page.mouse.move(info.x, info.y);
await page.mouse.down(); await page.mouse.up();
await new Promise((r) => setTimeout(r, 900));
const post = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].map((d) => { const r = d.getBoundingClientRect(); return { role: d.getAttribute('role'), text: (d.textContent || '').replace(/\s+/g, ' ').slice(0, 80), pos: getComputedStyle(d).position, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; });
  const popovers = [...document.querySelectorAll('[class*="popover"], [class*="calendar"], [class*="panel"]')].filter((e) => e.offsetParent !== null).slice(0, 6).map((e) => ({ cls: String(e.className).slice(0, 60), text: (e.textContent || '').replace(/\s+/g, ' ').slice(0, 50) }));
  return { dialogs, popovers };
});
console.log('post-click', JSON.stringify(post));
await page.screenshot({ path: '/Volumes/LexarSSD/projects/silversea-prod/qa/2026-10-09_card081026230510-fb001-picker_ui-probe.png' });
await browser.close();
