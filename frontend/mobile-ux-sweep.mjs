// Mobile-UX sweep: scans every reachable route at every mobile/tablet width and
// reports layout defects per the house design book (docs/design-guidelines.md):
//   hscroll      — document scrolls horizontally (§5 horizontal-scroll ban)
//   offscreen    — visible element overflows the viewport with no scrollable ancestor
//   clipped      — text content clipped by overflow:hidden with no wrap/ellipsis (§4 no-truncation)
//   small-target — interactive element under the 44px touch floor (§5 / control-density contract)
//   tiny-text    — rendered text under the 11px label floor (§5)
//   pageerror    — uncaught exception on the page
//
// Usage:  node mobile-ux-sweep.mjs            (local dev, admin+driver+cus)
//         QA_BASE_URL=… QA_API=… node mobile-ux-sweep.mjs
// Output: ../qa/<date>_mobile-ux-sweep/findings.json + console summary.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.QA_BASE_URL || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const PASS = process.env.QA_PASS || 'Abc123';
const OUT = resolve('..', 'qa', `${new Date().toISOString().slice(0, 10)}_mobile-ux-sweep`);
mkdirSync(OUT, { recursive: true });

const CONFIG_ROUTES = [
  '/config/business-calendar', '/config/cap-table', '/config/cargo-types',
  '/config/container-types', '/config/customers', '/config/debit-note-templates',
  '/config/expense-categories', '/config/forwarder-expense-types', '/config/fuel',
  '/config/management-fees', '/config/penalty-reasons', '/config/ports',
  '/config/pricing-tables', '/config/quotations', '/config/road-allowances',
  '/config/routes', '/config/salary-periods', '/config/trailers',
  '/config/trip-expense', '/config/trucks', '/config',
];
const ADMIN_ROUTES = [
  '/dashboard', '/shipments', '/shipments-debit', '/dispatch', '/dispatch-detail',
  '/trips', '/trips/new', '/expenses', '/expenses/new', '/debt', '/payables',
  '/profit', '/finance', '/accounting', '/salary', '/penalties', '/advances',
  '/audit-logs', '/customers', '/suppliers', '/fleet', '/fleet/drivers',
  '/fleet/vehicles', '/ops/orders', '/ops/wallet', '/ops/fleet-tracking',
  '/users', '/admin-center', '/admin/advance-settlements', '/recoverable-costs',
  ...CONFIG_ROUTES,
];
const DRIVER_ROUTES = [
  '/my-trips', '/my-trips/two-orders', '/my-advances', '/my-settlements',
  '/my-settlements/new', '/my-earnings', '/my-penalties', '/my-payslips',
  '/my-forwarder-trips',
];
const CUS_ROUTES = ['/my-orders', '/dashboard', '/shipments', '/recoverable-costs'];

// 360 = small Android · 390/414/430 = iPhone classes · 600 = phablet ·
// 768/820 = tablet portrait · 1024 = tablet landscape · 1440 = desktop control.
const WIDTHS = [360, 390, 414, 430, 600, 768, 820, 1024, 1440];

const SCANS = [
  { user: 'admin', routes: ADMIN_ROUTES },
  { user: 'laixe', routes: DRIVER_ROUTES },
  { user: 'cus', routes: CUS_ROUTES },
];

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASS }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
}

const auditPage = () => {
  const vw = document.documentElement.clientWidth;
  const samples = { hscroll: [], offscreen: [], clipped: [], small: [], tiny: [], error: [] };
  const counts = { hscroll: 0, offscreen: 0, clipped: 0, small: 0, tiny: 0, error: 0 };

  const path = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 4).join('.') : '';
    if (cls) s += `.${cls}`;
    return s;
  };
  const style = (el) => getComputedStyle(el);
  const shown = (el) => {
    const cs = style(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const inScroller = (el) => {
    let p = el.parentElement;
    while (p && p !== document.documentElement) {
      const cs = style(p);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
      p = p.parentElement;
    }
    return false;
  };
  const inViewport = (r) => r.right > 0 && r.left < vw && r.bottom > 0 && r.top < window.innerHeight;
  const add = (kind, sel, detail) => {
    counts[kind] += 1;
    if (samples[kind].length < 8) samples[kind].push({ sel, detail });
  };

  const doc = document.documentElement;
  if (doc.scrollWidth > vw + 1) {
    counts.hscroll = 1;
    const offenders = [...doc.querySelectorAll('body *')]
      .filter(shown)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.right > vw + 1 && !inScroller({ parentElement: el.parentElement }))
      .sort((a, b) => b.r.right - a.r.right)
      .slice(0, 6);
    samples.hscroll = offenders.map(({ el, r }) => ({ sel: path(el), detail: `right=${Math.round(r.right)} vw=${vw}` }));
  }

  for (const el of doc.querySelectorAll('body *')) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = style(el);

    // offscreen: pokes past the right edge (or starts left of 0) with no scrollable ancestor
    if (!inScroller(el) && inViewport(r) && (r.right > vw + 1 || r.left < -1)) {
      add('offscreen', path(el), `l=${Math.round(r.left)} r=${Math.round(r.right)} vw=${vw}`);
    }

    // clipped: own content wider than the box, hard-clipped, no ellipsis
    const ox = cs.overflowX;
    if ((ox === 'hidden' || ox === 'clip') && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (hasText && cs.textOverflow !== 'ellipsis') {
        add('clipped', path(el), `scrollW=${el.scrollWidth} clientW=${el.clientWidth}`);
      }
    }

    // touch floor: interactive elements under 44px (mobile/tablet widths only, caller filters)
    if (
      el.matches('a[href], button, [role="button"], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])') &&
      inViewport(r) &&
      (r.width < 44 || r.height < 44) &&
      !el.closest('[aria-hidden="true"]')
    ) {
      add('small', path(el), `${Math.round(r.width)}x${Math.round(r.height)}`);
    }

    // text floor: leaf text nodes under 11px
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasOwnText) {
      const fs = parseFloat(cs.fontSize);
      if (fs < 11) add('tiny', path(el), `${fs}px`);
    }
  }

  return { vw, coarse: matchMedia('(pointer: coarse)').matches, counts, samples };
};

const findings = [];
const errors = [];

const browser = await chromium.launch();
for (const scan of SCANS) {
  const token = await login(scan.user);
  for (const width of WIDTHS) {
    const touch = width <= 1024;
    const ctx = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: touch,
      hasTouch: touch,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.addInitScript((t) => globalThis.localStorage.setItem('token', t), token);
    page.on('pageerror', (e) => errors.push({ user: scan.user, width, err: String(e).slice(0, 300) }));

    for (const route of scan.routes) {
      try {
        await page.goto(BASE + route, { waitUntil: 'load', timeout: 20000 });
        await page.waitForTimeout(500);
        const result = await page.evaluate(auditPage);
        const bad = Object.entries(result.counts).some(([, n]) => n > 0);
        if (bad) findings.push({ user: scan.user, route, width, coarse: result.coarse, ...result });
        const bits = Object.entries(result.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(' ');
        console.log(`[${scan.user} ${width}] ${route} ${bits || 'ok'}`);
      } catch (e) {
        console.log(`[${scan.user} ${width}] ${route} LOAD-FAIL ${String(e).slice(0, 120)}`);
        errors.push({ user: scan.user, width, route, err: String(e).slice(0, 300) });
      }
    }
    await ctx.close();
  }
}
await browser.close();

writeFileSync(resolve(OUT, 'findings.json'), JSON.stringify({ findings, errors }, null, 2));

// ---- summary ----
const byKind = {};
const byWidth = {};
const byRoute = {};
for (const f of findings) {
  for (const [kind, n] of Object.entries(f.counts)) {
    if (!n) continue;
    byKind[kind] = (byKind[kind] || 0) + n;
    byWidth[f.width] = byWidth[f.width] || {};
    byWidth[f.width][kind] = (byWidth[f.width][kind] || 0) + n;
    const key = `${f.route} @${f.width}`;
    byRoute[key] = byRoute[key] || {};
    byRoute[key][kind] = (byRoute[key][kind] || 0) + n;
  }
}
const topRoutes = Object.entries(byRoute)
  .map(([k, v]) => [k, Object.values(v).reduce((a, b) => a + b, 0)])
  .sort((a, b) => b[1] - a[1])
  .slice(0, 25);
console.log('\n=== SWEEP SUMMARY ===');
console.log('by kind:', JSON.stringify(byKind));
console.log('by width:', JSON.stringify(byWidth));
console.log('top route/width pairs:');
for (const [k, n] of topRoutes) console.log(`  ${n}\t${k}`);
console.log(`pageerrors: ${errors.length}`);
console.log(`output: ${resolve(OUT, 'findings.json')}`);
