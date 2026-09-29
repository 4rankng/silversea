// Role-wide UI sweep — chungtu (CUS) / dieuvan (DISPATCHER) / laixe (DRIVER)
// / ops (OPS). Logs in per role, walks the role's OWN nav (clicking every
// sidebar / bottom-nav entry, so role filtering is the app's, not a guess),
// then screenshots each route at phone (390) and desktop (1440) and records
// machine-checkable UI defects. Evidence for the fix list, not opinion.
//
// Usage:  cd frontend && node role-ui-sweep.mjs            (local dev up)
//         ROLES=cus,ops node role-ui-sweep.mjs
// Output: qa/role-sweep/<role>/<slug>-<width>.png + qa/role-sweep/report.json

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const OUT = resolve(process.cwd(), process.env.OUT || '../qa/role-sweep');
const PASS = process.env.QA_PASS || 'Abc123';
const FULL = process.env.FULL !== '0';
const SHOT = process.env.SHOT !== '0';
const DETAILS = process.env.DETAILS !== '0';

const ROLES = (process.env.ROLES || 'cus,dieuvan,laixe,ops').split(',').map((r) => r.trim());
// Role label -> local-dev login (testplan/testaccounts.txt).
const ROLE_USER = { chungtu: 'cus', cus: 'cus', dieuvan: 'dieuvan', laixe: 'laixe', ops: 'giaonhan' };
const WIDTHS = (process.env.WIDTHS || '390,1440').split(',').map(Number);
// Touch-capable devices: `pointer: coarse` media queries (the 40px floors, the
// tablet bands) key off this, and a 768/1024 tablet is a touch device.
const TOUCH_MAX = Number(process.env.TOUCH_MAX || 1024);

mkdirSync(OUT, { recursive: true });

/** Runs in the page: machine-checkable UI defects. */
function probePage() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const describe = (el) => {
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 36);
    return `${el.tagName.toLowerCase()}${cls}${txt ? ` "${txt}"` : ''}`;
  };

  const root = document.documentElement;
  const horizontalOverflow = Math.max(0, root.scrollWidth - root.clientWidth);

  const clipped = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length > 0) continue;
    const text = (el.textContent || '').trim();
    if (!text || !visible(el)) continue;
    // Visually-hidden a11y text (sr-only route announcer, live regions) is a
    // 1-2px box by design — it is not a clipped column value.
    if (el.clientWidth <= 2 || el.closest('.sr-only, [aria-live]')) continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      const s = getComputedStyle(el);
      if (s.overflowX === 'hidden' || s.textOverflow === 'ellipsis') {
        clipped.push({ el: describe(el), scrollW: el.scrollWidth, clientW: el.clientWidth, textOverflow: s.textOverflow });
      }
    }
  }

  const small = [];
  for (const el of document.querySelectorAll('a[href], button, [role=button], input:not([type=hidden]), select, textarea')) {
    if (!visible(el) || el.closest('[aria-hidden="true"]')) continue;
    // A digit segment inside a segmented date/time field is not its own tap
    // target: the GROUP is (it click-opens the picker), and each box width is
    // em-measured to its own glyphs at 12px so `DD` never shaves into an
    // E-like sliver (design-system/forms/DateTimeSegments.css + its styles
    // test pin 1.706em/1.956em/2.91em). Counting them made every sweep report
    // a false sub-floor hit on /shipments-detail.
    if (el.classList.contains('date-seg')) continue;
    const r = el.getBoundingClientRect();
    // Touch floor = the operator ruling of 2026-09-27 ("text 11px 12px
    // component size max 40px"): `--control-touch-h` IS `--control-max-h`, so
    // 40px is the sanctioned floor and the ceiling. Counting `< 44` here
    // reported every 40x40 control in the app as a defect — 24 phantom rows in
    // the 2026-09-30 sweep, 0 real ones (card 20260930_217). design-lock's
    // `tapFloor` reads the same 40 from `scripts/design-lock.mjs`.
    if (r.width < 40 || r.height < 40) small.push({ el: describe(el), w: Math.round(r.width), h: Math.round(r.height) });
  }

  const tiny = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length > 0 || !visible(el) || !(el.textContent || '').trim()) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs > 0 && fs < 11) tiny.push({ el: describe(el), fs });
  }

  // Missing illustration art: `EmptyState` hides an img it cannot load and
  // marks it `data-art-missing` — a deploy that ships an unreadable/absent
  // asset then renders text-only empty states and NOTHING said so (the
  // 2026-09-27 staging 403 on empty-fuel.webp). Any broken illustration is a
  // finding in every environment, not just the one the operator happened to
  // look at.
  const brokenArt = [...document.querySelectorAll('img')]
    .filter((img) => (img.getAttribute('src') || '').includes('/assets/illustrations/'))
    .filter((img) => img.dataset.artMissing === 'true' || img.naturalWidth === 0)
    .map((img) => (img.getAttribute('src') || '').slice(-48));

  const appBody = document.querySelector('.app-body, .app-main, main');
  return {
    url: location.pathname + location.search,
    title: ((document.querySelector('h1') || {}).textContent || document.title || '').trim().slice(0, 80),
    docHeight: root.scrollHeight,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    horizontalOverflow,
    chromeH: appBody ? Math.round(appBody.getBoundingClientRect().top) : null,
    clipped: clipped.slice(0, 20),
    clippedCount: clipped.length,
    small: small.slice(0, 20),
    smallCount: small.length,
    tiny: tiny.slice(0, 12),
    tinyCount: tiny.length,
    brokenArt: brokenArt.slice(0, 10),
    brokenArtCount: brokenArt.length,
  };
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});

const report = {};

/** Navigable/read-only openers that lead from a list page to a record page.
 *  Deliberately NOT "the first button in the row": row buttons open inline
 *  editors (URL unchanged) and often include destructive actions, which a
 *  sweep must never press on live data. Anchors whose href is deeper than the
 *  current route, plus buttons whose visible name is a read/see verb. */
async function recordOpeners(page) {
  const here = new URL(page.url()).pathname.replace(/\/$/, '');
  const anchors = await page.locator('main a[href^="/"]').all();
  const deeper = [];
  for (const a of anchors) {
    const href = await a.getAttribute('href').catch(() => null);
    if (!href) continue;
    const path = href.split('?')[0].replace(/\/$/, '');
    if (path !== here && path.startsWith(here + '/')) deeper.push(a);
  }
  const safeNames = /^(chi tiết|xem|mở|xem chi tiết|chi tiết lô|chi tiết container)/i;
  const buttons = [];
  for (const b of await page.locator('main button:visible').all()) {
    const name = ((await b.getAttribute('aria-label')) || (await b.textContent()) || '').trim();
    if (safeNames.test(name)) buttons.push(b);
  }
  // Rows that open their record from a row/cell click carry no anchor and no
  // button. A plain-text cell is a read-only target: pressing it either
  // navigates or does nothing — it never mutates data (destructive actions are
  // always buttons, which are excluded here).
  const rows = [];
  for (const td of await page.locator('main tbody tr:first-child td').all()) {
    const hasControl = await td.locator('button, a, input, select').count();
    if (hasControl === 0 && (await td.textContent() || '').trim()) { rows.push(td); break; }
  }
  return [...deeper, ...buttons, ...rows].slice(0, 4);
}

const captureCtx = { page: null, ctx: null };

/** Wire console/network error capture onto a page. */
function attach(page, errors) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) errors.push(`api ${r.status()} ${r.url().replace(FE, '').slice(0, 140)}`); });
}

async function login(page, username) {
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function navButtonLocator(page) {
  const sidebar = page.locator('nav.sidebar-nav button:not(.sidebar-section-toggle):visible');
  if (await sidebar.count()) return { locator: sidebar, kind: 'sidebar' };
  const bottom = page.locator('nav.bottom-nav button:visible');
  if (await bottom.count()) return { locator: bottom, kind: 'bottom' };
  return { locator: null, kind: 'none' };
}

for (const role of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  attach(page, errors);

  await login(page, ROLE_USER[role] || role);
  await page.waitForTimeout(300);
  const home = new URL(page.url()).pathname;
  captureCtx.page = page;

  // Expand every sidebar section so collapsed groups contribute their items.
  const expand = async () => {
    const toggles = page.locator('nav.sidebar-nav button.sidebar-section-toggle:visible');
    for (let i = 0, n = await toggles.count(); i < n; i++) {
      const t = toggles.nth(i);
      if (await t.getAttribute('aria-expanded') === 'false') await t.click({ timeout: 800 }).catch(() => {});
    }
  };
  await expand();

  const { locator, kind } = await navButtonLocator(page);
  const paths = new Set([home]);
  const labels = locator ? await locator.evaluateAll((els) => els.map((e) => e.textContent.trim())) : [];
  report[role] = { home, navKind: kind, navLabels: labels, routes: [], pages: [], errors: [] };

  for (const label of labels) {
    await page.goto(`${FE}${home}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(400);
    await expand();
    const btn = page.locator(`nav.sidebar-nav button:not(.sidebar-section-toggle):visible, nav.bottom-nav button:visible`).filter({ hasText: label }).first();
    if (!(await btn.count())) continue;
    await btn.click({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(900);
    const p = new URL(page.url()).pathname;
    if (!p.includes('login')) paths.add(p);
  }
  report[role].routes = [...paths];
  process.stderr.write(`ROLE ${role} (${kind}) home=${home} routes=${paths.size}\n`);

  for (const width of WIDTHS) {
    // A real phone: `pointer: coarse` + touch is what the app's 44px floors
    // and several responsive bands key off — a plain narrow desktop window
    // would hide those defects.
    if (width <= TOUCH_MAX && !captureCtx.mobile) {
      const mobileCtx = await browser.newContext({
        viewport: { width, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      });
      const mobilePage = await mobileCtx.newPage();
      attach(mobilePage, errors);
      await login(mobilePage, ROLE_USER[role] || role);
      captureCtx.page = mobilePage;
      captureCtx.ctx = mobileCtx;
      captureCtx.mobile = true;
    } else if (width > TOUCH_MAX && captureCtx.mobile) {
      await captureCtx.ctx.close().catch(() => {});
      captureCtx.mobile = false;
      captureCtx.page = page;
    }
    await captureCtx.page.setViewportSize({ width, height: width <= TOUCH_MAX ? 844 : 900 });
    for (const path of report[role].routes) {
      const page = captureCtx.page;
      const slug = (path.replace(/^\//, '').replace(/[/?=&]/g, '_') || 'home').slice(0, 60);
      errors.length = 0;
      await page.goto(`${FE}${path}`, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(800);
      const probe = await page.evaluate(probePage);
      if (SHOT) {
        const dir = `${OUT}/${role}`;
        mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: `${dir}/${slug}-${width}.png`, fullPage: FULL }).catch(() => {});
      }
      void page;
      report[role].pages.push({ width, path, ...probe, netErrors: [...new Set(errors)].slice(0, 5) });
      process.stderr.write(`${role} ${width} ${path} ovf=${probe.horizontalOverflow} clip=${probe.clippedCount} small=${probe.smallCount} tiny=${probe.tinyCount} err=${[...new Set(errors)].length} art=${probe.brokenArtCount} h=${probe.docHeight}\n`);

      if (DETAILS) {
        // The nav only reaches list roots; half the surface area is the record
        // page behind a row. Walk the safe openers until one changes the route.
        const before = new URL(page.url()).pathname;
        for (const opener of await recordOpeners(page)) {
          await opener.click({ timeout: 2500 }).catch(() => {});
          await page.waitForTimeout(1000);
          const after = new URL(page.url()).pathname;
          if (after === before || after.includes('login')) continue;
          const dslug = (after.replace(/^\//, '').replace(/[/?=&]/g, '_') || 'detail').slice(0, 60);
          errors.length = 0;
          const dprobe = await page.evaluate(probePage);
          if (SHOT) {
            const dir = `${OUT}/${role}`;
            await page.screenshot({ path: `${dir}/${dslug}-${width}.png`, fullPage: FULL }).catch(() => {});
          }
          report[role].pages.push({ width, path: after, from: path, ...dprobe, netErrors: [...new Set(errors)].slice(0, 5) });
          process.stderr.write(`${role} ${width} ${after} (detail of ${path}) ovf=${dprobe.horizontalOverflow} clip=${dprobe.clippedCount} small=${dprobe.smallCount} err=${[...new Set(errors)].length} h=${dprobe.docHeight}\n`);
          await page.goto(`${FE}${path}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
          break;
        }
      }
    }
  }
  await ctx.close().catch(() => {});
  if (captureCtx.ctx) { await captureCtx.ctx.close().catch(() => {}); captureCtx.ctx = null; captureCtx.mobile = false; }
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`wrote ${OUT}/report.json`);
await browser.close();
