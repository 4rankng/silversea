// ui-filter-audit-20260927.mjs — the repeatable filter-strip STYLING-DRIFT
// audit (card 20260927_152; re-scoped by card 20260930_229).
//
// The two-row law itself is STRUCTURAL since the FilterBar band
// (`frontend/src/design-system/FilterBar.tsx`): the band measures its own rows
// (`filter-bar-mode.ts`, two-line budget) and mounts the `Bộ lọc` fold itself
// for every `fold` slot, so a bar can no longer render three rows with nothing
// to fold into — the `rowExempt` carve-out this script used to carry is dead
// with the law it excused. The bar-level contracts (fold opens, two-row cap,
// anchor gating) are pinned once in
// `frontend/src/design-system/FilterBar.test.tsx`, and the rendered row budget
// is locked by `design-lock/expectations/filters.mjs`.
//
// What this script still proves, per shared filter bar, at every device width —
// the STYLING DRIFT a refactor can silently regress, which no structural
// guarantee covers:
//   1. no control is wider than the value it holds — every family has a cap,
//      and a control that owns a whole line fails L3;
//   2. nothing overflows the bar or the page;
//   3. a `Bộ lọc` trigger opens its panel ANCHORED to the trigger (within 8px
//      below, or within 8px above when flipped) and the panel never covers the
//      control that opened it — the operator's "why the dropdown jump around
//      not right below where I clicked".
//
// Usage (dev stack up: backend :3002, frontend :7174):
//   node testplan/qa/scripts/ui-filter-audit-20260927.mjs
//   WIDTHS=390,1440 ROUTES=/shipments node testplan/qa/scripts/ui-filter-audit-20260927.mjs
//   QA_BASE_URL=http://localhost:7175 node testplan/qa/scripts/ui-filter-audit-20260927.mjs
//
// Exit code 0 = every surface clean. Evidence: qa/filter-audit/report.json plus
// one bar screenshot per surface × width.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
// `@playwright/test` lives in the frontend package (the repo root only carries
// puppeteer for the older harness), so resolve it from there instead of relying
// on a root symlink that does not exist.
const { chromium } = createRequire(path.join(REPO, 'frontend', 'package.json'))('@playwright/test');
const OUT = process.env.OUT || path.join(REPO, 'qa', 'filter-audit');
const BASE = (process.env.QA_BASE_URL || 'http://localhost:7175').replace(/\/$/, '');
const PASS = process.env.QA_PASS || 'Abc123';
const WIDTHS = (process.env.WIDTHS || '390,500,640,768,1024,1187,1440').split(',').map(Number);
// A 768/1024 tablet is a touch device: `pointer: coarse` media queries key off
// this, so those widths must be captured in a touch context.
const TOUCH_MAX = Number(process.env.TOUCH_MAX || 1024);
const SHOTS = process.env.SHOTS !== '0';

// Role -> local dev username (backend/src/seed.ts demo users).
// Seeded demo users (backend/src/seed.ts). `ops` is the forwarder/OPS role
// (giaonhan) that owns /ops/orders, /my-advances and /my-settlements.
const ACCOUNT = { cus: 'cus', ketoan: 'ketoan', dieuvan: 'dieuvan', admin: 'admin', ops: 'giaonhan' };

/** label, route, role — the shared-bar surfaces this cutover owns. */
const SURFACES = [
  { label: 'shipments', path: '/shipments', role: 'cus' },
  { label: 'shipments-detail', path: '/shipments-detail', role: 'cus' },
  { label: 'shipments-debit', path: '/shipments-debit', role: 'cus' },
  { label: 'invoice-tracking', path: '/accounting/invoice-tracking', role: 'ketoan' },
  { label: 'expenses', path: '/expenses', role: 'ketoan' },
  { label: 'debt', path: '/debt', role: 'ketoan' },
  { label: 'penalties', path: '/penalties', role: 'ketoan' },
  { label: 'phoi-phieu', path: '/accounting/phoi-phieu', role: 'ketoan' },
  { label: 'deposit-tracker', path: '/accounting/deposit-tracker', role: 'ketoan' },
  { label: 'expense-accounting', path: '/accounting/expenses', role: 'ketoan' },
  { label: 'dispatch', path: '/dispatch', role: 'dieuvan' },
  { label: 'portal-statement', path: '/portal/statement', role: 'cus' },
  { label: 'config-customers', path: '/config/customers', role: 'admin' },

  // Wave 2 + 3 of the cutover (2026-09-27/28): every remaining page-local filter
  // plane moved onto the same strip. These carry the promise at the widths where
  // the page-local toolbar actually failed, so the sweep stays under a minute per
  // surface; `widths` overrides the global WIDTHS for the entry.
  // tripDetailOnly = ADMIN | MANAGER | ACCOUNTANT — the dispatcher is deliberately
  // excluded from Sổ chuyến đi, so this surface audits as `ketoan`.
  { label: 'trips', path: '/trips', role: 'ketoan' },
  // Card 20260928_158: this entry no longer restricts its widths. The phone
  // band was a blind spot, and it happened to be the only band where the real
  // defect lived — the sheet covered its own trigger at 390 and cleared it by
  // 4px at 1024/1440, so auditing only the three desk widths reported the
  // surface as healthy while it was broken where phones live. The `widths`
  // restriction below is a sweep-runtime budget, not a correctness claim, and
  // this surface now passes the full set (7 widths, 0 flagged).
  { label: 'dispatch-detail', path: '/dispatch-detail', role: 'dieuvan' },
  { label: 'fleet-vehicles', path: '/fleet/vehicles', role: 'dieuvan' },
  { label: 'fleet-drivers', path: '/fleet/drivers', role: 'dieuvan' },
  { label: 'fleet-external', path: '/fleet/external', role: 'dieuvan' },
  { label: 'suppliers', path: '/suppliers', role: 'ketoan' },
  { label: 'payables', path: '/payables', role: 'ketoan' },
  { label: 'fuel-evidence', path: '/accounting/fuel-evidence', role: 'ketoan' },
  { label: 'salary', path: '/salary', role: 'ketoan' },
  { label: 'users', path: '/users', role: 'admin' },
  { label: 'audit-logs', path: '/audit-logs', role: 'admin' },
  { label: 'ops-orders', path: '/ops/orders', role: 'ops' },
  { label: 'customers', path: '/customers', role: 'admin' },
  { label: 'config-routes', path: '/config/routes', role: 'admin' },
  { label: 'config-ports', path: '/config/ports', role: 'admin' },
  { label: 'config-factories', path: '/config/factories', role: 'admin' },
  { label: 'config-penalty-reasons', path: '/config/penalty-reasons', role: 'admin' },
  // `/admin/advance-settlements` is a legacy redirect to /advances, which embeds
  // BOTH admin advance pages (`AdminAdvancesPage` / `AdminAdvanceSettlementsPage`),
  // so the settlements plane is audited through /advances.
  // The transport register is a view of the accounting workspace (`?view=transport`),
  // not the workspace default.
  { label: 'accounting-register', path: '/accounting?view=transport', role: 'ketoan' },
  // `/advances` mounts AdminAdvancesPage embedded; `/config` is the config home.
  { label: 'advances', path: '/advances', role: 'ketoan' },
  { label: 'config-home', path: '/config', role: 'admin' },
  { label: 'my-advances', path: '/my-advances', role: 'ops' },
  { label: 'my-settlements', path: '/my-settlements', role: 'ops' },
];
const ROUTE_FILTER = process.env.ROUTES ? process.env.ROUTES.split(',').map((s) => s.trim()) : null;

/**
 * Runs in the page. Measures every shared `.filter-bar` on the route (a page may
 * legitimately render more than one bar) and returns one record per bar.
 */
function measureBars() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const name = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
    const txt = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '')
      .trim().replace(/\s+/g, ' ').slice(0, 28);
    return `${el.tagName.toLowerCase()}${cls}${txt ? ` "${txt}"` : ''}`;
  };
  const r1 = (n) => Math.round(n * 10) / 10;

  // Every family's ceiling, straight from the plan's L3 table. A control that
  // exceeds its cap is a control that took the width of something it does not
  // hold. `null` = content-sized, no ceiling.
  const CAPS = [
    { sel: '.filter-bar__search', cap: 640, family: 'search shell' },
    { sel: '.date-range-fields', cap: 348, family: 'from/to group' },
    { sel: '[data-input-wrapper]', cap: 168, family: 'date field' },
    { sel: '.ds-uui-select', cap: 280, family: 'UUI select' },
    { sel: '.searchable-select', cap: 320, family: 'searchable select' },
    { sel: '.filter-dropdown__trigger', cap: 180, family: 'Bộ lọc trigger' },
  ];

  const bars = [...document.querySelectorAll('.filter-bar')]
    .filter((el) => vis(el) && !el.closest('[role="dialog"], .modal, .ds-drawer'));
  const out = [];
  for (const bar of bars) {
    const box = bar.getBoundingClientRect();
    // Direct children only: a control nested in a group (the from/to pair)
    // belongs to that group's track, not to the bar.
    const items = [...bar.children].filter((el) => vis(el) && !el.classList.contains('filter-bar__spacer'));
    // A visual row is a set of items whose vertical ranges OVERLAP by more than
    // half the shorter item — not a set of equal `top` values. `align-items:
    // flex-end` bottom-aligns a 53px label+field stack with a 30px button, so
    // those two share a row while their tops differ by 23px.
    const boxes = items
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .sort((a, b) => a.r.top - b.r.top);
    const rowRanges = [];
    for (const { el, r } of boxes) {
      const row = rowRanges.find((candidate) => {
        const overlap = Math.min(candidate.bottom, r.bottom) - Math.max(candidate.top, r.top);
        return overlap > 0.5 * Math.min(candidate.bottom - candidate.top, r.height);
      });
      if (row) {
        row.items.push(el);
        row.top = Math.min(row.top, r.top);
        row.bottom = Math.max(row.bottom, r.bottom);
      } else {
        rowRanges.push({ top: r.top, bottom: r.bottom, items: [el] });
      }
    }
    const tops = rowRanges.map((row) => Math.round(row.top));
    const controls = [...bar.querySelectorAll(CAPS.map((c) => c.sel).join(','))]
      .filter((el) => vis(el))
      // Keep only the outermost match per family (a `.searchable-select` also
      // contains `[data-input-wrapper]`-free markup, but be explicit anyway).
      .filter((el) => ![...bar.querySelectorAll(CAPS.map((c) => c.sel).join(','))].some((o) => o !== el && o.contains(el) && o.className === el.className));
    const over = [];
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      for (const { sel, cap, family } of CAPS) {
        if (!el.matches(sel)) continue;
        if (r.width > cap + 2) over.push({ el: name(el), family, w: r1(r.width), cap });
      }
    }
    const outside = items
      .filter((el) => el.getBoundingClientRect().right > box.right + 1)
      .map((el) => name(el));
    // `rows` is recorded as INFORMATION (triage context for the caps below),
    // not a verdict: the two-row budget itself is the FilterBar band's own
    // measured law since card 20260930_229 — pinned in
    // `design-system/FilterBar.test.tsx` and locked rendered by
    // `design-lock/expectations/filters.mjs` — so this audit no longer judges
    // it, and the `rowExempt` carve-out (a bar with no fold affordance) is
    // unreachable through the band's `fold` slot by construction.
    out.push({
      bar: name(bar),
      box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
      viewportWidth: window.innerWidth,
      rows: tops.length,
      rowTops: tops,
      items: items.map((el) => {
        const r = el.getBoundingClientRect();
        return { el: name(el), w: r1(r.width), top: Math.round(r.top), right: Math.round(r.right) };
      }),
      collapsed: Boolean(bar.querySelector('.filter-dropdown__trigger')),
      overflowCaps: over,
      outsideBar: outside,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    });
  }
  return { url: location.pathname + location.search, bars: out };
}

/** Runs in the page: opens a `Bộ lọc` trigger and reports the panel's relation to it. */
function probeDropdown() {
  const trigger = [...document.querySelectorAll('.filter-dropdown__trigger')].find((el) => el.offsetParent !== null);
  // Card 20260928_190: this used to answer `ok: true` with a `skipped` reason, and
  // because the row is only flagged on `!ok`, a surface whose bar has no `Bộ lọc`
  // trigger landed in `findings` as a clean pass for a check that never ran.
  // No trigger is NOT a hole though — it is the bar's healthy state at a width
  // wide enough to render every criterion inline, where there is nothing to fold
  // and therefore nothing to anchor. So it reports `applicable: false` and the
  // caller counts it separately. A genuine coverage hole is a different thing
  // entirely (a redirect, or a bar gated behind an empty dataset) and is listed
  // under `unverified`, which does fail the run.
  if (!trigger) return { ok: true, applicable: false, skipped: 'no Bộ lọc trigger — bar renders inline, nothing to anchor' };
  const before = trigger.getBoundingClientRect();
  trigger.click();
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const panel = document.querySelector('.filter-dropdown__popover');
      if (!panel) { resolve({ ok: false, reason: 'panel did not mount' }); return; }
      const p = panel.getBoundingClientRect();
      const t = trigger.getBoundingClientRect();
      const style = getComputedStyle(panel);
      const gapBelow = Math.round(p.top - t.bottom);
      const gapAbove = Math.round(t.top - p.bottom);
      const overlaps = Math.min(p.bottom, t.bottom) - Math.max(p.top, t.top) > 0
        && Math.min(p.right, t.right) - Math.max(p.left, t.left) > 0;
      const anchored = (gapBelow >= -1 && gapBelow <= 8) || (gapAbove >= -1 && gapAbove <= 8);
      const result = {
        ok: anchored && !overlaps,
        trigger: { top: Math.round(t.top), bottom: Math.round(t.bottom), h: Math.round(t.height), moved: Math.abs(t.top - before.top) > 1 },
        panel: { top: Math.round(p.top), bottom: Math.round(p.bottom), h: Math.round(p.height), visibility: style.visibility },
        gapBelow, gapAbove, overlaps,
      };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      resolve(result);
    }));
  });
}

async function login(page, username) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(900);
}

const contextFor = (browser, width) => (width > TOUCH_MAX
  ? browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
  : browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  }));

await fs.mkdir(OUT, { recursive: true });
// Card 20260928_192: check the stack before measuring it. Hitting the wrong
// port makes every assertion fail for a reason that has nothing to do with the
// page under test, and the resulting 401s read as an auth bug. A loud
// "PREFLIGHT FAILED" naming both ports is worth more than 200 confusing
// failures.
const expectedPort = new URL(BASE).port || '80';
{
  const problems = [];
  for (const [label, url] of [['frontend', BASE], ['api', `${BASE.replace(/\/$/, '')}/api/health`]]) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      // Any answer proves something is bound; a 404 from the API is a routing
      // answer, not a dead server.
      void res.status;
    } catch (e) {
      problems.push(`${label} unreachable at ${url} (${e.cause?.code || e.message})`);
    }
  }
  if (problems.length) {
    console.error([
      '',
      'PREFLIGHT FAILED — this run would test the wrong thing:',
      ...problems.map((p) => `  - ${p}`),
      '',
      `Expected the local stack on port ${expectedPort} (Makefile: frontend 7175, backend 3002).`,
      'Start it with `make dev` from the repo root, or override:',
      '  QA_BASE_URL=http://localhost:<port> node ' + path.basename(import.meta.filename ?? 'this-script.mjs'),
      '',
    ].join('\n'));
    process.exit(1);
  }
}

const browser = await chromium.launch({ args: ['--font-render-hinting=none'] });
const contexts = new Map();
const contextEntry = async (role, username, width) => {
  const key = `${role}@${width}`;
  if (contexts.has(key)) return contexts.get(key);
  const ctx = await contextFor(browser, width);
  const page = await ctx.newPage();
  await login(page, username || ACCOUNT[role] || role);
  const entry = { ctx, page, path: null };
  contexts.set(key, entry);
  return entry;
};

const report = { at: new Date().toISOString(), base: BASE, widths: WIDTHS, findings: [], skipped: [] };
const surfaces = ROUTE_FILTER ? SURFACES.filter((s) => ROUTE_FILTER.includes(s.path)) : SURFACES;

for (const surface of surfaces) {
  for (const width of (surface.widths ?? WIDTHS)) {
    const { page } = await contextEntry(surface.role, ACCOUNT[surface.role], width);
    await page.goto(`${BASE}${surface.path}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(700);
    if (!page.url().includes(surface.path)) {
      report.skipped.push({ ...surface, width, reason: `redirected to ${new URL(page.url()).pathname}` });
      continue;
    }
    const measured = await page.evaluate(measureBars);
    if (!measured.bars.length) {
      // Card 20260928_190: "no shared .filter-bar rendered" was one bucket for
      // two very different facts. A surface that has no bar in its code is out of
      // scope and can be closed; a surface that HAS one and hides it behind
      // `count > 0` is UNVERIFIED, because the local dataset happened to be
      // empty. Reporting the second as the first is how a surface silently
      // escapes coverage, so the two now carry different kinds and the summary
      // counts them separately. Evidence for the split:
      // ForwarderSettlementsPage.tsx renders `ListFilterBar` inside
      // `{totalCount > 0 && ...}`, and the demo account holds zero settlements.
      const dataGated = await page.evaluate(() => {
        const rows = document.querySelectorAll('tbody tr').length;
        const empty = document.querySelector('[data-empty], .empty-state, [class*="empty"]');
        return rows === 0 || Boolean(empty);
      });
      report.skipped.push({
        ...surface, width,
        kind: dataGated ? 'unverified: bar gated on data, dataset empty' : 'out of scope: no shared .filter-bar in this surface',
        reason: dataGated ? 'no rows to filter' : 'no shared .filter-bar rendered',
      });
      continue;
    }
    for (const [index, bar] of measured.bars.entries()) {
      const dropdown = await page.evaluate(probeDropdown);
      const row = {
        surface: surface.label, path: surface.path, role: surface.role, width, barIndex: index,
        ...bar, dropdown,
      };
      // `applicable === false` means the bar renders every criterion inline, so
      // there is no panel to anchor. That is the healthy state, not a gap, and it
      // is counted and printed rather than silently passing.
      const anchorApplicable = dropdown.applicable !== false;
      row.anchorApplicable = anchorApplicable;
      row.flagged = Boolean(bar.overflowCaps.length || bar.outsideBar.length || bar.pageOverflow > 1 || !dropdown.ok);
      report.findings.push(row);
      const flags = [
        bar.overflowCaps.length ? `cap=${bar.overflowCaps.map((o) => `${o.family} ${o.w}>${o.cap}`).join(',')}` : '',
        bar.outsideBar.length ? `outside=${bar.outsideBar.length}` : '',
        bar.pageOverflow > 1 ? `pgOvf=${bar.pageOverflow}` : '',
        !dropdown.ok ? `anchor=${dropdown.reason || `gap ${dropdown.gapBelow}/${dropdown.gapAbove} overlap ${dropdown.overlaps}`}` : '',
        !anchorApplicable ? 'anchor n/a (inline)' : '',
      ].filter(Boolean).join(' ');
      const mark = row.flagged ? 'FAIL' : 'ok  ';
      process.stdout.write(`${mark} ${surface.label.padEnd(18)} ${String(width).padEnd(5)} bar${index} rows=${bar.rows} ${flags}\n`);
      if (SHOTS && bar.box.w > 40) {
        const clip = { x: Math.max(0, bar.box.x - 4), y: Math.max(0, bar.box.y - 4), width: Math.min(bar.box.w + 8, width), height: Math.min(bar.box.h + 8, 1200) };
        await page.screenshot({ path: path.join(OUT, `${surface.label}-${width}-bar${index}.png`), clip }).catch(() => {});
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
}

for (const { ctx } of contexts.values()) await ctx.close().catch(() => {});
await browser.close();
await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

const flagged = report.findings.filter((f) => f.flagged);
const anchorNA = report.findings.filter((f) => f.anchorApplicable === false);
const unverified = report.skipped.filter((s) => String(s.kind || '').startsWith('unverified'));
const outOfScope = report.skipped.filter((s) => String(s.kind || '').startsWith('out of scope'));
// Card 20260928_190: "N bars measured, 0 flagged" must never be read as "the app
// is covered". The summary splits the two kinds of not-measured, and a real
// coverage hole (a redirect, or a bar gated behind an empty dataset) exits
// non-zero — an unmeasured surface is an open hole, not a pass. A bar that
// renders inline has nothing to anchor; that is counted, not failed.
process.stdout.write(`\nfilter-audit: ${report.findings.length} bars measured · ${flagged.length} flagged\n`);
process.stdout.write(`  anchor check: ${report.findings.length - anchorNA.length} verified · ${anchorNA.length} n/a (bar renders inline, nothing to anchor)\n`);
process.stdout.write(`  not measured: ${unverified.length} UNVERIFIED (open holes) · ${outOfScope.length} out of scope · ${report.skipped.length - unverified.length - outOfScope.length} other\n`);
if (unverified.length) {
  process.stdout.write('\n  UNVERIFIED — these are NOT passes:\n');
  for (const s of unverified) process.stdout.write(`    ${s.label}@${s.width}: ${s.reason}\n`);
}
if (outOfScope.length) {
  process.stdout.write('\n  out of scope (no shared bar in this surface):\n');
  for (const s of outOfScope) process.stdout.write(`    ${s.label}@${s.width}\n`);
}
for (const s of report.skipped) {
  if (String(s.kind || '')) continue;
  process.stdout.write(`  skipped ${s.label}@${s.width}: ${s.reason}\n`);
}
process.stdout.write(`evidence: ${OUT}\n`);
process.exitCode = flagged.length || unverified.length ? 1 : 0;
