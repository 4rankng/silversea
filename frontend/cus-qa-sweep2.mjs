// CUS QA sweep v2 — explicit CUS routes + full link crawl + text-based probes.
// Env: QA_BASE_URL, QA_API, QA_USER, QA_PASS. Screenshots → ../qa/2026-08-16_cus-qa/screens/
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.QA_BASE_URL;
const API = process.env.QA_API;
if (!BASE || !API || !process.env.QA_USER || !process.env.QA_PASS) {
  throw new Error('Set QA_BASE_URL, QA_API, QA_USER, and QA_PASS before running the CUS QA sweep.');
}
const OUT = resolve('..', 'qa', '2026-08-16_cus-qa');
const SCREENS = resolve(OUT, 'screens');
mkdirSync(SCREENS, { recursive: true });

const signals = [];
const log = (m) => { console.log(m); appendFileSync(resolve(OUT, 'sweep2.log'), m + '\n'); };
const record = (entry) => { signals.push({ time: new Date().toISOString(), ...entry }); };

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.QA_USER, password: process.env.QA_PASS }),
});
if (!loginRes.ok) { console.error('LOGIN FAILED', loginRes.status); process.exit(2); }
const { token } = await loginRes.json();
log('login ok');

const browser = await chromium.launch();
const ROUTES = [
  { name: 'shipments', path: '/shipments' },
  { name: 'shipments-detail', path: '/shipments-detail' },
  { name: 'recoverable-costs', path: '/recoverable-costs' },
];

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

  page.on('console', (msg) => {
    if (msg.type() === 'error') record({ kind: 'console.error', viewport: viewport.label, text: msg.text().slice(0, 400) });
  });
  page.on('pageerror', (err) => record({ kind: 'pageerror', viewport: viewport.label, text: String(err).slice(0, 400) }));
  page.on('response', (res) => {
    if (res.url().includes('/api') && res.status() >= 400) {
      record({ kind: 'http', viewport: viewport.label, status: res.status(), url: res.url().slice(0, 250) });
    }
  });

  // every explicit route
  const visited = new Set();
  for (const route of ROUTES) {
    try {
      await page.goto(BASE + route.path, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(SCREENS, `${viewport.label}-${route.name}.png`), fullPage: true });
      log(`[${viewport.label}] ${route.path} → ${page.url()}`);

      // collect ALL in-app links on this page for the crawl
      if (route.name === 'shipments') {
        const hrefs = await page.$$eval('a[href]', (els) =>
          [...new Set(els.map((e) => e.getAttribute('href')).filter((h) => h && h.startsWith('/') && !h.startsWith('//')))],
        );
        log(`[${viewport.label}] links found: ${hrefs.join(' ')}`);
        for (const href of hrefs) {
          if (visited.has(href)) continue;
          visited.add(href);
          try {
            await page.goto(BASE + href, { waitUntil: 'networkidle', timeout: 15000 });
            await page.waitForTimeout(400);
            const slug = href.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40);
            await page.screenshot({ path: resolve(SCREENS, `${viewport.label}-crawl-${slug}.png`), fullPage: true });
            log(`[${viewport.label}] crawl ${href} → ${page.url()}`);
          } catch (e) {
            record({ kind: 'nav', viewport: viewport.label, text: `failed ${href}: ${String(e).slice(0, 150)}` });
          }
        }
      }
    } catch (e) {
      record({ kind: 'nav', viewport: viewport.label, text: `route ${route.path} failed: ${String(e).slice(0, 150)}` });
    }
  }

  // horizontal overflow check on each core route
  for (const route of ROUTES) {
    await page.goto(BASE + route.path, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth);
    if (overflow > 2) record({ kind: 'overflow', viewport: viewport.label, page: route.path, px: overflow });
    log(`[${viewport.label}] ${route.path} overflow=${overflow}px`);
  }

  await ctx.close();
}

writeFileSync(resolve(OUT, 'errors.json'), JSON.stringify(signals, null, 2));
log(`done. ${signals.length} signals`);
await browser.close();
