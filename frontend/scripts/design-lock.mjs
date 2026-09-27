// design-lock — machine-checked promises about how an APPROVED screen renders.
//
// Why a browser runner and not a unit test: the failure this guards against is
// a *rendered* regression that leaves every source-level assertion green — a
// later session adds a wider or more specific rule (the 2026-09-27 card-band
// `nowrap` bug), renames a class, or changes markup, and the approved layout
// silently changes while `pnpm test` passes. A measured promise survives all of
// that, because it asks the browser for the value that actually won.
//
// Usage:  cd frontend && pnpm design:lock [--only <id-substring>]
//         cd frontend && node scripts/design-lock.mjs --probe <role> <path> <width>
// Output: qa/design-lock/report.json + failing screenshots (gitignored)

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FE_ROOT = resolve(HERE, '..');
const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const OUT = resolve(FE_ROOT, process.env.OUT || '../qa/design-lock');
const PASS = process.env.QA_PASS || 'Abc123';
// A 768/1024 tablet is a touch device: `pointer: coarse` media queries (44px
// floors, tablet bands) key off this, so those widths must be captured in a
// touch context or the locks measure the wrong product.
const TOUCH_MAX = Number(process.env.TOUCH_MAX || 1024);
const ROLE_USER = { cus: 'cus', chungtu: 'cus', dieuvan: 'dieuvan', laixe: 'laixe', ops: 'giaonhan' };

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const probeIdx = args.indexOf('--probe');

/** Runs in the page: evaluates one lock, returns { pass, actual, detail }. */
function evaluateLock(lock) {
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const all = (sel) => [...document.querySelectorAll(sel)].filter(vis);
  const first = (sel) => all(sel)[0] || null;
  const desc = (el) => (el
    ? `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 2).join('.')}`
      + ` "${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`
    : '(none)');
  const tol = lock.tol ?? 2;
  const num = (v) => Math.round(v * 10) / 10;

  switch (lock.kind) {
    case 'noPageOverflow': {
      const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      return { pass: over <= (lock.max ?? 1), actual: `overflow ${over}px` };
    }
    case 'noClippedText': {
      const hits = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length > 0) continue;
        const text = (el.textContent || '').trim();
        if (!text || !vis(el) || el.clientWidth <= 2) continue;
        if (el.closest('.sr-only, [aria-live]')) continue;
        if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
          const s = getComputedStyle(el);
          if (s.overflowX === 'hidden' || s.textOverflow === 'ellipsis') {
            hits.push({ el: `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/)[0]}`, text: text.slice(0, 28), scrollW: el.scrollWidth, clientW: el.clientWidth });
          }
        }
      }
      return { pass: hits.length <= (lock.max ?? 0), actual: `${hits.length} clipped`, detail: hits.slice(0, 6) };
    }
    case 'tapFloor': {
      const min = lock.min ?? 44;
      const hits = [];
      for (const el of document.querySelectorAll('a[href], button, [role=button], input:not([type=hidden]), select, textarea')) {
        if (!vis(el) || el.closest('[aria-hidden="true"]')) continue;
        // A digit segment in a segmented date/time field is not its own target
        // — the GROUP is (it click-opens the picker) and each box is
        // em-measured to its glyphs at 12px so `DD` never shaves into an
        // E-like sliver. Pin the group with minWidth/minHeight instead.
        if (el.classList.contains('date-seg')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < min - 0.5 || r.height < min - 0.5) hits.push({ el: desc(el), w: num(r.width), h: num(r.height) });
      }
      return { pass: hits.length <= (lock.max ?? 0), actual: `${hits.length} under ${min}px`, detail: hits.slice(0, 6) };
    }
    case 'minFont': {
      const min = lock.min ?? 11;
      const hits = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length > 0 || !vis(el) || !(el.textContent || '').trim()) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs > 0 && fs < min - 0.01) hits.push({ el: desc(el), fs: num(fs) });
      }
      return { pass: hits.length <= (lock.max ?? 0), actual: `${hits.length} under ${min}px`, detail: hits.slice(0, 6) };
    }
    case 'maxHeight':
    case 'minHeight': {
      const el = first(lock.selector);
      if (!el) return { pass: false, actual: 'selector matched nothing' };
      const h = el.getBoundingClientRect().height;
      const limit = lock.kind === 'maxHeight' ? lock.max : lock.min;
      const pass = lock.kind === 'maxHeight' ? h <= limit + tol : h >= limit - tol;
      return { pass, actual: `${num(h)}px (${lock.kind} ${limit}px)`, detail: desc(el) };
    }
    case 'maxWidth':
    case 'minWidth': {
      const el = first(lock.selector);
      if (!el) return { pass: false, actual: 'selector matched nothing' };
      const w = el.getBoundingClientRect().width;
      const limit = lock.kind === 'maxWidth' ? lock.max : lock.min;
      const pass = lock.kind === 'maxWidth' ? w <= limit + tol : w >= limit - tol;
      return { pass, actual: `${num(w)}px (${lock.kind} ${limit}px)`, detail: desc(el) };
    }
    case 'maxTop': {
      // Chrome budget: how far down the viewport the first record starts.
      // Height is the vertical space the header, filters and tabs steal from
      // the list, so this is the lock that keeps a filter block from growing
      // back into a screenful.
      const el = first(lock.selector);
      if (!el) return { pass: false, actual: 'selector matched nothing' };
      const top = el.getBoundingClientRect().top;
      return { pass: top <= lock.max + tol, actual: `first record at ${num(top)}px (max ${lock.max})`, detail: desc(el) };
    }
    case 'count': {
      const n = all(lock.selector).length;
      return { pass: n <= (lock.max ?? 0), actual: `${n} matches (max ${lock.max ?? 0})`, detail: all(lock.selector).slice(0, 4).map(desc) };
    }
    case 'visible':
      return { pass: all(lock.selector).length > 0, actual: `${all(lock.selector).length} visible` };
    case 'hidden':
      return { pass: all(lock.selector).length === 0, actual: `${all(lock.selector).length} visible` };
    case 'inline': {
      const a = first(lock.selector);
      const b = first(lock.other);
      if (!a || !b) return { pass: false, actual: `missing ${a ? 'other' : 'selector'}` };
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const same = Math.abs(ra.top - rb.top) <= (lock.tol ?? 6);
      return { pass: same, actual: `top ${num(ra.top)} vs ${num(rb.top)}`, detail: `${desc(a)} | ${desc(b)}` };
    }
    case 'rows': {
      const els = all(lock.selector);
      if (!els.length) return { pass: false, actual: 'selector matched nothing' };
      const tops = [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().top / 4) * 4))].sort((x, y) => x - y);
      return { pass: tops.length === lock.n, actual: `${tops.length} visual rows (want ${lock.n})`, detail: els.slice(0, 6).map(desc) };
    }
    case 'computed': {
      const el = first(lock.selector);
      if (!el) return { pass: false, actual: 'selector matched nothing' };
      const got = getComputedStyle(el).getPropertyValue(lock.prop).trim();
      const pass = Array.isArray(lock.equals) ? lock.equals.includes(got) : got === lock.equals;
      return { pass, actual: `${lock.prop}: ${got} (want ${lock.equals})`, detail: desc(el) };
    }
    case 'unscrolled': {
      const el = first(lock.selector);
      if (!el) return { pass: false, actual: 'selector matched nothing' };
      const over = el.scrollWidth - el.clientWidth;
      return { pass: over <= (lock.max ?? 1), actual: `inner overflow ${over}px` };
    }
    default:
      return { pass: false, actual: `unknown kind ${lock.kind}` };
  }
}

/** Runs in the page: geometry of the surfaces a `--probe` caller is locking. */
function probeGeometry() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const box = (sel) => {
    const el = [...document.querySelectorAll(sel)].find(vis);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { sel, h: Math.round(r.height), w: Math.round(r.width), top: Math.round(r.top), text: (el.textContent || '').trim().slice(0, 30) };
  };
  const containers = [...new Set([...document.querySelectorAll('main [class*="card"], main [class*="row"], main tbody tr, main [class*="grid__rule"]')]
    .filter(vis)
    .map((el) => el.className.toString().trim().split(/\s+/)[0]))].slice(0, 14);
  return {
    url: location.pathname + location.search,
    docHeight: document.documentElement.scrollHeight,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    surfaces: containers.map((c) => box(`.${CSS.escape(c)}`)).filter(Boolean),
    metrics: {
      'grid rows': [...document.querySelectorAll('main tbody tr, main [class*="grid__rule"]')].filter(vis).length,
      'visible labels': [...document.querySelectorAll('main [data-label], main [data-label-short]')].filter(vis).length,
      'uppercase labels': [...document.querySelectorAll('main [data-label]')].filter(vis).length,
    },
  };
}

async function login(page, username) {
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function contextFor(browser, width) {
  if (width > TOUCH_MAX) {
    return browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  }
  return browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
}

/** Load every design-lock/expectations/*.mjs module. */
async function loadLocks() {
  const dir = resolve(FE_ROOT, 'design-lock/expectations');
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
  } catch {
    return { locks: [], files: [] };
  }
  const locks = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(resolve(dir, file)).href);
    const rows = mod.default || mod.locks || [];
    for (const row of rows) locks.push({ ...row, source: file });
  }
  return { locks, files };
}

const browser = await chromium.launch({ args: ['--font-render-hinting=none'] });

// --- probe mode: measure a surface so a human can write the lock ------------
if (probeIdx !== -1) {
  const [, role, path, width] = [null, args[probeIdx + 1], args[probeIdx + 2], Number(args[probeIdx + 3])];
  const ctx = await contextFor(browser, width);
  const page = await ctx.newPage();
  await login(page, ROLE_USER[role] || role);
  await page.goto(`${FE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const geo = await page.evaluate(probeGeometry);
  console.log(JSON.stringify({ role, path, width, ...geo }, null, 2));
  await browser.close();
  process.exit(0);
}

// --- lock mode -------------------------------------------------------------
const { locks: allLocks, files } = await loadLocks();
const locks = only ? allLocks.filter((l) => l.id.includes(only)) : allLocks;
mkdirSync(OUT, { recursive: true });

if (!locks.length) {
  console.log(`design-lock: no locks${only ? ` matching "${only}"` : ''} in design-lock/expectations/ (${files.length} module(s)).`);
  await browser.close();
  process.exit(0);
}

// One browser context per (role, width): a fresh context per lock would
// re-login ~60 times and dominate the run time.
const contexts = new Map();
const getCtx = async (role, width) => {
  const key = `${role}@${width}`;
  if (contexts.has(key)) return contexts.get(key);
  const ctx = await contextFor(browser, width);
  const page = await ctx.newPage();
  await login(page, ROLE_USER[role] || role);
  const entry = { ctx, page, width, path: null };
  contexts.set(key, entry);
  return entry;
};

const results = [];
let failed = 0;
for (const lock of locks) {
  const entry = await getCtx(lock.role, lock.width);
  const { page } = entry;
  // The path must be tracked per context: two widths are two pages (two
  // logins, two clients), and a global cursor left the tablet/desktop locks
  // measuring whatever the phone context had navigated to last.
  if (entry.path !== lock.path) {
    await page.goto(`${FE}${lock.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    entry.path = lock.path;
    entry.opened = null;
    entry.clicked = null;
  }
  // `open: 'drawer'` measures a surface that only exists when the filter
  // drawer is on screen. Toggled per path, and closed again when the next
  // lock wants the collapsed state.
  if (lock.open !== entry.opened) {
    const drawer = page.locator('button', { hasText: /^Bộ lọc/ }).first();
    const isOpen = await page.locator('[role="dialog"], .drawer').filter({ has: page.locator('.detailed-plan-filter-panel, .master-plan-filter-panel') }).count().catch(() => 0);
    if (lock.open === 'drawer' && !isOpen) { await drawer.click().catch(() => {}); await page.waitForTimeout(600); }
    if (!lock.open && isOpen) { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(400); }
    entry.opened = lock.open ?? null;
  }
  // `click` presets the surface into the state a lock describes (e.g. an
  // applied preset segment cell) the way a user reaches it.
  if (lock.click && entry.clicked !== lock.click) {
    await page.locator(lock.click).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    entry.clicked = lock.click;
  }
  const res = await page.evaluate(evaluateLock, lock);
  const row = { ...lock, ...res };
  results.push(row);
  if (res.pass) {
    console.log(`  ok   ${lock.id} — ${res.actual}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${lock.id} [${lock.role} ${lock.width} ${lock.path}] — ${res.actual}`);
    if (res.detail) console.log(`        ${JSON.stringify(res.detail).slice(0, 400)}`);
    if (lock.note) console.log(`        note: ${lock.note}`);
    const shot = resolve(OUT, `${lock.id.replace(/[^\w.-]+/g, '_')}-fail.png`);
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    row.screenshot = shot;
  }
}

for (const { ctx } of contexts.values()) await ctx.close().catch(() => {});
await browser.close();

writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({
  at: new Date().toISOString(),
  base: FE,
  total: results.length,
  failed,
  locks: results,
}, null, 2));

console.log(`design-lock: ${results.length - failed}/${results.length} locks hold (${files.length} module(s)); evidence ${resolve(OUT, 'report.json')}`);
process.exit(failed ? 1 : 0);
