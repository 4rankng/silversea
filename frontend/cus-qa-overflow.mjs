// DOM-level clipped-content detector for CUS pages.
// Finds elements whose content overflows without ellipsis handling (real truncation bugs),
// and interactive elements smaller than 44px touch targets at mobile.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.QA_BASE_URL;
const API = process.env.QA_API;
if (!BASE || !API || !process.env.QA_USER || !process.env.QA_PASS) {
  throw new Error('Set QA_BASE_URL, QA_API, QA_USER, and QA_PASS before running this audit.');
}
const OUT = resolve('..', 'qa', '2026-08-16_cus-qa');
mkdirSync(OUT, { recursive: true });

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.QA_USER, password: process.env.QA_PASS }),
});
if (!loginRes.ok) { console.error('LOGIN FAILED'); process.exit(2); }
const { token } = await loginRes.json();

const browser = await chromium.launch();
const findings = [];

for (const viewport of [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
]) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.label === 'mobile',
    hasTouch: viewport.label === 'mobile',
  });
  const page = await ctx.newPage();
  await page.addInitScript((t) => globalThis.localStorage.setItem('token', t), token);

  for (const path of ['/shipments', '/shipments-detail', '/recoverable-costs']) {
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(600);

    const isMobile = viewport.label === 'mobile';
    const issues = await page.evaluate((mobile) => {
      const out = [];
      const doc = globalThis.document;
      const els = doc.querySelectorAll('body *');
      for (const el of els) {
        const cs = globalThis.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        // 1. text content clipped horizontally without ellipsis/clip-wrapping
        const textOnly = [...el.childNodes].every((n) => n.nodeType === 3) && el.textContent.trim();
        if (textOnly && el.scrollWidth > el.clientWidth + 2) {
          if (cs.textOverflow !== 'ellipsis') {
            out.push({
              kind: 'clipped-text',
              text: el.textContent.trim().slice(0, 60),
              scrollW: el.scrollWidth,
              clientW: el.clientWidth,
              cls: (el.className || '').toString().slice(0, 80),
            });
          }
        }

        // 2. extends past the document's right edge (real horizontal overflow)
        if (rect.right > doc.documentElement.clientWidth + 2 && cs.position !== 'fixed') {
          out.push({
            kind: 'past-right-edge',
            tag: el.tagName.toLowerCase(),
            right: Math.round(rect.right),
            cls: (el.className || '').toString().slice(0, 80),
            text: el.textContent?.trim().slice(0, 40),
          });
        }

        // 3. mobile: interactive elements below 32px min dimension
        if (mobile) {
          const interactive = el.matches('button, a, [role="button"], input, select, summary');
          if (interactive && (rect.height < 32 || rect.width < 32)) {
            out.push({
              kind: 'tiny-touch-target',
              tag: el.tagName.toLowerCase(),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
              text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
            });
          }
        }
      }
      return out.slice(0, 60);
    }, isMobile).catch((e) => [{ kind: 'eval-error', text: String(e).slice(0, 150) }]);

    for (const issue of issues) findings.push({ viewport: viewport.label, page: path, ...issue });
    console.log(`[${viewport.label}] ${path}: ${issues.length} findings`);
  }
  await ctx.close();
}

writeFileSync(resolve(OUT, 'dom-audit.json'), JSON.stringify(findings, null, 2));
console.log(`total: ${findings.length}`);
await browser.close();
