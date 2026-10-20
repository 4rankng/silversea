// FB-045 lan-2 (card 201026140000): dialog "Chi tiết container" clip cột GIỜ HẸN.
// Matrix: {/dispatch drawer, /shipments drawer, /shipments-detail table, /dispatch-detail}
//       × {1024, 1280, 1440, 1920} — measures every "Giờ hẹn*" header/value cell
//       (line count, scrollWidth>clientWidth, text overflow past cell box) and
//       screenshots each open surface.
// Env: QA_BASE (default http://localhost:7175), QA_API (default http://localhost:3002/api),
//      QA_TAG (default before), QA_OUT (default qa/2026-10-20-fb045-lan2).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const TAG = process.env.QA_TAG || 'before';
const OUT = path.resolve(import.meta.dirname, '../../../', process.env.QA_OUT || 'qa/2026-10-20-fb045-lan2');
fs.mkdirSync(OUT, { recursive: true });
const PASSWORD = 'Abc123';
const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), target: BASE, tag: TAG, step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cachedLot = null; // workboard lot with container lines, reused across viewport runs

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: PASSWORD }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${identifier}: ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
  return body.token;
}

async function openAuthed(browser, identifier, url, viewport) {
  const token = await login(identifier);
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return page;
}

// Measure one element: cell box vs text lines vs overflow.
const MEASURE_FN = (surfaceSelector) => {
  // Intrinsic nowrap width of a cell's text under its own font/tracking —
  // the evidence for choosing column floors.
  const intrinsic = (el) => {
    const probe = document.createElement('span');
    const cs = getComputedStyle(el);
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font};letter-spacing:${cs.letterSpacing};text-transform:${cs.textTransform};`;
    probe.textContent = el.textContent.replace(/\s+/g, ' ').trim();
    document.body.appendChild(probe);
    const w = Math.round(probe.getBoundingClientRect().width);
    probe.remove();
    return w;
  };
  const measureCell = (el) => ({ ...innerMeasure(el), textW: intrinsic(el) });

  function innerMeasure(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((x) => x.height > 1 && x.width > 0.5);
    const lines = [];
    for (const x of rects) {
      const hit = lines.find((l) => Math.abs(l.top - x.top) < 5);
      if (hit) { hit.right = Math.max(hit.right, x.right); hit.left = Math.min(hit.left, x.left); }
      else lines.push({ top: x.top, left: x.left, right: x.right });
    }
    const box = el.getBoundingClientRect();
    const textRight = lines.reduce((m, l) => Math.max(m, l.right), 0);
    return {
      text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 48),
      srOnly: Boolean(el.querySelector('.sr-only')),
      cellW: Math.round(box.width),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      lineCount: lines.length,
      nowrapClipped: el.scrollWidth > el.clientWidth + 1,
      textPastCell: textRight > box.right + 1,
      textRight: Math.round(textRight),
      cellRight: Math.round(box.right),
    };
  };
  const tables = (surfaceSelector ? [...document.querySelectorAll(surfaceSelector)] : [...document.querySelectorAll('table')])
    .filter((t) => t.offsetParent !== null || t.getClientRects().length);
  const out = [];
  for (const table of tables) {
    const headers = [...table.querySelectorAll('thead th')].map(measureCell);
    const apptCells = [...table.querySelectorAll('tbody td[data-label="Giờ hẹn đóng/trả"], tbody th[data-label="Giờ hẹn đóng/trả"], tfoot td[data-label="Giờ hẹn đóng/trả"]')].slice(0, 3)
      .map((td) => measureCell(td.querySelector('.cus-appointment-trigger__text') ?? td));
    const scroll = table.closest('[class*="table-scroll"]');
    // Add-row editor controls in the Giờ hẹn cell (segmented datetime input is
    // min-width: max-content — it clips the column when the slice is too small).
    const apptInputs = [...table.querySelectorAll('tfoot td[data-label="Giờ hẹn đóng/trả"] input, tfoot td[data-label="Giờ hẹn đóng/trả"] [class*="seg"], tfoot td[data-label="Giờ hẹn đóng/trả"] fieldset')]
      .slice(0, 6)
      .map((el) => {
        const cell = el.closest('td');
        const r = el.getBoundingClientRect();
        const c = cell.getBoundingClientRect();
        return { cls: String(el.className || el.tagName).slice(0, 48), w: Math.round(r.width), cellW: Math.round(c.width), pastCell: r.right > c.right + 1 };
      });
    // FB-045 lan-2 defect class: a neighbor control spilling OUT of its cell
    // paints over the Giờ hẹn column (port selects, add-row Thêm/Hủy).
    const spillControls = [...table.querySelectorAll(
      '.dispatch-container-detail__port-select, .dispatch-container-detail__port-select .searchable-select__trigger, .cus-container-ledger__add-actions button, .cus-appointment-trigger, .cus-appointment-cell__copy, .cus-container-ledger__add-row input, .cus-container-ledger__add-row .searchable-select__trigger, .cus-container-ledger__add-row .date-seg-group',
    )]
      .slice(0, 16)
      .map((el) => {
        const cell = el.closest('td, th');
        const r = el.getBoundingClientRect();
        const c = cell ? cell.getBoundingClientRect() : r;
        return {
          cls: String(el.className || el.tagName).slice(0, 48),
          w: Math.round(r.width),
          cellW: cell ? Math.round(c.width) : null,
          pastCell: r.right > c.right + 1 || r.left < c.left - 1,
        };
      });
    out.push({
      isSurface: Boolean(surfaceSelector),
      tableClass: table.className,
      tableW: Math.round(table.getBoundingClientRect().width),
      scroll: scroll ? { clientW: scroll.clientWidth, scrollW: scroll.scrollWidth, scrolls: scroll.scrollWidth > scroll.clientWidth + 1 } : null,
      headers,
      apptCells,
      apptInputs,
      spillControls,
    });
  }
  const dialog = document.querySelector('[role="dialog"], .drawer');
  return {
    dialogTitle: dialog?.querySelector('.drawer__title, [class*="title"]')?.textContent?.trim().slice(0, 60) ?? null,
    dialogW: dialog ? Math.round(dialog.getBoundingClientRect().width) : null,
    tables: out,
  };
};

// A table "fails FB-045" when any Giờ hẹn header is sheared/wrapped, or any
// Giờ hẹn value wraps/clips, or any other surface header is sheared mid-token.
function verdictFor(measure) {
  const problems = [];
  const surfaces = measure.tables.filter((x) => x.isSurface);
  if (surfaces.length === 0) problems.push('surface table not measured (drawer/page did not render) — verdict would be vacuous');
  for (const t of surfaces) {
    for (const h of t.headers) {
      const isAppt = /GIỜ HẸN/i.test(h.text);
      if (h.nowrapClipped && !h.srOnly) problems.push(`header sheared: "${h.text}" ${h.scrollW}>${h.clientW}`);
      if (isAppt && h.lineCount > 1) problems.push(`appt header ${h.lineCount} lines: "${h.text}"`);
      if (h.textPastCell && !h.srOnly) problems.push(`header text past cell: "${h.text}" ${h.textRight}>${h.cellRight}`);
    }
    for (const c of t.apptCells) {
      // A REAL datetime value must be one line; an empty placeholder renders
      // its own affordance text and is judged by the input spill check below.
      const hasValue = /\d{2}:\d{2}/.test(c.text);
      if (hasValue && c.lineCount > 1) problems.push(`appt value ${c.lineCount} lines: "${c.text}"`);
      if (c.nowrapClipped) problems.push(`appt value sheared: "${c.text}" ${c.scrollW}>${c.clientW}`);
      if (hasValue && c.textPastCell) problems.push(`appt value past cell: "${c.text}" ${c.textRight}>${c.cellRight}`);
    }
    for (const i of t.apptInputs || []) {
      if (i.pastCell) problems.push(`appt input past cell: "${i.cls}" ${i.w}>${i.cellW}`);
    }
    for (const s of t.spillControls || []) {
      if (s.pastCell) problems.push(`neighbor control spills its cell (paints over Giờ hẹn): "${s.cls}" w=${s.w} cell=${s.cellW}`);
    }
  }
  return problems;
}

async function waitForTable(page, selector, timeout = 12000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch {
    return false;
  }
}

// ── entry openers ─────────────────────────────────────────────────────────
async function openDispatchDrawer(page) {
  // Rows hydrate after the master-plan fetch — wait for the detail trigger.
  try {
    await page.waitForSelector('.master-plan-grid__container-detail-trigger, [aria-label*="chi tiết container" i]', { timeout: 25000 });
  } catch {
    return { clicked: null, ok: false, portSelects: 0, reason: 'no container-detail trigger within 25s' };
  }
  await sleep(400);
  // Prefer a lot whose port cells render the EDITABLE selects (fieldAccess
  // DIRECT) — the FB-045 overlap channel only exists there. Try up to 4 rows.
  let last = { clicked: null, ok: false, portSelects: 0 };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const clicked = await page.evaluate((idx) => {
      const els = [...document.querySelectorAll('.master-plan-grid__container-detail-trigger, button, a, [role="button"]')]
        .filter((b) => /chi tiết container/i.test((b.getAttribute('title') || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')));
      const el = els[idx];
      if (!el) return null;
      el.click();
      return (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().slice(0, 60);
    }, attempt);
    if (!clicked) return last;
    const ok = await waitForTable(page, '.dispatch-container-detail__table', 10000);
    const portSelects = ok ? await page.evaluate(() => document.querySelectorAll('select.dispatch-container-detail__port-select, .dispatch-container-detail__port-select').length) : 0;
    last = { clicked, ok, portSelects };
    if (ok && portSelects > 0) return last;
    // Only close and retry when another row exists — otherwise the drawer
    // must stay OPEN so the measurement after the opener is real.
    const hasNext = await page.evaluate((idx) => {
      const els = [...document.querySelectorAll('.master-plan-grid__container-detail-trigger, button, a, [role="button"]')]
        .filter((b) => /chi tiết container/i.test((b.getAttribute('title') || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')));
      return Boolean(els[idx + 1]);
    }, attempt);
    if (!hasNext) return last;
    await page.evaluate(() => { const c = document.querySelector('.drawer__close'); if (c) c.click(); });
    await sleep(600);
  }
  return last;
}

async function openShipmentsDrawer(page) {
  // Scan the workboard's own list (its default filters/ordering) across a few
  // pages; for each row fetch the cus-workspace detail and pick a lot that HAS
  // container lines (lot-level rows open a ledger-less drawer), preferring one
  // with a customer appointment so the Giờ hẹn VALUE is measurable too.
  // The first successful scan is cached across viewport iterations.
  if (cachedLot) {
    await page.goto(`${BASE}/shipments${cachedLot.pageNo > 1 ? `?page=${cachedLot.pageNo}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  let target = cachedLot;
  let done = Boolean(cachedLot);
  // Wide transport-date scope so lots outside the default month (incl. ones
  // carrying a customer appointment) enter the scanned list.
  const SCOPE = 'transportDateFrom=2020-01-01&transportDateTo=2030-12-31';
  for (let attempt = 0; attempt < 2 && !done; attempt += 1) {
  for (let pageNo = 1; pageNo <= 4 && !done; pageNo += 1) {
    if (pageNo > 1 || true) {
      await page.goto(`${BASE}/shipments?${SCOPE}&page=${pageNo}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    try {
      await page.waitForSelector('[id^="cus-inline-identity-"]', { timeout: 30000 });
    } catch {
      log('shipments-drawer-recon', { page: pageNo, note: 'no rows rendered' });
      break;
    }
    const rows = await page.evaluate(() => [...document.querySelectorAll('tr')]
      .map((tr) => {
        const btn = tr.querySelector('button[aria-label^="Mở chi tiết lô hàng"]');
        const idCell = tr.querySelector('[id^="cus-inline-identity-"]');
        if (!btn || !idCell) return null;
        return idCell.id.replace('cus-inline-identity-', '');
      })
      .filter(Boolean));
    for (const id of rows) {
      const cand = await page.evaluate(async (rowId) => {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/shipments/cus-workspace/${rowId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return null;
        const d = await res.json();
        const containers = d.containers || [];
        if (containers.length === 0) return null;
        return { id: rowId, containers: containers.length, appointments: containers.filter((c) => c.customerAppointmentAt).length };
      }, id);
      if (!cand) continue;
      cand.pageNo = pageNo;
      if (cand.appointments > 0) { target = cand; done = true; break; }
      if (!target) target = cand;
    }
  }
  }
  log('shipments-drawer-recon', { target });
  if (!target) return { clicked: null, ok: false, reason: 'no lot with container lines in 4 workboard pages' };
  cachedLot = target;
  // Land on the page that carries the target row (default filters preserved).
  if (target.pageNo > 1 || true) {
    await page.goto(`${BASE}/shipments?${SCOPE}&page=${target.pageNo}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  try {
    await page.waitForSelector(`#cus-inline-identity-${target.id}`, { timeout: 20000 });
  } catch {
    return { clicked: null, ok: false, target, reason: 'target row not rendered after paging' };
  }
  await sleep(400);
  const clicked = await page.evaluate((id) => {
    const cell = document.querySelector(`#cus-inline-identity-${id}`);
    const row = cell?.closest('tr');
    const btn = row?.querySelector('button[aria-label^="Mở chi tiết lô hàng"]') || document.querySelector('button[aria-label^="Mở chi tiết lô hàng"]');
    if (!btn) return null;
    btn.click();
    return btn.getAttribute('aria-label').slice(0, 60);
  }, target.id);
  const ok = await waitForTable(page, '.cus-container-table', 12000);
  // Open the add row so its segmented Giờ hẹn input is measured too (no submit).
  if (ok) {
    await page.evaluate(() => {
      const add = [...document.querySelectorAll('button')].find((b) => /^Thêm container$/i.test(b.textContent.trim()));
      if (add) add.click();
    });
    await sleep(500);
  }
  return { clicked, ok, target };
}

const ENTRIES = [
  { key: 'dispatch-drawer', user: process.env.QA_USER_A || 'dieuvan', path: '/dispatch', open: openDispatchDrawer, surface: '.dispatch-container-detail__table' },
  { key: 'shipments-drawer', user: process.env.QA_USER_B || 'cus', path: '/shipments', open: openShipmentsDrawer, surface: '.cus-container-table' },
  { key: 'shipments-detail', user: process.env.QA_USER_B || 'cus', path: '/shipments-detail', open: null, surface: 'table' },
  { key: 'dispatch-detail', user: process.env.QA_USER_A || 'dieuvan', path: '/dispatch-detail', open: null, surface: '.detailed-plan-grid' },
];
const VIEWPORTS = [
  { width: 1024, height: 820 },
  { width: 1280, height: 900 },
  { width: 1440, height: 1000 },
  { width: 1920, height: 1080 },
];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const only = process.env.QA_ENTRY;
const entries = only ? ENTRIES.filter((e) => e.key === only) : ENTRIES;
let failures = 0;
try {
  for (const entry of entries) {
    for (const vp of VIEWPORTS) {
      const step = `${entry.key}-w${vp.width}`;
      try {
        const page = await openAuthed(browser, entry.user, entry.path, vp);
        let opener = { clicked: 'no-dialog-entry', ok: true };
        if (entry.open) opener = await entry.open(page);
        else await waitForTable(page, entry.surface, 20000);
        await sleep(900);
        const measure = await page.evaluate(MEASURE_FN, entry.surface);
        const problems = verdictFor(measure);
        if (problems.length) failures += 1;
        log(step, {
          viewport: `${vp.width}x${vp.height}`,
          opener,
          dialogTitle: measure.dialogTitle,
          dialogW: measure.dialogW,
          tables: measure.tables.map((t) => ({
            isSurface: t.isSurface,
            tableClass: t.tableClass,
            tableW: t.tableW,
            scroll: t.scroll,
            headers: t.headers,
            apptCells: t.apptCells,
            apptInputs: t.apptInputs,
            spillControls: t.spillControls,
          })),
          verdict: problems.length === 0 ? 'PASS' : 'FAIL',
          problems,
        });
        await page.screenshot({ path: path.join(OUT, `${TAG}-${step}.png`), fullPage: false });
        await page.close();
      } catch (err) {
        failures += 1;
        log(`${step}-error`, { error: String(err).slice(0, 300) });
      }
    }
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(OUT, `${TAG}-probe-log.jsonl`), LOG.map((e) => JSON.stringify(e)).join('\n'));
}
log('done', { failures, out: OUT });
process.exit(failures > 0 ? 2 : 0);
