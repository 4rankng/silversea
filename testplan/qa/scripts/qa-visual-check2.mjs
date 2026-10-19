// Visual check: /dispatch Master Plan — CHỌN LÔ checkbox + Gán xe nhóm flow
import puppeteer from 'puppeteer';

const BASE = 'https://vantai.tingting.vip';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--window-size=1800,1200'] });
const page = await browser.newPage();
await page.setViewport({ width: 1800, height: 1200 });

// 1. Login — wait for React render
await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('#password-input', { timeout: 30000 });
const idSel = 'input:not([type="password"]):not([type="submit"]):not([type="checkbox"])';
await page.waitForSelector(idSel, { timeout: 15000 });
await page.click(idSel);
await page.type(idSel, 'dungnv', { delay: 15 });
await page.click('#password-input');
await page.type('#password-input', 'Abc123', { delay: 15 });
await page.click('button[type="submit"]');
await new Promise(r => setTimeout(r, 6000));
console.log('URL after login:', page.url());

// 2. /dispatch
await page.goto(BASE + '/dispatch', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 6000));
console.log('URL:', page.url());
await page.screenshot({ path: '/tmp/qa-dispatch-overview.png', fullPage: false });

// 3. DOM probe
const probe = await page.evaluate(() => {
  const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(b => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const headers = Array.from(document.querySelectorAll('th')).map(h => h.innerText.trim()).filter(Boolean);
  return {
    visibleCheckboxCount: checkboxes.length,
    headers: headers.slice(0, 12),
    hasChonLoText: document.body.innerText.includes('họn lô'),
    hasGanXeNhom: document.body.innerText.includes('Gán xe nhóm'),
    lclRows: Array.from(document.querySelectorAll('tr')).filter(r => /Pallet|Carton/i.test(r.innerText)).length,
  };
});
console.log('PROBE:', JSON.stringify(probe, null, 1));

// 4. Tick 2 checkboxes → screenshot selection bar
if (probe.visibleCheckboxCount > 0) {
  const boxes = await page.$$('input[type="checkbox"]');
  let ticked = 0;
  for (const b of boxes) {
    if (ticked >= 2) break;
    const box = await b.boundingBox();
    if (box && box.width > 0) {
      await b.click(); ticked++;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: '/tmp/qa-dispatch-selected.png', fullPage: false });
  const bar = await page.evaluate(() => {
    const m = document.body.innerText.match(/Đang chọn[\s\S]{0,150}/);
    return m ? m[0].replace(/\n/g, ' | ') : null;
  });
  console.log('SELECTION BAR:', bar);
  // 5. Click Gán xe nhóm → screenshot popup
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const t = btns.find(b => b.innerText.trim() === 'Gán xe nhóm');
    if (t) { t.click(); return true; }
    return false;
  });
  console.log('clicked Gan xe nhom:', clicked);
  await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: '/tmp/qa-dispatch-popup.png', fullPage: false });
} else {
  console.log('NO CHECKBOXES VISIBLE - feature missing on this build');
}
await browser.close();
console.log('DONE');
