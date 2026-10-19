#!/usr/bin/env node
/**
 * 2026-10-18 — card 171026154000 (C): "Gán xe nhóm" disabled reason on
 * /dispatch-detail — LOCAL DEV rung test (AGENTS.md §9; never staging/prod).
 *
 * The fix under drive (this worktree, Part C): with ONE LCL lot selected the
 * selection bar's "Gán xe nhóm" button must explain itself as REAL TEXT
 * ("Nhóm ghép cần ít nhất 2 lô — chọn thêm lô hàng lẻ."), carry
 * aria-disabled + aria-describedby pointing at that text, and guard its click
 * (no dialog, no API write). With TWO lots the reason disappears and the
 * button opens the group dialog. Part A (cargoMode filter) is exercised to
 * REACH the LCL rows: "Loại hàng → Hàng lẻ (LCL)".
 *
 * Rungs:
 *   1. API identity — dispatcher login; October LCL list ≥ 2 rows; capture
 *      the two driven shipments' identities for rung-2 comparison.
 *   2. DB identity (read-only change §9.3) — docker exec ss-prod-db psql
 *      snapshots the two driven shipments' cargo_mode / cost_group_id /
 *      cost_group_order BEFORE and AFTER the drive: identical = the guarded
 *      click and the dialog cancel wrote nothing.
 *   3. UI drive — puppeteer on :7186 as dieuvan (this worktree's vite):
 *      filter LCL → screenshot → select 1 lot → reason text + aria wiring
 *      asserted in DOM → click (no dialog, no non-GET /api request) →
 *      select 2nd lot → reason gone → click → dialog opens → Hủy → phone
 *      390px capture of the bar+reason.
 *
 * Evidence (repo-root qa/):
 *   qa/2026-10-18_171026154000_c_ui-1-lcl-grid.png
 *   qa/2026-10-18_171026154000_c_ui-2-one-lot-reason.png
 *   qa/2026-10-18_171026154000_c_ui-3-guarded-click.png
 *   qa/2026-10-18_171026154000_c_ui-4-dialog-open.png
 *   qa/2026-10-18_171026154000_c_ui-5-phone-reason.png
 *   qa/2026-10-18_171026154000_c_driver.log — complete step/assertion log
 *
 * Run: node testplan/qa/scripts/2026-10-18-171026154000-c-assign-reason.mjs
 * Env: BACKEND (default http://localhost:3002/api), FRONTEND (default
 *      http://localhost:7175).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { login, health } from '../../../scripts/lib/http.mjs';
import { withSession, sleep } from '../../../scripts/lib/ui-driver.mjs';

const execFileP = promisify(execFile);

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const QA_DIR = join(ROOT, 'qa');
const DATE = '2026-10-18';
const SCOPE = '171026154000_c';
const LOG_PATH = join(QA_DIR, `${DATE}_${SCOPE}_driver.log`);
const BACKEND = process.env.BACKEND ?? 'http://localhost:3002/api';
const FRONTEND = process.env.FRONTEND ?? 'http://localhost:7175';
const DATE_FROM = '2026-10-01';
const DATE_TO = '2026-10-31';
const USER = 'dieuvan';
const PASSWORD = 'Abc123';
const REASON_TEXT = 'Nhóm ghép cần ít nhất 2 lô — chọn thêm lô hàng lẻ.';
const SHOTS = {
  grid: join(QA_DIR, `${DATE}_${SCOPE}_ui-1-lcl-grid.png`),
  reason: join(QA_DIR, `${DATE}_${SCOPE}_ui-2-one-lot-reason.png`),
  guarded: join(QA_DIR, `${DATE}_${SCOPE}_ui-3-guarded-click.png`),
  dialog: join(QA_DIR, `${DATE}_${SCOPE}_ui-4-dialog-open.png`),
  phone: join(QA_DIR, `${DATE}_${SCOPE}_ui-5-phone-reason.png`),
};

await mkdir(QA_DIR, { recursive: true });
await writeFile(LOG_PATH, `# 171026154000 (C) assign-reason driver — ${DATE}\n`
  + `# command: node testplan/qa/scripts/${DATE}-${SCOPE}-assign-reason.mjs\n`
  + `# started: ${new Date().toISOString()}\n`
  + `# backend=${BACKEND} frontend=${FRONTEND} window=${DATE_FROM}..${DATE_TO} user=${USER}\n`);

const step = (name, data) => {
  const line = `${new Date().toISOString()} ${name} ${data === undefined ? '' : JSON.stringify(data)}`;
  console.log(line);
  return appendFile(LOG_PATH, line + '\n');
};

const results = { checks: {}, counts: {} };
const check = async (name, ok, detail) => {
  results.checks[name] = !!ok;
  const bucket = ok ? 'pass' : 'fail';
  results.counts[bucket] = (results.counts[bucket] ?? 0) + 1;
  await step(ok ? 'PASS' : 'FAIL', { check: name, ...(detail !== undefined ? { detail } : {}) });
  return !!ok;
};

const psql = async (sql) => {
  const { stdout } = await execFileP(
    'docker',
    ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-At', '-F', ' | ', '-c', sql],
    { encoding: 'utf8', timeout: 60000 },
  );
  return stdout.trim();
};

// ── rung 1: API identity ─────────────────────────────────────────────────────
const bh = await health(BACKEND);
await step('health-backend', { status: bh.status, ms: bh.ms });
await check('backend-health-200', bh.status === 200, bh.status);
const token = await login(USER, { backend: BACKEND, password: PASSWORD });
await step('login', { user: USER, tokenPresent: Boolean(token) });

const listUrl = new URL(`${BACKEND}/shipments/dispatch-detail-plan-rows`);
listUrl.searchParams.set('dateFrom', DATE_FROM);
listUrl.searchParams.set('dateTo', DATE_TO);
listUrl.searchParams.set('cargoMode', 'LCL');
const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
const listBody = await listRes.json().catch(() => null);
const items = listBody?.items ?? [];
await step('api-lcl', { status: listRes.status, total: listBody?.total, page1: items.length, url: listUrl.toString() });
await check('api-lcl-200', listRes.status === 200, listRes.status);
await check('api-lcl-page1-all-LCL', items.length > 0 && items.every((i) => i.cargoMode === 'LCL'), items.map((i) => i.cargoMode));
// Two drivable rows: prefer ungrouped business lots over QA leftovers.
const isLeftover = (i) => String(i.docs?.billNumber ?? '').startsWith('UI-') || String(i.docs?.billNumber ?? '').startsWith('329-LCL');
const ungrouped = items.filter((i) => i.costGroupId == null && !isLeftover(i));
const fallback = items.filter((i) => i.costGroupId == null);
const pool = ungrouped.length >= 2 ? ungrouped : fallback.length >= 2 ? fallback : items;
const picked = pool.slice(0, 2);
await check('api-two-drivable-rows', picked.length === 2, picked.map((i) => ({ id: i.shipmentId, bill: i.docs?.billNumber })));
const drivenIds = picked.map((i) => i.shipmentId);
await step('driven-rows', picked.map((i) => ({ shipmentId: i.shipmentId, bill: i.docs?.billNumber })));

// ── rung 2 (before): DB snapshot of the driven rows ─────────────────────────
const snapshotSql = (ids) => `SELECT s.id, s.cargo_mode, s.cost_group_id, s.cost_group_order, s.status
  FROM shipments s WHERE s.id IN (${ids.join(',')}) ORDER BY s.id`;
const dbBefore = await psql(snapshotSql(drivenIds));
await step('db-before', { sql: snapshotSql(drivenIds).replace(/\s+/g, ' ').trim(), rows: dbBefore.split('\n') });

// ── rung 3: UI drive ─────────────────────────────────────────────────────────
await withSession(token, async (page) => {
  // Track every non-GET /api request: the guarded click must fire none.
  const writes = [];
  page.on('request', (req) => {
    const method = req.method();
    if (method !== 'GET' && req.url().includes('/api/')) writes.push({ method, url: req.url() });
  });

  const isLclList = (res) => res.request().method() === 'GET'
    && /\/api\/shipments\/dispatch-detail-plan-rows\?/.test(res.url())
    && /cargoMode=LCL/.test(res.url());

  const clickVisible = async (selector, reSrc, exactText = null) => {
    const handle = await page.evaluateHandle(({ selector, reSrc, exactText }) => {
      const re = reSrc ? new RegExp(reSrc) : null;
      const nodes = Array.from(document.querySelectorAll(selector)).filter((el) => el.offsetParent !== null);
      const hit = exactText != null
        ? nodes.find((el) => (el.textContent || '').replace(/\s+/g, ' ').trim() === exactText)
        : nodes.find((el) => re.test((el.textContent || '').replace(/\s+/g, ' ').trim()));
      return hit ?? null;
    }, { selector, reSrc, exactText });
    const el = handle.asElement();
    if (!el) { await handle.dispose(); return null; }
    const label = await el.evaluate((node) => (node.textContent || '').replace(/\s+/g, ' ').trim());
    await el.click();
    await handle.dispose();
    return label;
  };

  const pickCargoMode = async (optionText) => {
    await clickVisible('button', '^Bộ lọc');
    await sleep(350);
    const trigger = await clickVisible('button', '^Loại hàng');
    if (!trigger) {
      await clickVisible('button', '^Bộ lọc');
      await sleep(350);
    }
    await sleep(250);
    const picked = await clickVisible('[role="option"]', null, optionText);
    return { trigger: trigger ?? null, picked };
  };

  const clickCheckbox = async (ariaLabel) => {
    const handle = await page.evaluateHandle((label) => Array.from(
      document.querySelectorAll('input[type="checkbox"][aria-label]'),
    ).find((el) => el.getAttribute('aria-label') === label) ?? null, ariaLabel);
    const el = handle.asElement();
    if (!el) { await handle.dispose(); return false; }
    await el.click();
    await handle.dispose();
    return true;
  };

  const barState = () => page.evaluate(() => {    const bar = document.querySelector('.lcl-selection-bar');
    if (!bar) return { bar: false };
    const reason = document.querySelector('#lcl-group-assign-reason');
    const assign = Array.from(bar.querySelectorAll('button'))
      .find((b) => (b.textContent || '').trim() === 'Gán xe nhóm') || null;
    return {
      bar: true,
      totals: (bar.querySelector('.lcl-selection-bar__totals')?.textContent || '').replace(/\s+/g, ' ').trim(),
      reasonText: reason ? (reason.textContent || '').trim() : null,
      reasonVisible: reason ? reason.offsetParent !== null || getComputedStyle(reason).visibility !== 'hidden' : false,
      assignAriaDisabled: assign ? assign.getAttribute('aria-disabled') : null,
      assignDescribedBy: assign ? assign.getAttribute('aria-describedby') : null,
      assignTitle: assign ? assign.getAttribute('title') : null,
    };
  });

  const waitBar = async (timeoutMs = 8000) => {
    const startedAt = Date.now();
    let state = await barState();
    while (!state.bar && Date.now() - startedAt < timeoutMs) {
      await sleep(200);
      state = await barState();
    }
    return state;
  };

  // Navigate + filter to the LCL scope.
  await page.goto(`${FRONTEND}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('td[data-label="Container"]', { timeout: 30000 }).catch(() => {});
  const lclWait = page.waitForResponse(isLclList, { timeout: 25000 });
  const lclPick = await pickCargoMode('Hàng lẻ (LCL)');
  await step('ui-pick-lcl', lclPick);
  const lclRes = await lclWait;
  await step('ui-lcl-response', { status: lclRes.status(), url: lclRes.url() });
  await sleep(1200); // grid settle
  await page.screenshot({ path: SHOTS.grid, fullPage: false });
  await step('ui-shot', { file: SHOTS.grid });

  // Select ONE lot — the reason must appear as text.
  const checkboxLabels = await page.evaluate(() => Array.from(
    document.querySelectorAll('input[type="checkbox"][aria-label^="Chọn lô"]'),
  ).filter((el) => el.offsetParent !== null).map((el) => el.getAttribute('aria-label')));
  await step('ui-checkboxes', { count: checkboxLabels.length, first: checkboxLabels[0] ?? null });
  await check('ui-lcl-checkboxes-present', checkboxLabels.length >= 2, checkboxLabels.length);

  await clickCheckbox(checkboxLabels[0]);
  const oneLot = await waitBar();
  await step('ui-one-lot-bar', oneLot);
  await check('ui-bar-visible-one-lot', oneLot.bar === true);
  await check('ui-reason-text-verbatim', oneLot.reasonText === REASON_TEXT, oneLot.reasonText);
  await check('ui-reason-is-visible-text', oneLot.reasonVisible === true, oneLot.reasonVisible);
  await check('ui-assign-aria-disabled', oneLot.assignAriaDisabled === 'true', oneLot.assignAriaDisabled);
  await check('ui-assign-described-by-reason', oneLot.assignDescribedBy === 'lcl-group-assign-reason', oneLot.assignDescribedBy);
  await check('ui-assign-title-action-purpose', oneLot.assignTitle === 'Gán xe nhóm trả ĐV', oneLot.assignTitle);
  await page.screenshot({ path: SHOTS.reason, fullPage: false });
  await step('ui-shot', { file: SHOTS.reason });

  // Guarded click: no dialog, no API write.
  const writesBefore = writes.length;
  await clickVisible('.lcl-selection-bar button', '^Gán xe nhóm$');
  await sleep(1500);
  const dialogAfterGuarded = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return dialog ? (dialog.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : null;
  });
  await step('ui-guarded-click', { dialog: dialogAfterGuarded, newApiWrites: writes.slice(writesBefore) });
  await check('ui-guarded-click-no-dialog', dialogAfterGuarded === null, dialogAfterGuarded);
  await check('ui-guarded-click-no-api-write', writes.length === writesBefore, writes.slice(writesBefore));
  await page.screenshot({ path: SHOTS.guarded, fullPage: false });
  await step('ui-shot', { file: SHOTS.guarded });

  // Select the SECOND lot — reason gone, click opens the dialog.
  await clickCheckbox(checkboxLabels[1]);
  await sleep(400);
  const twoLots = await barState();
  await step('ui-two-lots-bar', twoLots);
  await check('ui-reason-gone-two-lots', twoLots.reasonText === null, twoLots.reasonText);
  await check('ui-assign-enabled-two-lots', twoLots.assignAriaDisabled === null, twoLots.assignAriaDisabled);
  await clickVisible('.lcl-selection-bar button', '^Gán xe nhóm$');
  const startedDialogWait = Date.now();
  let dialogText = null;
  while (Date.now() - startedDialogWait < 8000 && dialogText === null) {
    await sleep(250);
    dialogText = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog ? (dialog.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) : null;
    });
  }
  await step('ui-dialog-open', { text: dialogText });
  await check('ui-dialog-opens-two-lots', dialogText !== null && dialogText.includes('Gán xe nhóm'), dialogText);
  await page.screenshot({ path: SHOTS.dialog, fullPage: false });
  await step('ui-shot', { file: SHOTS.dialog });

  // Cancel — the drive writes nothing.
  await clickVisible('[role="dialog"] button', '^Hủy$');
  await sleep(600);

  // Phone 390px: back to one selected lot, the reason must still read as text.
  await page.setViewport({ width: 390, height: 844 });
  await clickCheckbox(checkboxLabels[1]);
  await sleep(500);
  const phoneState = await waitBar();
  await step('ui-phone-one-lot-bar', phoneState);
  await check('ui-phone-reason-text', phoneState.reasonText === REASON_TEXT, phoneState.reasonText);
  await page.screenshot({ path: SHOTS.phone, fullPage: false });
  await step('ui-shot', { file: SHOTS.phone });

  await step('ui-writes-total', writes);
  await check('ui-no-api-writes-whole-drive', writes.length === 0, writes);
});

// ── rung 2 (after): DB snapshot must be byte-identical ──────────────────────
const dbAfter = await psql(snapshotSql(drivenIds));
await step('db-after', { rows: dbAfter.split('\n') });
await check('db-driven-rows-unchanged', dbBefore === dbAfter, { before: dbBefore.split('\n'), after: dbAfter.split('\n') });

await step('summary', results);
const failed = results.counts.fail ?? 0;
await appendFile(LOG_PATH, `# finished: ${new Date().toISOString()} pass=${results.counts.pass ?? 0} fail=${failed}\n`);
console.log(`DRIVER RESULT: pass=${results.counts.pass ?? 0} fail=${failed}`);
process.exit(failed === 0 ? 0 : 1);
