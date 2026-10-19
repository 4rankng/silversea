// Decisive probe: exact DOM at /dispatch
import puppeteer from 'puppeteer';

const BASE = 'https://vantai.tingting.vip';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1800, height: 1200 });

const loadedChunks = [];
page.on('response', r => { if (r.url().includes('assets/') && r.url().endsWith('.js')) loadedChunks.push(r.url().split('/').pop()); });

await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('#password-input', { timeout: 30000 });
const idSel = 'input:not([type="password"]):not([type="submit"]):not([type="checkbox"])';
await page.click(idSel);
await page.type(idSel, 'dungnv', { delay: 15 });
await page.click('#password-input');
await page.type('#password-input', 'Abc123', { delay: 15 });
await page.click('button[type="submit"]');
await new Promise(r => setTimeout(r, 6000));

await page.goto(BASE + '/dispatch', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 7000));

const out = await page.evaluate(() => {
  const thead = document.querySelector('thead');
  const firstRow = document.querySelector('tbody tr');
  const gridEl = document.querySelector('.master-plan-grid');
  return {
    url: location.href,
    theadHTML: thead ? thead.innerHTML.slice(0, 600) : null,
    firstRowFirstCell: firstRow ? firstRow.cells[0].outerHTML.slice(0, 300) : null,
    gridClass: gridEl ? gridEl.className : 'NO .master-plan-grid ELEMENT',
    checkboxes: document.querySelectorAll('input[type=checkbox]').length,
    cellSelectCount: document.querySelectorAll('.master-plan-grid__cell--select').length,
  };
});
console.log('URL:', out.url);
console.log('gridClass:', out.gridClass);
console.log('cellSelectCount:', out.cellSelectCount, '| checkboxes:', out.checkboxes);
console.log('theadHTML:', out.theadHTML);
console.log('firstRowFirstCell:', out.firstRowFirstCell);
console.log('CHUNKS LOADED:', JSON.stringify(loadedChunks));
await browser.close();
