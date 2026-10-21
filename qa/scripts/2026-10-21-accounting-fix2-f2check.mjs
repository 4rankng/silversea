// Review F2 verification — refund field renders single-chrome after dropping
// the wrapper className. LOCAL only. node qa/scripts/2026-10-21-accounting-fix2-f2check.mjs
import puppeteer from 'puppeteer';
import path from 'node:path';

const FE = 'http://localhost:7185';
const API = 'http://localhost:3012/api';
const OUT = path.resolve('qa/2026-10-21-accounting-fix2');
const res = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'giaonhan', password: 'Abc123' }),
});
const token = (await res.json()).token;
const browser = await puppeteer.launch({ headless: 'new' });
const context = await browser.createBrowserContext();
const page = await context.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${FE}/my-settlements/new`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await new Promise((r) => setTimeout(r, 3500));
const info = await page.evaluate(() => {
  const labels = Array.from(document.querySelectorAll('label'));
  const label = labels.find((l) => (l.textContent ?? '').trim() === 'Tiền hoàn lại');
  if (!label) return { found: false, why: 'label' };
  // The field's own label (fset-input-label) sits beside the ds-field wrapper.
  const group = label.closest('.fset-input-group') ?? label.parentElement;
  const input = group?.querySelector('input');
  if (!input) return { found: false, why: 'input' };
  const fieldWrap = input.closest('.ds-field');
  const outer = fieldWrap?.parentElement;
  return {
    found: true,
    inputType: input.getAttribute('type'),
    wrapClass: fieldWrap?.className,
    outerClass: outer?.className,
    doubleChrome: Boolean(outer?.classList.contains('fset-input')),
    outerHasBorder: getComputedStyle(outer).borderTopWidth !== '0px',
  };
});
console.log(JSON.stringify(info));
await page.screenshot({ path: `${OUT}/02-f2-refund-field-1440.png`, fullPage: false });
await browser.close();
process.exit(info.found && !info.doubleChrome && info.inputType === 'text' ? 0 : 1);
