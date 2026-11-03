// SIL-669 driver — UI DRIVEN inline PHÂN LOẠI save on /dispatch-detail.
//
// Proves AC1 (one save ⇒ exactly one PATCH /dispatch-detail-plan-rows/:id/plan)
// and AC2/AC3 (no fake error surface on success; a REAL conflict still shows).
//
// Drive modes (all real UI on this checkout's dev build):
//   real-click        — pointer click on "Sửa phân loại" → RAC listbox pick.
//                       Baseline: a single genuine pick.
//   commit-injection  — the grid's own onChange seam invoked twice for the same
//                       pick (the programmatic-duplicate shape the staging
//                       network capture rode: two identical PATCHes, 200→409,
//                       fake banner+toast). Injected via the rendered select's
//                       React fiber — no app code is mocked.
//   decompose-window  — commit #1 on a fulfillment-less branch row (save rides
//                       the decompose), then a duplicate commit on the
//                       re-keyed fresh row's select while save #1 is still in
//                       flight (its closure holds the stale classification —
//                       the exact stale expectedFulfillmentVersion duplicate).
//
// To keep the in-flight window deterministic on a localhost stack, the driver
// delays /plan PATCH *response processing* by ~900ms (page-side fetch wrapper,
// disclosed here). The wire sees the same requests; the server still answers
// #1 before #2 arrives.
//
// Usage:
//   PHASE=before QA_BASE=http://localhost:7192 QA_API=http://localhost:3003/api node qa/2026-11-03-sil669/driver.mjs
//   PHASE=after  QA_BASE=http://localhost:7192 QA_API=http://localhost:3003/api node qa/2026-11-03-sil669/driver.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const PHASE = process.env.PHASE || 'before';
const API = process.env.QA_API || 'http://localhost:3003/api';
const BASE = process.env.QA_BASE || 'http://localhost:7192';
const OUT = path.resolve('qa/2026-11-03-sil669');
fs.mkdirSync(OUT, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(OUT, 'state.json'), 'utf8'));
const BRANCH_A = state.lots.find((l) => l.key === 'branchA');
const OWNED = state.lots.find((l) => l.key === 'owned');
const BRANCH_B = state.lots.find((l) => l.key === 'branchB');

const LOG = [];
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
const rivalWrite = async (token, row, classification) => {
  const res = await fetch(`${API}/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': `sil669-rival-${classification}-${row.fulfillmentId}` },
    body: JSON.stringify({
      expectedFulfillmentVersion: row.version,
      expectedShipmentVersion: row.shipmentVersion,
      carrierType: row.dispatch.carrierType ?? 'OWN',
      externalCarrierId: row.dispatch.carrierType === 'EXTERNAL' ? row.dispatch.externalCarrierId ?? null : null,
      plannedRevenue: row.estimates.plannedRevenue && row.estimates.plannedRevenue.trim() ? Number(row.estimates.plannedRevenue) : null,
      plannedCarrierCost: row.estimates.plannedCarrierCost && row.estimates.plannedCarrierCost.trim() ? Number(row.estimates.plannedCarrierCost) : null,
      classification,
      isCombined: classification === 'COMBINED',
    }),
  });
  return res.status;
};

const results = [];
let exitCode = 0;
const record = (id, pass, detail) => { results.push({ id, pass, detail }); log('RESULT', { id, pass, detail }); if (!pass) exitCode = 1; };

const token = await login('dungnv');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  // Every /plan PATCH + its HTTP status, in order — the AC1 network proof.
  const planTraffic = [];
  const decomposeTraffic = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (/\/api\/shipments\/dispatch-detail-plan-rows\/[^/]+\/plan$/.test(url)) {
      planTraffic.push({ method: res.request().method(), status: res.status(), url: url.replace(BASE, ''), at: new Date().toISOString() });
    }
    if (url.includes('/decompose')) {
      decomposeTraffic.push({ method: res.request().method(), status: res.status(), url: url.replace(BASE, ''), at: new Date().toISOString() });
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  // Deterministic in-flight window: hold /plan PATCH responses ~900ms before
  // the app processes them (disclosed; wire unchanged).
  await page.evaluateOnNewDocument(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
      const method = (args[1]?.method ?? (args[0] instanceof Request ? args[0].method : 'GET')).toUpperCase();
      if (method === 'PATCH' && url.includes('/plan')) {
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      return response;
    };
  });

  const visibleErrorState = () => page.evaluate(() => {
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
    const search = await page.$('input[aria-label="Tìm nhanh"]');
    if (search) { await search.click({ clickCount: 3 }); await search.type(cont, { delay: 25 }); await sleep(1600); }
    const found = await page.evaluate((c) => Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).some((r) => (r.textContent || '').includes(c)), cont);
    if (!found) throw new Error(`row not found for ${cont} (date scope applied?)`);
  };

  /** REAL pointer interaction — click "Sửa phân loại", click the RAC select
   *  trigger, click the option in the portalled listbox. */
  const realPickClassification = async (cont, optionLabel) => {
    const btn = await page.evaluateHandle((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr'))
        .find((r) => (r.textContent || '').includes(c));
      const cell = row?.querySelector('td[data-label="Phân loại"]') ?? row;
      return Array.from(cell?.querySelectorAll('button') ?? [])
        .find((b) => (b.getAttribute('aria-label') || '').startsWith('Sửa phân loại')) ?? null;
    }, cont);
    const btnEl = btn.asElement();
    if (!btnEl) throw new Error('Sửa phân loại button not found');
    let box = await btnEl.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr'))
        .find((r) => (r.textContent || '').includes(c));
      return Boolean(row?.querySelector('td[data-label="Phân loại"] button[data-uui-control="select"]'));
    }, { timeout: 10000 }, cont);
    await sleep(400);
    const trigger = await page.evaluateHandle((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr'))
        .find((r) => (r.textContent || '').includes(c));
      return row?.querySelector('td[data-label="Phân loại"] button[data-uui-control="select"]') ?? null;
    }, cont);
    const triggerEl = trigger.asElement();
    if (!triggerEl) throw new Error('select trigger not found');
    box = await triggerEl.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 });
    await sleep(500);
    const optionBox = await page.evaluate((label) => {
      const opt = Array.from(document.querySelectorAll('[role="listbox"] [role="option"]'))
        .find((o) => (o.textContent || '').trim() === label || (o.textContent || '').includes(label));
      if (!opt) return null;
      const r = opt.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, optionLabel);
    if (!optionBox) throw new Error(`option "${optionLabel}" not in listbox`);
    await page.mouse.click(optionBox.x, optionBox.y);
  };

  /** Invoke the grid's onChange seam on the row's inline Phân loại select —
   *  the boundary React Aria's selection commit feeds; a duplicate here is
   *  the programmatic-duplicate shape (bypasses RAC's same-value dedupe and
   *  the saving-disabled gate, exactly like the staging duplicate). */
  const injectCommit = async (cont, displayValue, value) => {
    const fired = await page.evaluate(({ c, dv, v }) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr'))
        .find((r) => (r.textContent || '').includes(c));
      if (!row) return 'no-row';
      const cell = row.querySelector('td[data-label="Phân loại"]');
      const select = Array.from(cell.querySelectorAll('select'))
        .find((s) => s.value === dv || s.selectedOptions[0]?.text === dv);
      if (!select) return 'no-select';
      const fiberKey = Object.keys(select).find((k) => k.startsWith('__reactFiber$'));
      let fiber = select[fiberKey];
      while (fiber) {
        if (typeof fiber.type === 'function' && fiber.type.name === 'UuiSelectField' && typeof fiber.memoizedProps?.onChange === 'function') {
          fiber.memoizedProps.onChange({ target: { value: v } });
          return 'fired';
        }
        fiber = fiber.return;
      }
      return 'no-fiber';
    }, { c: cont, dv: displayValue, v: value });
    if (fired !== 'fired') throw new Error(`injectCommit(${displayValue}): ${fired}`);
  };

  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });

  // ══ Scenario 1: REAL single pick on the branch row — baseline (both phases) ══
  await openGridAt(BRANCH_A.cont);
  record(`${PHASE}_baseline_branch_starts_don`, (await rowText(BRANCH_A.cont))?.includes('Đơn') === true, 'branch row shows Đơn before the edit');
  planTraffic.length = 0;
  decomposeTraffic.length = 0;
  await realPickClassification(BRANCH_A.cont, 'Kẹp');
  await sleep(3000);
  const errBaseline = await visibleErrorState();
  log('baseline_network', { planTraffic: [...planTraffic], errBaseline });
  await shot(`2026-11-03_sil669_${PHASE}_s1-baseline.png`);
  record(`${PHASE}_baseline_single_pick_one_patch`, planTraffic.length === 1, `${planTraffic.length} PATCH(es): ${planTraffic.map((r) => r.status).join(',') || 'none'}`);
  record(`${PHASE}_baseline_no_error_surface`, errBaseline.banner == null && errBaseline.toast == null, JSON.stringify(errBaseline));

  // ══ Scenario 2: SAME-PICK DUPLICATE on the owned row (commit-injection) ══
  await openGridAt(OWNED.cont);
  planTraffic.length = 0;
  decomposeTraffic.length = 0;
  // Open the inline editor with a real click, then present the pick twice —
  // the duplicate rides the same stale closures as the saving pick.
  {
    const btn = await page.evaluateHandle((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr'))
        .find((r) => (r.textContent || '').includes(c));
      const cell = row?.querySelector('td[data-label="Phân loại"]') ?? row;
      return Array.from(cell?.querySelectorAll('button') ?? [])
        .find((b) => (b.getAttribute('aria-label') || '').startsWith('Sửa phân loại')) ?? null;
    }, OWNED.cont);
    const btnEl = btn.asElement();
    if (!btnEl) throw new Error('owned: Sửa phân loại button not found');
    const box = await btnEl.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr'))
        .find((r) => (r.textContent || '').includes(c));
      return Boolean(row?.querySelector('td[data-label="Phân loại"] select'));
    }, { timeout: 10000 }, OWNED.cont);
    await page.evaluate(({ c, dv, v }) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr'))
        .find((r) => (r.textContent || '').includes(c));
      const select = row.querySelector('td[data-label="Phân loại"] select');
      const fiberKey = Object.keys(select).find((k) => k.startsWith('__reactFiber$'));
      let fiber = select[fiberKey];
      const calls = [];
      while (fiber) {
        if (typeof fiber.type === 'function' && fiber.type.name === 'UuiSelectField' && typeof fiber.memoizedProps?.onChange === 'function') {
          fiber.memoizedProps.onChange({ target: { value: v } });
          fiber.memoizedProps.onChange({ target: { value: v } }); // duplicate, same closures
          calls.push('x2');
          break;
        }
        fiber = fiber.return;
      }
      if (calls.length === 0) throw new Error('onChange seam not found');
    }, { c: OWNED.cont, dv: 'Đơn', v: 'DOUBLE' });
  }
  await sleep(3000);
  const errDup = await visibleErrorState();
  const dupText = await rowText(OWNED.cont);
  const dupOk = planTraffic.filter((r) => r.status >= 200 && r.status < 300);
  const dup409 = planTraffic.filter((r) => r.status === 409);
  log('duplicate_network', { planTraffic: [...planTraffic], errDup, showsKep: dupText?.includes('Kẹp') });
  await shot(`2026-11-03_sil669_${PHASE}_s2-duplicate.png`);
  if (PHASE === 'before') {
    record('before_duplicate_two_patches_200_then_409', planTraffic.length === 2 && dupOk.length === 1 && dup409.length === 1, JSON.stringify(planTraffic));
    record('before_duplicate_fake_error_shown', errDup.banner != null || errDup.toast != null, JSON.stringify(errDup));
  } else {
    record('after_duplicate_exactly_one_patch_ok', planTraffic.length === 1 && dupOk.length === 1 && dup409.length === 0, JSON.stringify(planTraffic));
    record('after_duplicate_no_error_surface', errDup.banner == null && errDup.toast == null, JSON.stringify(errDup));
    record('after_duplicate_grid_shows_kep', dupText?.includes('Kẹp') === true, (dupText || '').slice(0, 160));
  }
  const dupApi = await apiRow(token, OWNED.cont);
  record(`${PHASE}_duplicate_persisted_double`, dupApi?.classification === 'DOUBLE', JSON.stringify({ classification: dupApi?.classification, version: dupApi?.version }));

  // ══ Scenario 3: DECOMPOSE-WINDOW duplicate on branch row B ══
  await openGridAt(BRANCH_B.cont);
  planTraffic.length = 0;
  decomposeTraffic.length = 0;
  {
    const btn = await page.evaluateHandle((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr'))
        .find((r) => (r.textContent || '').includes(c));
      const cell = row?.querySelector('td[data-label="Phân loại"]') ?? row;
      return Array.from(cell?.querySelectorAll('button') ?? [])
        .find((b) => (b.getAttribute('aria-label') || '').startsWith('Sửa phân loại')) ?? null;
    }, BRANCH_B.cont);
    const btnEl = btn.asElement();
    if (!btnEl) throw new Error('branchB: Sửa phân loại button not found');
    const box = await btnEl.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr'))
        .find((r) => (r.textContent || '').includes(c));
      return Boolean(row?.querySelector('td[data-label="Phân loại"] select'));
    }, { timeout: 10000 }, BRANCH_B.cont);
    // Commit #1 (starts decompose + save), then the duplicate on the
    // re-keyed fresh row's select while save #1 is held in flight.
    await injectCommit(BRANCH_B.cont, 'Đơn', 'DOUBLE');
    // Wait for the decompose to re-key the row: a select displaying Kẹp
    // appears in the Phân loại cell (optimistic moved to the fresh key).
    await page.waitForFunction((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr'))
        .find((r) => (r.textContent || '').includes(c));
      const select = row?.querySelector('td[data-label="Phân loại"] select');
      return Boolean(select) && (select.selectedOptions[0]?.text === 'Kẹp');
    }, { timeout: 15000 }, BRANCH_B.cont);
    await injectCommit(BRANCH_B.cont, 'Kẹp', 'DOUBLE');
  }
  await sleep(3500);
  const errWin = await visibleErrorState();
  const winText = await rowText(BRANCH_B.cont);
  const winOk = planTraffic.filter((r) => r.status >= 200 && r.status < 300);
  const win409 = planTraffic.filter((r) => r.status === 409);
  log('decompose_window_network', { planTraffic: [...planTraffic], decomposeTraffic: [...decomposeTraffic], errWin, showsKep: winText?.includes('Kẹp') });
  await shot(`2026-11-03_sil669_${PHASE}_s3-decompose-window.png`);
  if (PHASE === 'before') {
    record('before_decompose_window_two_patches', planTraffic.length === 2 && winOk.length === 1 && win409.length === 1, JSON.stringify(planTraffic));
    record('before_decompose_window_fake_error', errWin.banner != null || errWin.toast != null, JSON.stringify(errWin));
  } else {
    record('after_decompose_window_one_patch', planTraffic.length === 1 && winOk.length === 1 && win409.length === 0, JSON.stringify(planTraffic));
    record('after_decompose_window_no_error_surface', errWin.banner == null && errWin.toast == null, JSON.stringify(errWin));
    record('after_decompose_window_persisted_kep', winText?.includes('Kẹp') === true, (winText || '').slice(0, 160));
  }
  const winApi = await apiRow(token, BRANCH_B.cont);
  record(`${PHASE}_decompose_window_persisted_double`, winApi?.classification === 'DOUBLE', JSON.stringify({ fulfillmentId: winApi?.fulfillmentId, classification: winApi?.classification }));

  // ══ Scenario 4 (PHASE=after): REAL conflict still surfaces (AC3) ══
  if (PHASE === 'after') {
    // Fresh page load so the grid holds the CURRENT server version, then a
    // rival write behind the UI's back makes the grid's copy stale.
    await openGridAt(OWNED.cont);
    const stale = await apiRow(token, OWNED.cont);
    const rivalStatus = await rivalWrite(token, stale, 'SINGLE');
    log('rival_write', { status: rivalStatus });
    if (rivalStatus >= 300) throw new Error(`rival write failed: ${rivalStatus}`);
    planTraffic.length = 0;
    // The grid still displays Kẹp (loaded before the rival write) — picking
    // Đơn is a real change from the user's view and a real conflict on the
    // wire (stale expectedFulfillmentVersion).
    await realPickClassification(OWNED.cont, 'Đơn');
    await sleep(3500);
    const errConflict = await visibleErrorState();
    log('conflict_network', { planTraffic: [...planTraffic], errConflict });
    await shot('2026-11-03_sil669_after_s4-conflict.png');
    const cOk = planTraffic.filter((r) => r.status >= 200 && r.status < 300);
    const c409 = planTraffic.filter((r) => r.status === 409);
    record('after_conflict_single_patch_409', planTraffic.length === 1 && c409.length === 1 && cOk.length === 0, JSON.stringify(planTraffic));
    record('after_conflict_error_shown', errConflict.banner != null || errConflict.toast != null, JSON.stringify(errConflict));
  }
} finally {
  fs.writeFileSync(path.join(OUT, `2026-11-03_sil669_${PHASE}_driver.log`), LOG.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  await browser.close();
}

log('summary', { phase: PHASE, results, exitCode });
process.exit(exitCode);
