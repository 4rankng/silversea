// Targeted verification: recoverable-costs overflow behavior + branding consistency
// + whether clipped-text findings are intentional visually-hidden labels.
import { chromium } from '@playwright/test';

const BASE = process.env.QA_BASE_URL;
const API = process.env.QA_API;
if (!BASE || !API || !process.env.QA_USER || !process.env.QA_PASS) {
  throw new Error('Set QA_BASE_URL, QA_API, QA_USER, and QA_PASS before running this verification.');
}

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.QA_USER, password: process.env.QA_PASS }),
});
if (!loginRes.ok) { throw new Error(`Login failed with status ${loginRes.status}.`); }
const { token } = await loginRes.json();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript((t) => globalThis.localStorage.setItem('token', t), token);

// 1. recoverable-costs: what scrolls, what clips?
await page.goto(BASE + '/recoverable-costs', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const rcInfo = await page.evaluate(() => {
  const doc = globalThis.document;
  const out = { brandTexts: [], overflowers: [] };
  for (const el of doc.querySelectorAll('body *')) {
    const cs = globalThis.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (rect.right > 1442 && cs.position !== 'fixed' && rect.width > 0) {
      // find nearest ancestor with overflow-x auto/scroll/hidden
      let wrap = null;
      let n = el.parentElement;
      while (n && n !== doc.body) {
        const wcs = globalThis.getComputedStyle(n);
        if (wcs.overflowX !== 'visible') { wrap = { cls: (n.className || '').toString().slice(0, 60), overflowX: wcs.overflowX, scrollW: n.scrollWidth, clientW: n.clientWidth }; break; }
        n = n.parentElement;
      }
      out.overflowers.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 60),
        right: Math.round(rect.right),
        wrap,
      });
      if (out.overflowers.length >= 8) break;
    }
  }
  const brand = doc.querySelector('[class*="brand"], [class*="logo"]');
  if (brand) out.brandTexts.push(brand.textContent?.trim().slice(0, 60));
  return out;
});
console.log(JSON.stringify(rcInfo, null, 2));

// 2. branding on each page
for (const path of ['/shipments', '/shipments-detail', '/recoverable-costs']) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const brand = await page.evaluate(() => {
    const aside = globalThis.document.querySelector('aside, [class*="sidebar"]');
    const h = aside?.querySelector('h1, h2, h3, [class*="brand"], [class*="logo"]');
    return (h?.textContent || '').trim().slice(0, 80);
  });
  console.log(`${path} sidebar brand: "${brand}"`);
}

// 3. edit-purpose labels: visually hidden by design?
await page.goto(BASE + '/shipments-detail', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const purpose = await page.evaluate(() => {
  const el = globalThis.document.querySelector('.shipment-container-ledger__edit-purpose');
  if (!el) return 'not found';
  const cs = globalThis.getComputedStyle(el);
  return {
    position: cs.position,
    clip: cs.clip,
    clipPath: cs.clipPath,
    width: cs.width,
    height: cs.height,
    overflow: cs.overflow,
    whiteSpace: cs.whiteSpace,
  };
});
console.log('edit-purpose computed style:', JSON.stringify(purpose));

await browser.close();
