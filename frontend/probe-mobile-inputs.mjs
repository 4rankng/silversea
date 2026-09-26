// One-shot probe: dump geometry/visibility of the sweep-flagged inputs.
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const PASS = 'Abc123';

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASS }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
}

const browser = await chromium.launch();
const jobs = [
  { user: 'laixe', route: '/my-penalties', sel: '#penalty-month-filter' },
  { user: 'cus', route: '/my-orders', sel: 'input#cus-filter-date-from, input[class*="react-aria"]' },
  { user: 'admin', route: '/recoverable-costs', sel: 'small' },
];
for (const job of jobs) {
  const token = await login(job.user);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript((t) => globalThis.localStorage.setItem('token', t), token);
  await page.goto(BASE + job.route, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const info = await page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)];
    return els.slice(0, 4).map((el) => {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      const parent = el.parentElement; const pcs = getComputedStyle(parent); const pr = parent.getBoundingClientRect();
      return {
        tag: el.tagName, id: el.id, cls: el.className.toString().slice(0, 120),
        rect: `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.x)},${Math.round(r.y)}`,
        vis: { op: cs.opacity, vis: cs.visibility, disp: cs.display, pos: cs.position, pe: cs.pointerEvents, fs: cs.fontSize, minH: cs.minHeight, h: cs.height },
        parent: { tag: parent.tagName, cls: parent.className.toString().slice(0, 80), rect: `${Math.round(pr.width)}x${Math.round(pr.height)}`, pos: pcs.position, minH: pcs.minHeight, h: pcs.height, disp: pcs.display },
        html: el.outerHTML.slice(0, 160),
      };
    });
  }, job.sel);
  console.log(`\n=== ${job.user} ${job.route} :: ${job.sel} ===`);
  for (const i of info) console.log(JSON.stringify(i, null, 1));
  await page.screenshot({ path: `/tmp/probe-${job.route.replace(/\//g, '_')}.png`, fullPage: false });
  await ctx.close();
}
await browser.close();
