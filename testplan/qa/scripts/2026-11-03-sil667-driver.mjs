// SIL-667 driver — UI DRIVEN inline PHÂN LOẠI save on /dispatch-detail.
//   PHASE=before  — pre-fix code: prove PATCH /dispatch-detail-plan-rows/null/plan
//                   fires (400) and capture exactly what the user sees.
//   PHASE=after   — fixed code: prove NO /null/ request, decompose + plan PATCH
//                   succeed, the grid shows Kẹp, and no error surface appears;
//                   the already-fulfilled row keeps working (AC3).
// Usage:
//   PHASE=before node testplan/qa/scripts/2026-11-03-sil667-driver.mjs
//   PHASE=after  node testplan/qa/scripts/2026-11-03-sil667-driver.mjs
import puppeteer from 'puppeteer';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PHASE = process.env.PHASE || 'before';
const API = process.env.QA_API || 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7175';
const OUT = path.resolve('testplan/qa/evidence/2026-11-03-sil667');
fs.mkdirSync(OUT, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(OUT, 'state.json'), 'utf8'));
const BRANCH = state.lots.find((l) => l.key === 'branch');
const OWNED = state.lots.find((l) => l.key === 'owned');

const LOG = [];
const NET = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (identifier, password = 'Abc123') => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const apiRow = async (token, cont) => {
  const rows = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&q=${cont.slice(0, 8)}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  return (rows.items ?? []).find((i) => i.container?.containerNumber === cont) ?? null;
};

const results = [];
let exitCode = 0;
const record = (id, pass, detail) => { results.push({ id, pass, detail }); log('RESULT', { id, pass, detail }); if (!pass) exitCode = 1; };

const token = await login('dungnv');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });

// React-controlled input handling happens inside `page.evaluate` blocks —
// native property setters keep React's controlled-value contract intact.

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const planRequests = [];
  const consoleErrors = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/shipments/dispatch-detail-plan-rows') && req.method() !== 'GET') {
      planRequests.push({ method: req.method(), url: url.replace(BASE, ''), at: new Date().toISOString() });
    }
  });
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200)); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const visibleErrorState = async () => page.evaluate(() => {
    const banner = Array.from(document.querySelectorAll('.dispatch-plan-page__error'))
      .find((el) => el.offsetParent !== null && (el.textContent || '').trim().length > 0);
    const toast = Array.from(document.querySelectorAll('.toast--error, .toast--warning'))
      .find((el) => el.offsetParent !== null);
    return {
      banner: banner ? banner.textContent.trim().slice(0, 220) : null,
      toast: toast ? toast.textContent.trim().slice(0, 220) : null,
    };
  });

  const rowText = (cont) => page.evaluate((c) => {
    const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr'))
      .find((r) => (r.textContent || '').includes(c));
    return row ? row.textContent : null;
  }, cont);

  const openGridAt = async (cont) => {
    await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('table.detailed-plan-grid', { timeout: 45000 });
    await sleep(800);
    // Scope the topbar month (defaults to the current month) onto 12/2026 so
    // the 25/12 fixture rows are listed: flip both Tháng segments 11 → 12,
    // keeping the day segments (01/12 → 30/12 covers the fixtures).
    const changed = await page.evaluate(() => {
      const segs = Array.from(document.querySelectorAll('input'))
        .filter((el) => /^(Tháng) — (Từ|Đến) ngày$/.test(el.getAttribute('aria-label') || ''));
      for (const el of segs) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '12');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return segs.length;
    });
    if (changed > 0) {
      await page.evaluate(() => document.activeElement?.blur?.());
      await sleep(2000);
    }
    // Quick search narrows to the fixture row.
    const search = await page.$('input[aria-label="Tìm nhanh"]');
    if (search) { await search.click({ clickCount: 3 }); await search.type(cont, { delay: 25 }); await sleep(1600); }
    const found = await page.evaluate((c) => Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).some((r) => (r.textContent || '').includes(c)), cont);
    if (!found) throw new Error(`row not found for ${cont} (date scope applied?)`);
  };

  /** Click "Sửa phân loại" on the row, then pick `value` from the inline select. */
  const inlineEditClassification = async (cont, value) => {
    const clicked = await page.evaluate((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr'))
        .find((r) => (r.textContent || '').includes(c));
      if (!row) return 'no-row';
      const cell = row.querySelector('td[data-label="Phân loại"]') ?? row;
      const btn = Array.from(cell.querySelectorAll('button'))
        .find((b) => (b.getAttribute('aria-label') || '').startsWith('Sửa phân loại'));
      if (!btn) return 'no-button';
      btn.click();
      return 'clicked';
    }, cont);
    if (clicked !== 'clicked') throw new Error(`edit button: ${clicked}`);
    await page.waitForFunction((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr'))
        .find((r) => (r.textContent || '').includes(c));
      return Boolean(row?.querySelector('td[data-label="Phân loại"] select'));
    }, { timeout: 10000 }, cont);
    await sleep(300);
    await page.evaluate(({ c, v }) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr'))
        .find((r) => (r.textContent || '').includes(c));
      const select = row.querySelector('td[data-label="Phân loại"] select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, v);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, { c: cont, v: value });
  };

  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });

  // ══════════════ 1) Branch row (chưa có fulfillment) ══════════════
  await openGridAt(BRANCH.cont);
  log('grid_open_branch', { cont: BRANCH.cont, text: (await rowText(BRANCH.cont))?.slice(0, 160) });
  const beforeText = await rowText(BRANCH.cont);
  record(`branch_row_lists_fulfillmentless_${PHASE}`, beforeText.includes('Đơn'), 'branch row shows Đơn (SINGLE) before the edit');

  planRequests.length = 0;
  consoleErrors.length = 0;
  await inlineEditClassification(BRANCH.cont, 'DOUBLE');
  log('inline_edit_branch', { cont: BRANCH.cont, phase: PHASE });
  // Wait for the save to settle (decompose + plan PATCH on after; 400 on before).
  await sleep(3500);
  const errAfterBranch = await visibleErrorState();
  const branchTextAfter = await rowText(BRANCH.cont);
  const nullReq = planRequests.filter((r) => r.url.includes('/null/'));
  const realPlanReqs = planRequests.filter((r) => /\/dispatch-detail-plan-rows\/\d+\/plan/.test(r.url));
  const decomposeReq = planRequests.filter((r) => r.url.includes('/decompose'));
  log('branch_network', { planRequests, errAfterBranch, showsKep: branchTextAfter.includes('Kẹp'), showsDon: branchTextAfter.includes('Đơn') });
  await shot(`2026-11-03_sil667_${PHASE}_branch-after-click.png`);

  if (PHASE === 'before') {
    record('before_null_patch_fires', nullReq.length > 0, nullReq.map((r) => `${r.method} ${r.url}`).join(' ; ') || 'no /null/ request captured');
    log('before_visible_error', errAfterBranch);
    log('before_console_errors', { consoleErrors: consoleErrors.slice(0, 5) });
    log('before_value_stays', { showsKep: branchTextAfter.includes('Kẹp'), showsDon: branchTextAfter.includes('Đơn') });
  } else {
    record('after_no_null_request', nullReq.length === 0, JSON.stringify(nullReq));
    record('after_decompose_fires', decomposeReq.length > 0 && !decomposeReq[0].url.includes('/null/'), decomposeReq.map((r) => `${r.method} ${r.url}`).join(' ; '));
    record('after_plan_patch_ok', realPlanReqs.some((r) => r.url.includes(`/dispatch-detail-plan-rows/${BRANCH.fulfillmentId ?? ''}`)) || realPlanReqs.length > 0, realPlanReqs.map((r) => `${r.method} ${r.url}`).join(' ; '));
    record('after_no_error_surface', errAfterBranch.banner == null && errAfterBranch.toast == null, JSON.stringify(errAfterBranch));
    record('after_grid_shows_kep', branchTextAfter.includes('Kẹp'), (branchTextAfter || '').slice(0, 160));
    // The inline save owns the select — the full Chỉnh sửa điều phối editor
    // modal must never auto-open over the grid mid-save (review F1).
    const modalOpen = await page.evaluate(() => Boolean(document.querySelector('.dispatch-assignment-dialog')));
    record('after_no_editor_modal', !modalOpen, modalOpen ? 'editor modal auto-opened during the inline save' : 'no editor modal during the inline save');

    // DB side-effect proof: a fresh ACTIVE fulfillment with DOUBLE exists for
    // the branch container.
    const db = execSync(`docker exec ss-prod-db psql -U postgres -d silversea -At -c "SELECT id, dispatch_classification, coalesce(canceled_at::text,'active') FROM shipment_fulfillments WHERE shipment_container_id = ${BRANCH.shipmentContainerId} ORDER BY id"`, { encoding: 'utf8' }).trim();
    log('branch_db_fulfillments', { db });
    const activeDouble = db.split('\n').some((line) => { const [, cls, act] = line.split('|'); return cls === 'DOUBLE' && act === 'active'; });
    record('after_db_active_fulfillment_double', activeDouble, db.replace(/\n/g, ' ; '));

    // API side-effect proof: the row now carries a real fulfillmentId + DOUBLE.
    const fresh = await apiRow(token, BRANCH.cont);
    record('after_api_row_saved', fresh != null && fresh.fulfillmentId != null && fresh.classification === 'DOUBLE', JSON.stringify({ fulfillmentId: fresh?.fulfillmentId, classification: fresh?.classification }));
  }

  // ══════════════ 2) Owned row (đã có fulfillment — AC3) ══════════════
  // The owned row already became Kẹp during the before run, so the after run
  // targets Kết hợp — either way the edit must save in one PATCH, no /null/.
  const OWNED_TARGET = PHASE === 'before' ? 'DOUBLE' : 'COMBINED';
  const OWNED_LABEL = PHASE === 'before' ? 'Kẹp' : 'Kết hợp';
  await openGridAt(OWNED.cont);
  log('grid_open_owned', { cont: OWNED.cont });
  planRequests.length = 0;
  consoleErrors.length = 0;
  await inlineEditClassification(OWNED.cont, OWNED_TARGET);
  await sleep(3000);
  const errAfterOwned = await visibleErrorState();
  const ownedTextAfter = await rowText(OWNED.cont);
  const ownedNull = planRequests.filter((r) => r.url.includes('/null/'));
  const ownedPlan = planRequests.filter((r) => /\/dispatch-detail-plan-rows\/\d+\/plan/.test(r.url));
  log('owned_network', { planRequests, errAfterOwned, showsTarget: ownedTextAfter.includes(OWNED_LABEL) });
  await shot(`2026-11-03_sil667_${PHASE}_owned-after-click.png`);

  record(`${PHASE}_owned_row_keeps_working`, ownedNull.length === 0 && ownedPlan.length > 0 && ownedTextAfter.includes(OWNED_LABEL) && errAfterOwned.banner == null,
    JSON.stringify({ nullReqs: ownedNull.length, planReqs: ownedPlan.length, target: OWNED_LABEL, shown: ownedTextAfter.includes(OWNED_LABEL), err: errAfterOwned }));
  const ownedFresh = await apiRow(token, OWNED.cont);
  record(`${PHASE}_owned_api_row_saved`, ownedFresh?.classification === OWNED_TARGET, JSON.stringify({ fulfillmentId: ownedFresh?.fulfillmentId, classification: ownedFresh?.classification }));
} finally {
  fs.writeFileSync(path.join(OUT, `2026-11-03_sil667_${PHASE}_driver.log`), LOG.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  await browser.close();
}

log('summary', { phase: PHASE, results, exitCode });
process.exit(exitCode);
