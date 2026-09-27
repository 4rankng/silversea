// ui-filter-layout-sweep-20260927.mjs — the filter-control strip of EVERY route
// at EVERY device width, measured (card 20260927_151, CHIEF 27/09).
//
// What it proves, per filter surface: how many visual rows the controls take,
// how many controls ride each row, whether a row is left holding a single
// control while another row is packed, whether a control clips its own value or
// overflows the bar, and whether a row mixes control heights. It also shoots the
// surface itself so the evidence is eyeballable, not just numeric.
//
// Usage (from the repo root, local dev stack up):
//   node testplan/qa/scripts/ui-filter-layout-sweep-20260927.mjs
//   ROLES=cus,ops WIDTHS=390,768,1024,1187,1440 node testplan/qa/scripts/…
//   ROUTES=/shipments,/shipments-detail node testplan/qa/scripts/…
//   STAGING_URL=https://vantai.tingting.vip node testplan/qa/scripts/…   (cut verification)
//
// Exit code 0 = every surface clean; 1 = at least one flag (or a role could not
// be walked). Evidence: testplan/qa/evidence/<ts>_filter-layout/.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../lib/env.mjs';
import { createSession } from '../lib/harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QA_ROOT = path.resolve(__dirname, '..');

// Role label -> testaccounts.txt key (CUS / DISPATCHER / DRIVER / OPS).
const ROLE_KEY = { cus: 'CUS', chungtu: 'CUS', dieuvan: 'DISPATCHER', laixe: 'DRIVER', ops: 'OPS' };
const ROLES = (process.env.ROLES || 'cus,dieuvan,laixe,ops').split(',').map((s) => s.trim()).filter(Boolean);
const WIDTHS = (process.env.WIDTHS || '390,768,1024,1187,1440').split(',').map(Number);
const ROUTES = process.env.ROUTES ? process.env.ROUTES.split(',').map((s) => s.trim()) : null;
const TOUCH_MAX = Number(process.env.TOUCH_MAX || 1024);
const SHOTS = process.env.SHOTS !== '0';
const STAMP = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const OUT = process.env.OUT || path.join(QA_ROOT, 'evidence', `${STAMP}_filter-layout`);

/** Runs in the page: find every filter surface and measure it. */
function probeFilters() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.right <= 0 || r.bottom <= 0 || r.left < 0 || r.top < 0 || r.left > window.innerWidth + 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const CONTROL_SEL = [
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
    'select',
    '[role="combobox"]',
    '[data-input-wrapper]',
    '.ds-uui-select',
    '[data-uui-control]',
    'button[aria-haspopup]',
    '.filter-chip',
    '.filter-tab',
    '.ds-tabs',
    '.searchable-select__trigger',
    '.inline-label-select__trigger',
    '.date-seg-group',
  ].join(',');

  const name = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
    const txt = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '')
      .trim().replace(/\s+/g, ' ').slice(0, 30);
    return `${el.tagName.toLowerCase()}${cls}${txt ? ` "${txt}"` : ''}`;
  };

  const roots = [...document.querySelectorAll('main [class*="filter" i], main [class*="toolbar" i]')]
    .filter((el) => !el.closest('[role="dialog"], .modal, table tbody, .ds-drawer'))
    .filter(vis);
  const surfaces = [];
  for (const el of roots) {
    if (!el.querySelector(CONTROL_SEL)) continue;
    if (roots.some((other) => other !== el && other.contains(el))) continue;
    const all = [...el.querySelectorAll(CONTROL_SEL)].filter(vis);
    // One logical control = its outermost match inside the surface: a date
    // field's DD/MM/YYYY segments and its inner <input> belong to the field's
    // own wrapper, not to the row as separate controls.
    const controls = all.filter((c) => !all.some((other) => other !== c && other.contains(c)));
    if (controls.length < 2) continue;
    surfaces.push({ el, controls });
  }

  const out = [];
  for (const { el, controls } of surfaces) {
    const box = el.getBoundingClientRect();
    const items = controls.map((c) => {
      const r = c.getBoundingClientRect();
      const inner = c.matches('input, select') ? c : (c.querySelector('.searchable-select__trigger, .inline-label-select__trigger, [role="combobox"], input:not(.date-seg), select') || c);
      const ir = inner.getBoundingClientRect();
      const is = getComputedStyle(inner);
      // A segmented date box is em-pinned to its own glyphs by design — it is
      // never the clipping signal; the field wrapper is.
      const clipped = !inner.classList.contains('date-seg')
        && inner.scrollWidth > inner.clientWidth + 2
        && inner.clientWidth > 0
        && (is.textOverflow === 'ellipsis' || is.overflowX === 'hidden');
      return {
        el: name(c),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        right: Math.round(r.right), left: Math.round(r.left), bottom: Math.round(r.bottom),
        boxH: Math.round(ir.height), boxW: Math.round(ir.width),
        clipped,
      };
    });
    // Same row = vertical ranges overlap by more than half the shorter control.
    const rows = [];
    for (const it of [...items].sort((a, b) => a.y - b.y)) {
      const row = rows.find((r) => {
        const overlap = Math.min(r.bottom, it.bottom) - Math.max(r.top, it.y);
        return overlap > 0.5 * Math.min(r.bottom - r.top, it.h);
      });
      if (row) {
        row.items.push(it);
        row.top = Math.min(row.top, it.y);
        row.bottom = Math.max(row.bottom, it.bottom);
        row.h = row.bottom - row.top;
      } else {
        rows.push({ top: it.y, bottom: it.bottom, h: it.h, items: [it] });
      }
    }
    out.push({
      surface: name(el),
      box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
      surfaceOverflowX: Math.max(0, Math.round(el.scrollWidth - el.clientWidth)),
      rowCount: rows.length,
      rows: rows.map((r) => {
        const left = Math.min(...r.items.map((i) => i.left));
        const right = Math.max(...r.items.map((i) => i.right));
        const used = right - left;
        return {
          n: r.items.length,
          widths: r.items.map((i) => i.w),
          heights: [...new Set(r.items.map((i) => i.boxH))],
          used: Math.round(used),
          fill: Math.round((used / Math.max(1, Math.round(box.width))) * 100),
          els: r.items.map((i) => i.el),
        };
      }),
      controlCount: items.length,
      clipped: items.filter((i) => i.clipped).map((i) => i.el),
      overflowing: items.filter((i) => i.right > Math.round(box.right) + 1 || i.left < Math.round(box.left) - 1).map((i) => i.el),
      sub44: items.filter((i) => i.w < 44 || i.h < 44).length,
      items,
    });
  }
  return {
    url: location.pathname + location.search,
    title: ((document.querySelector('h1') || {}).textContent || '').trim().slice(0, 60),
    surfaces: out,
  };
}

/** Walk the role's own nav so the route set is the app's, not a guess. */
async function routesForRole(page, baseUrl) {
  const home = new URL(page.url()).pathname;
  const expand = async () => {
    const toggles = await page.$$('nav.sidebar-nav button.sidebar-section-toggle');
    for (const t of toggles) {
      const expanded = await t.evaluate((el) => el.getAttribute('aria-expanded'));
      if (expanded === 'false') await t.click().catch(() => {});
    }
  };
  await expand();
  const labels = await page.$$eval(
    'nav.sidebar-nav button:not(.sidebar-section-toggle), nav.bottom-nav button',
    (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()),
  );
  const paths = new Set([home]);
  for (const text of labels) {
    await page.goto(`${baseUrl}${home}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    await expand();
    const handle = await page.evaluateHandle((t) => {
      const nodes = [...document.querySelectorAll('nav.sidebar-nav button:not(.sidebar-section-toggle), nav.bottom-nav button')];
      return nodes.find((n) => n.offsetParent !== null && n.textContent.trim() === t) || null;
    }, text);
    const el = handle.asElement();
    if (!el) continue;
    await el.click().catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    const p = new URL(page.url()).pathname;
    if (!p.includes('login')) paths.add(p);
  }
  return [...paths];
}

const env = await loadEnv();
await fs.mkdir(OUT, { recursive: true });
const report = { generatedAt: new Date().toISOString(), env: env.env, baseUrl: env.baseUrl, widths: WIDTHS, roles: {}, findings: [] };

for (const role of ROLES) {
  let session;
  try {
    session = await createSession({ env, role: ROLE_KEY[role] ?? role.toUpperCase(), evidenceDir: OUT, runId: STAMP });
  } catch (error) {
    report.roles[role] = { error: error.message };
    process.stderr.write(`ROLE ${role}: ${error.message}\n`);
    continue;
  }
  const { page } = session;
  await page.goto(`${env.baseUrl}${new URL(page.url()).pathname}`, { waitUntil: 'networkidle2' }).catch(() => {});
  await page.goto(`${env.baseUrl}/`, { waitUntil: 'networkidle2' }).catch(() => {});
  const routes = ROUTES ?? (await routesForRole(page, env.baseUrl));
  report.roles[role] = { username: session.username, routes, pages: [] };
  process.stderr.write(`ROLE ${role} (${session.username}) routes=${routes.length}\n`);

  for (const width of WIDTHS) {
    await page.setViewport({
      width,
      height: width <= TOUCH_MAX ? 844 : 900,
      isMobile: width <= TOUCH_MAX,
      hasTouch: width <= TOUCH_MAX,
      deviceScaleFactor: 1,
    });
    for (const route of routes) {
      await page.goto(`${env.baseUrl}${route}`, { waitUntil: 'networkidle2' }).catch(() => {});
      await new Promise((r) => setTimeout(r, 600));
      const probe = await page.evaluate(probeFilters);
      report.roles[role].pages.push({ width, ...probe });
      for (const s of probe.surfaces) {
        const last = s.rows[s.rows.length - 1];
        const orphanLastRow = s.rowCount > 1 && last.n === 1 && last.widths[0] < s.box.w * 0.4
          && !/button|ds-tabs|filter-chip|filter-tab/.test(last.els[0]);
        // A row that uses less than 60% of the bar's width while the bar wraps
        // is the "half the row is empty" defect the operator photographed.
        // A row made only of buttons/segments (the action cluster or a preset
        // group) is the bar's tail, not a wasted row — only rows that carry a
        // FIELD control are judged on how much width they use.
        const hasField = (el) => /input|select|combobox|data-input-wrapper|ds-uui-select|searchable-select__trigger|inline-label-select__trigger/.test(el);
        const wastedRows = s.rows.filter((r) => r.n > 1 && r.fill < 50 && r.els.some(hasField)).length;
        const mixedHeights = s.rows.some((r) => Math.max(...r.heights) - Math.min(...r.heights) > 2);
        const finding = {
          role, width, route, surface: s.surface,
          rows: s.rowCount, rowShape: s.rows.map((r) => `${r.n}(${r.fill}%)`).join('+'), controls: s.controlCount,
          clipped: s.clipped, overflowing: s.overflowing, surfaceOverflowX: s.surfaceOverflowX,
          mixedHeights, orphanLastRow, wastedRows, sub44: s.sub44,
        };
        // `mixedHeights` is reported but not a defect on its own: a row
        // legitimately mixes a 53px label-above field with a 32px chip or
        // segmented group. The real flags are clipping, overflow, a lone
        // field stranded on its own row, and a half-empty field row.
        finding.flagged = Boolean(s.clipped.length || s.overflowing.length || s.surfaceOverflowX || orphanLastRow || wastedRows);
        report.findings.push(finding);
        const flags = [
          s.clipped.length ? `clip=${s.clipped.length}` : '',
          s.overflowing.length ? `ovf=${s.overflowing.length}` : '',
          s.surfaceOverflowX ? `surfOvf=${s.surfaceOverflowX}` : '',
          mixedHeights ? 'mixedH' : '',
          orphanLastRow ? 'orphan' : '',
          wastedRows ? `waste=${wastedRows}` : '',
        ].filter(Boolean).join(' ');
        process.stdout.write(
          `${role.padEnd(8)} ${String(width).padEnd(5)} ${route.padEnd(26)} rows=${s.rowCount} [${s.rows.map((r) => `${r.n}:${r.fill}%`).join('+')}] ctrl=${s.controlCount} ${flags}\n`,
        );
        if (SHOTS && s.box.w > 40) {
          const slug = `${role}-${width}-${(route.replace(/^\//, '').replace(/[/?=&]/g, '_') || 'home').slice(0, 40)}`;
          const clip = { x: Math.max(0, s.box.x - 4), y: Math.max(0, s.box.y - 4), width: Math.min(s.box.w + 8, width), height: Math.min(s.box.h + 8, 2000) };
          await page.screenshot({ path: path.join(OUT, `${slug}-${s.surface.replace(/[^\w]+/g, '_').slice(0, 24)}.png`), clip }).catch(() => {});
        }
      }
    }
  }
  await session.browser.close().catch(() => {});
}

await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const flagged = report.findings.filter((f) => f.flagged);
const byRoute = new Map();
for (const f of flagged) {
  const key = `${f.route}@${f.width}`;
  byRoute.set(key, (byRoute.get(key) || 0) + 1);
}
process.stdout.write(`\n${report.findings.length} surfaces measured · ${flagged.length} flagged\n`);
for (const [key, n] of [...byRoute.entries()].sort()) process.stdout.write(`  ${key}: ${n}\n`);
process.stdout.write(`evidence: ${OUT}\n`);
process.exitCode = flagged.length === 0 && Object.values(report.roles).every((r) => !r.error) ? 0 : 1;
