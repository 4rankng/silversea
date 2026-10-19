// Visual check: /dispatch Master Plan — is the CHỌN LÔ checkbox column there?
import puppeteer from 'puppeteer';

const BASE = 'https://vantai.tingting.vip';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--window-size=1800,1200'] });
const page = await browser.newPage();
await page.setViewport({ width: 1800, height: 1200 });

// 1. Login
await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 60000 });
await page.type('input[name="identifier"], input[type="text"], #identifier', 'dungnv', { delay: 10 });
await page.type('input[type="password"]', 'Abc123', { delay: 10 });
await page.keyboard.press('Enter');
await new Promise(r => setTimeout(r, 5000));
console.log('URL after login:', page.url());

// 2. Go to /dispatch
await page.goto(BASE + '/dispatch', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 5000));
console.log('URL:', page.url());

// 3. Screenshot full table
await page.screenshot({ path: '/tmp/qa-dispatch-overview.png', fullPage: false });

// 4. DOM probe: checkbox presence
const probe = await page.evaluate(() => {
  const checkboxes = document.querySelectorAll('input[type="checkbox"]');
  const headers = Array.from(document.querySelectorAll('th')).map(h => h.innerText.trim()).filter(Boolean);
  const lclRows = Array.from(document.querySelectorAll('tr')).filter(r => /Pallet|Carton|Lẻ/i.test(r.innerText)).length;
  return {
    checkboxCount: checkboxes.length,
    headers: headers.slice(0, 12),
    lclRowCount: lclRows,
    hasChonLo: document.body.innerText.includes('Chọn lô') || document.body.innerText.includes('CHỌN LÔ'),
    hasGanXe: document.body.innerText.includes('Gán xe nhóm'),
  };
});
console.log('PROBE:', JSON.stringify(probe, null, 1));

// 5. If checkboxes exist, tick 2 LCL rows and screenshot the selection bar
if (probe.checkboxCount > 0) {
  const boxes = await page.$$('input[type="checkbox"]');
  let ticked = 0;
  for (const b of boxes) {
    if (ticked >= 2) break;
    const box = await b.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      await b.click();
      ticked++;
      await new Promise(r => setTimeout(r, 800));
    }
  }
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: '/tmp/qa-dispatch-selected.png', fullPage: false });
  const bar = await page.evaluate(() => {
    const m = document.body.innerText.match(/Đang chọn[\s\S]{0,120}/);
    return m ? m[0].replace(/\n/g, ' | ') : null;
  });
  console.log('SELECTION BAR:', bar);
}
await browser.close();
console.log('DONE');
