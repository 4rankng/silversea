// E2E COMPLETE: fresh tab, real mouse clicks, full Gán xe nhóm flow + screenshots
import puppeteer from 'puppeteer';
const BASE = 'https://vantai.tingting.vip';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const a = await browser.newPage();
await a.setViewport({ width: 1440, height: 900 });
await a.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 60000 });
await a.waitForSelector('#password-input', { timeout: 30000 });
const idSel = 'input:not([type="password"]):not([type="submit"]):not([type="checkbox"])';
await a.click(idSel); await a.type(idSel, 'dungnv', { delay: 10 });
await a.click('#password-input'); await a.type('#password-input', 'Abc123', { delay: 10 });
await a.click('button[type="submit"]');
await new Promise(r => setTimeout(r, 6000));

const b = await browser.newPage();
await b.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
await b.goto(BASE + '/dispatch', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 6000));
await b.bringToFront();

async function realClick(sel, idx = 0, offset = 9) {
  await b.evaluate((s, i) => {
    const els = document.querySelectorAll(s);
    els[i]?.scrollIntoView({ block: 'center' });
  }, sel, idx);
  await new Promise(r => setTimeout(r, 400));
  const r = await b.evaluate((s, i, o) => {
    const el = document.querySelectorAll(s)[i];
    const rect = el.getBoundingClientRect();
    return { x: rect.x + o, y: rect.y + o };
  }, sel, idx, offset);
  await b.mouse.move(r.x, r.y);
  await new Promise(r2 => setTimeout(r2, 250));
  await b.mouse.click(r.x, r.y);
  await new Promise(r2 => setTimeout(r2, 900));
}

// TICK 2 LCL lots — real clicks
await realClick('.ops-lcl-check', 0);
await realClick('.ops-lcl-check', 1);
const st = await b.evaluate(() => ({
  nChecked: document.querySelectorAll('.ops-lcl-check--on').length,
  bar: document.querySelector('.lcl-selection-bar')?.innerText.replace(/\n/g, ' | ').slice(0, 180) || null,
}));
console.log('AFTER 2 TICKS:', JSON.stringify(st));
await b.screenshot({ path: '/tmp/e2e-lcl/complete-2ticked.png' });

// CLICK Gán xe nhóm — real click
if (st.bar) {
  await realClick('.lcl-selection-bar button, button', 0, 0); // placeholder not used
  const btnIdx = await b.evaluate(() => Array.from(document.querySelectorAll('button')).findIndex(x => x.innerText.includes('Gán xe nhóm')));
  if (btnIdx >= 0) await realClick('button', btnIdx, 30);
  await new Promise(r => setTimeout(r, 2500));
  const popup = await b.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return dlg ? {
      heading: (dlg.querySelector('h1,h2,h3')?.textContent || '').trim().slice(0, 60),
      hasBks: /BKS|biển số/i.test(dlg.innerText),
      snippet: dlg.innerText.replace(/\n/g, ' | ').slice(0, 250),
    } : null;
  });
  console.log('POPUP:', JSON.stringify(popup));
  await b.screenshot({ path: '/tmp/e2e-lcl/complete-popup.png' });
}
await browser.close();
console.log('DONE');
