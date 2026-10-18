// FB-063 (card 181026021137 "header cột wrap nhiều dòng") — header line-count
// measurement across the candidate grid surfaces. LOCAL ONLY: vite 7175 ->
// api 3002 (dev-port-contract). READ-ONLY: no clicks that mutate, no writes.
//
// For every rendered table on each surface and each header cell, counts the
// distinct text-line tops of the label's text nodes (icon rects excluded) and
// reports the columns whose header label wraps >= 2 lines, at 1440 / 1024 / 768.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb063-measure';
const MODE = process.env.MODE ?? 'before'; // 'before' | 'after' — only labels the log
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let L = null;
for (let i = 1; i <= 3 && !L?.token; i++) {
  const t = await (await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
  })).text();
  try { L = JSON.parse(t); } catch { await sleep(1200 * i); }
}
if (!L?.token) { console.log('LOGIN FAILED as admin'); process.exit(1); }
console.log(`FB-063 header-wrap measurement (${MODE}) · LOGIN OK (admin)`);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), L.token);
page.on('pageerror', (err) => console.log(`PAGEERROR: ${err.message}`));

const SURFACES = [
  { route: '/shipments', name: 'shipments-tong-quan', wait: '.cus-dashboard-table' },
  { route: '/dispatch', name: 'dispatch-master-plan', wait: 'table' },
  { route: '/dispatch-detail', name: 'dispatch-detail-plan', wait: 'table' },
  { route: '/accounting/phoi-phieu', name: 'accounting-phoi-phieu', wait: 'table' },
  { route: '/accounting/invoice-tracking', name: 'accounting-invoice-tracking', wait: 'table' },
];

// Distinct rendered text-line tops of the label's text nodes only (the sort
// icon's rects never enter the count), so "2 lines" means the LABEL wrapped.
const measure = () => {
  const lineCount = (el) => {
    const tops = new Set();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width > 0 && r.height > 0) tops.add(Math.round(r.top));
      }
    }
    return tops.size;
  };
  const out = [];
  for (const table of document.querySelectorAll('table')) {
    const rows = table.querySelectorAll('thead tr');
    if (rows.length === 0) continue;
    for (const th of table.querySelectorAll('thead th')) {
      const cs = getComputedStyle(th);
      out.push({
        table: table.className || '(no-class)',
        label: (th.textContent || '').replace(/\s+/g, ' ').trim(),
        lines: lineCount(th),
        thWidth: Math.round(th.getBoundingClientRect().width),
        whiteSpace: cs.whiteSpace,
        overflowWrap: cs.overflowWrap,
      });
    }
  }
  return out;
};

let worst = 0;
for (const s of SURFACES) {
  await page.setViewport({ width: 1440, height: 1000 });
  try {
    await page.goto(`${BASE}${s.route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector(s.wait, { timeout: 30000 });
    await sleep(1800);
  } catch (e) {
    console.log(`\n== ${s.name} (${s.route}) == NAV FAILED: ${e.message}`);
    continue;
  }
  for (const width of [1440, 1024, 768]) {
    await page.setViewport({ width, height: 1000 });
    await sleep(600);
    const rows = await page.evaluate(measure);
    const wrapped = rows.filter((r) => r.lines >= 2).sort((a, b) => b.lines - a.lines);
    worst = Math.max(worst, ...rows.map((r) => r.lines), 0);
    console.log(`\n== ${s.name} (${s.route}) @ ${width}px == headers: ${rows.length}, wrapped>=2 lines: ${wrapped.length}`);
    for (const r of wrapped) {
      console.log(`  ${r.lines} lines · ${r.thWidth}px · ws=${r.whiteSpace}/ow=${r.overflowWrap} · [${r.table}] "${r.label}"`);
    }
    if (width === 1440) {
      await page.screenshot({ path: `${SHOTS}/${MODE}-${s.name}-1440.png` });
    }
    if (width === 768) {
      await page.screenshot({ path: `${SHOTS}/${MODE}-${s.name}-768.png` });
    }
  }
}

console.log(`\nWORST header line count across all surfaces: ${worst}`);
await browser.close();
console.log('DRIVER EXIT 0');
