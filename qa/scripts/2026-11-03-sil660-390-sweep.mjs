import puppeteer from 'puppeteer';
import fs from 'node:fs';
const FRONT = 'http://localhost:7190';
const API = 'http://localhost:3012/api';
const OUT = 'qa/2026-11-03_sil660';
const log = [];
const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) });
const { token } = await loginRes.json();
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => localStorage.setItem('token', t), token);
await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.querySelector('input[name="cargo-mode"]'), { timeout: 30000 });
await page.evaluate(() => Array.from(document.querySelectorAll('input[name="cargo-mode"]')).find((r) => r.value === 'LCL').click());
await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-pickup-warehouse"]'), { timeout: 10000 });
const check = await page.evaluate(() => {
  const wrap = document.querySelector('[data-field-id="shipment-lcl-declaration-number"]');
  const rect = wrap?.getBoundingClientRect();
  const input = wrap?.querySelector('input');
  return {
    viewport: document.documentElement.clientWidth,
    fieldX: Math.round(rect?.x ?? -1),
    fieldW: Math.round(rect?.width ?? 0),
    fieldVisible: rect ? rect.x >= 0 && rect.right <= document.documentElement.clientWidth + 1 : false,
    docNoHScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  };
});
log.push(`390 CREATE: ${JSON.stringify(check)}`);
fs.writeFileSync(`${OUT}/sil660-390-create.png`, await page.screenshot({ type: 'png' }));
// View mode of the latest LCL lot at 390.
await page.goto(`${FRONT}/shipments/999`, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-lcl-declaration-number"] input'), { timeout: 20000 });
const view = await page.evaluate(() => {
  const input = document.querySelector('[data-field-id="shipment-lcl-declaration-number"] input');
  const rect = input.getBoundingClientRect();
  return { value: input.value, disabled: input.disabled, x: Math.round(rect.x), w: Math.round(rect.width), visible: rect.x >= 0 && rect.right <= document.documentElement.clientWidth + 1 };
});
log.push(`390 VIEW lot 999: ${JSON.stringify(view)}`);
fs.writeFileSync(`${OUT}/sil660-390-view.png`, await page.screenshot({ type: 'png' }));
await browser.close();
console.log(log.join('\n'));
