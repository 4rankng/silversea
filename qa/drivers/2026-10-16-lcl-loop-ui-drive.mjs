// LCL closed-loop QA — Track 2 UI drive (staging, build 2176e29e).
// Screenshots + DOM assertions for the mobile-first /shipments/new redesign
// and CSS-regression checks on Kế hoạch Tổng quát / Chi tiết lô hàng.
// Token injection via evaluateOnNewDocument (house recipe, _rung-cus-common).
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = 'https://vantai.tingting.vip';
const OUT = new URL('../1016-ui/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(identifier) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
}

const errors = [];
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});

async function drive({ user, viewport, url, shot, assertions }) {
  const token = await login(user);
  const page = await browser.newPage();
  await page.setViewport({ width: viewport.w, height: viewport.h, isMobile: viewport.w < 800, hasTouch: viewport.w < 800 });
  page.on('pageerror', (e) => errors.push(`pageerror[${shot}]: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error[${shot}]: ${m.text().slice(0, 200)}`); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(BASE + url, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  const results = {};
  for (const [name, fn] of Object.entries(assertions)) {
    try { results[name] = await page.evaluate(fn); } catch (e) { results[name] = `EVAL-ERROR: ${e.message}`; }
  }
  await page.screenshot({ path: OUT + shot, fullPage: true });
  await page.close();
  return results;
}

// ── 1. /shipments/new mobile 375 (tiepvv, CUS) ──────────────────────────────
const createMobile = await drive({
  user: 'tiepvv', viewport: { w: 375, h: 812 }, url: '/shipments/new', shot: '1016_create-mobile-375.png',
  assertions: {
    url: () => location.pathname,
    // LCL toggle present (Loại hàng: Hàng lẻ)
    lclToggle: () => !!document.body.innerText.match(/Hàng lẻ/),
    // section bands render (CONTAINER / LỘ TRÌNH / LỊCH TRÌNH)
    sections: () => ['CONTAINER', 'LỘ TRÌNH', 'LỊCH TRÌNH'].map((s) => document.body.innerText.includes(s)),
    // no horizontal overflow at 375
    hOverflow: () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    // pickers carry a chevron (lucide)
    chevrons: () => document.querySelectorAll('svg.lucide-chevron-down, [class*="chevron"]').length,
    // rose required markers exist
    requiredMarks: () => document.querySelectorAll('.text-rose-500, [class*="rose"]').length,
    // 2-col pairs: any grid container with two columns on the phone tier
    twoColGrids: () => {
      const grids = [...document.querySelectorAll('[class*="grid"], [class*="pair"]')];
      return grids.filter((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length >= 2).length;
    },
  },
});
console.log('CREATE-MOBILE', JSON.stringify(createMobile));

// ── 2. /shipments/new desktop 1440 (tiepvv) ─────────────────────────────────
const createDesktop = await drive({
  user: 'tiepvv', viewport: { w: 1440, h: 900 }, url: '/shipments/new', shot: '1016_create-desktop-1440.png',
  assertions: {
    url: () => location.pathname,
    // desktop keeps the container TABLE (spec: desktop table intact)
    containerTable: () => {
      const t = document.querySelector('table');
      return t ? { rows: t.querySelectorAll('tr').length, headers: [...t.querySelectorAll('th')].slice(0, 6).map((h) => h.textContent.trim()) } : null;
    },
    hOverflow: () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  },
});
console.log('CREATE-DESKTOP', JSON.stringify(createDesktop));

// ── 3. Kế hoạch Tổng quát 1440 + 390 (dungnv) ───────────────────────────────
const masterDesktop = await drive({
  user: 'dungnv', viewport: { w: 1440, h: 900 }, url: '/dispatch', shot: '1016_masterplan-desktop-1440.png',
  assertions: {
    url: () => location.pathname,
    rows: () => document.querySelectorAll('table tbody tr, [class*="row"]').length,
    hOverflow: () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  },
});
console.log('MASTER-DESKTOP', JSON.stringify(masterDesktop));
const masterMobile = await drive({
  user: 'dungnv', viewport: { w: 390, h: 844 }, url: '/dispatch', shot: '1016_masterplan-mobile-390.png',
  assertions: {
    hOverflow: () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  },
});
console.log('MASTER-MOBILE', JSON.stringify(masterMobile));

// ── 4. Chi tiết lô hàng 1440 + 390 (dungnv) — lot 571 (LCL fixture) ─────────
const detailDesktop = await drive({
  user: 'dungnv', viewport: { w: 1440, h: 900 }, url: '/shipments/571', shot: '1016_shipment-detail-desktop-1440.png',
  assertions: {
    url: () => location.pathname,
    hasChip: () => document.body.innerText.match(/Lô hàng lẻ/) != null,
    hOverflow: () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  },
});
console.log('DETAIL-DESKTOP', JSON.stringify(detailDesktop));
const detailMobile = await drive({
  user: 'dungnv', viewport: { w: 390, h: 844 }, url: '/shipments/571', shot: '1016_shipment-detail-mobile-390.png',
  assertions: {
    hOverflow: () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  },
});
console.log('DETAIL-MOBILE', JSON.stringify(detailMobile));

await browser.close();
console.log('PAGE-ERRORS', JSON.stringify(errors));
