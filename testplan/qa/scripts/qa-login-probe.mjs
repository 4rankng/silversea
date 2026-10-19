import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('https://vantai.tingting.vip/login', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 3000));
const inputs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('input, button')).map(e => ({
    tag: e.tagName, type: e.type, name: e.name, id: e.id, ph: e.placeholder, text: e.innerText?.slice(0, 20)
  })));
console.log(JSON.stringify(inputs, null, 1));
await page.screenshot({ path: '/tmp/qa-login.png' });
await browser.close();
