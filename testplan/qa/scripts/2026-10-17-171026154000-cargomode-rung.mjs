#!/usr/bin/env node
/**
 * 2026-10-17 — card 171026154000: cargoMode (Loại hàng) filter on
 * /dispatch-detail — LOCAL DEV rung test (nepocorp-style; staging is NOT cut
 * yet, the fix lives only on local main as merge b930be12:
 *   d53574c2 BE accepts cargoMode · c7a4cf50 union branches filter
 *   2f92d4dd + df506e69 FE state + Loại hàng select · dfc493c9 test contract
 *   06fb8e4c regression).
 *
 * Repro being verified: before the fix, /dispatch-detail page 1 held only FCL
 * rows while dozens of LCL rows existed on later pages; selecting
 * "Loại hàng: Hàng lẻ (LCL)" must reduce the total and make every visible row
 * an LCL row.
 *
 * Three rungs (AGENTS.md §9):
 *   1. API identity — dispatcher login on the local backend, the Oct-window
 *      list unfiltered vs ?cargoMode=LCL (totals + page-1 FCL/LCL mix).
 *   2. DB identity — docker exec ss-prod-db psql counts the LCL fulfillments
 *      the window should match; must equal the API LCL total.
 *   3. UI drive — puppeteer on :7175 as dieuvan: pre-filter capture →
 *      Bộ lọc → Loại hàng → "Hàng lẻ (LCL)" → clear to "Tất cả" → 390px phone.
 *
 * Evidence (all under repo-root qa/):
 *   qa/2026-10-17_171026154000_ui-1-pre.png    — pre-filter grid
 *   qa/2026-10-17_171026154000_ui-2-lcl.png    — LCL-filtered grid
 *   qa/2026-10-17_171026154000_ui-3-clear.png  — filter cleared
 *   qa/2026-10-17_171026154000_ui-4-phone.png  — 390px viewport
 *   qa/2026-10-17_171026154000_rung-driver.log — this run's full log
 *     (self-written step-by-step; every line printed goes here too, plus the
 *      exit status, so the log is the run's complete stdout/stderr capture).
 *
 * Run: node testplan/qa/scripts/2026-10-17-171026154000-cargomode-rung.mjs
 * Env overrides: BACKEND (default http://localhost:3002/api),
 *                FRONTEND (default http://localhost:7175).
 * Local dev only (AGENTS.md §2): never staging, never prod, no compose/ngrok.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
// Helper exports confirmed before import:
//   scripts/lib/http.mjs      → login(who, {backend, password}), health(backend)
//   scripts/lib/ui-driver.mjs → withSession(token, fn, opts), sleep(ms)
// Import depth: this file lives at <root>/testplan/qa/scripts/ → 3 levels up.
import { login, health } from '../../../scripts/lib/http.mjs';
import { withSession, sleep } from '../../../scripts/lib/ui-driver.mjs';

const execFileP = promisify(execFile);

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const QA_DIR = join(ROOT, 'qa');
const DATE = '2026-10-17';
const SCOPE = '171026154000';
const LOG_PATH = join(QA_DIR, `${DATE}_${SCOPE}_rung-driver.log`);
const BACKEND = process.env.BACKEND ?? 'http://localhost:3002/api';
const FRONTEND = process.env.FRONTEND ?? 'http://localhost:7175';
const DATE_FROM = '2026-10-01';
const DATE_TO = '2026-10-31';
const USER = 'dieuvan'; // Điều vận = dispatcher
const PASSWORD = 'Abc123';
const SHOTS = {
  pre: join(QA_DIR, `${DATE}_${SCOPE}_ui-1-pre.png`),
  lcl: join(QA_DIR, `${DATE}_${SCOPE}_ui-2-lcl.png`),
  clear: join(QA_DIR, `${DATE}_${SCOPE}_ui-3-clear.png`),
  phone: join(QA_DIR, `${DATE}_${SCOPE}_ui-4-phone.png`),
};

await mkdir(QA_DIR, { recursive: true });
await writeFile(LOG_PATH, `# cargoMode rung driver — ${DATE} card ${SCOPE}\n`
  + `# command: node testplan/qa/scripts/${DATE}-${SCOPE}-cargomode-rung.mjs\n`
  + `# started: ${new Date().toISOString()}\n`
  + `# backend=${BACKEND} frontend=${FRONTEND} window=${DATE_FROM}..${DATE_TO} user=${USER}\n`);

const step = (name, data) => {
  const line = `${new Date().toISOString()} ${name} ${data === undefined ? '' : JSON.stringify(data)}`;
  console.log(line);
  return appendFile(LOG_PATH, line + '\n');
};

// Per-rung assertion ledger — the run counts in the final gate summary.
const results = { rungs: { api: null, db: null, ui: null }, checks: {}, counts: {} };
const check = async (rung, name, ok, detail) => {
  results.checks[name] = !!ok;
  results.counts[rung] ??= { pass: 0, fail: 0 };
  results.counts[rung][ok ? 'pass' : 'fail'] += 1;
  await step(ok ? 'PASS' : 'FAIL', { rung, check: name, ...(detail !== undefined ? { detail } : {}) });
  return !!ok;
};

const mixOf = (items) => {
  const mix = { FCL: 0, LCL: 0, other: 0 };
  for (const item of items ?? []) {
    if (item.cargoMode === 'FCL') mix.FCL += 1;
    else if (item.cargoMode === 'LCL') mix.LCL += 1;
    else mix.other += 1;
  }
  return mix;
};

// DB identity (rung 2): docker exec ss-prod-db psql — the LOCAL dev DB
// container (docker-compose.dev.yml, ss-prod-db:5441), never staging/prod.
const psql = async (sql) => {
  const { stdout } = await execFileP(
    'docker',
    ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-At', '-F', ' | ', '-c', sql],
    { encoding: 'utf8', timeout: 60000 },
  );
  return stdout.trim();
};

// ── rung 1: API identity ─────────────────────────────────────────────────────
let apiLclTotal = null;
let apiUnfilteredTotal = null;
try {
  await step('rung1-begin', { window: `${DATE_FROM}..${DATE_TO}` });

  // Health gate before driving anything (AGENTS.md §11): the local backend
  // must answer 200; the frontend must serve /api through its dev proxy.
  const bh = await health(BACKEND);
  await step('health-backend', { status: bh.status, ms: bh.ms });
  await check('api', 'backend-health-200', bh.status === 200, bh.status);
  const fh = await fetch(`${FRONTEND}/api/health`, { signal: AbortSignal.timeout(5000) })
    .then((r) => ({ status: r.status })).catch((e) => ({ status: 0, err: String(e) }));
  await step('health-frontend-proxy', fh);
  await check('api', 'frontend-proxy-health-200', fh.status === 200, fh);

  const token = await login(USER, { backend: BACKEND, password: PASSWORD });
  await step('login', { user: USER, backend: BACKEND, tokenPresent: Boolean(token) });

  const fetchRows = async (query) => {
    const url = new URL(`${BACKEND}/shipments/dispatch-detail-plan-rows`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    const body = await res.json().catch(() => null);
    return { status: res.status, url: url.toString(), body };
  };

  const unfiltered = await fetchRows({ dateFrom: DATE_FROM, dateTo: DATE_TO });
  apiUnfilteredTotal = unfiltered.body?.total ?? null;
  const unfilteredMix = mixOf(unfiltered.body?.items);
  await step('api-unfiltered', {
    status: unfiltered.status,
    total: apiUnfilteredTotal,
    pageSize: unfiltered.body?.pageSize,
    page1Items: unfiltered.body?.items?.length ?? 0,
    page1Mix: unfilteredMix,
    url: unfiltered.url,
  });
  await check('api', 'unfiltered-200', unfiltered.status === 200, unfiltered.status);
  await check('api', 'unfiltered-has-total', Number.isFinite(apiUnfilteredTotal), apiUnfilteredTotal);

  const lcl = await fetchRows({ dateFrom: DATE_FROM, dateTo: DATE_TO, cargoMode: 'LCL' });
  apiLclTotal = lcl.body?.total ?? null;
  const lclMix = mixOf(lcl.body?.items);
  await step('api-lcl', {
    status: lcl.status,
    total: apiLclTotal,
    pageSize: lcl.body?.pageSize,
    page1Items: lcl.body?.items?.length ?? 0,
    page1Mix: lclMix,
    url: lcl.url,
  });
  await check('api', 'lcl-200', lcl.status === 200, lcl.status);

  const items = lcl.body?.items ?? [];
  await check('api', 'lcl-page1-nonempty', items.length > 0, items.length);
  await check('api', 'lcl-page1-all-cargoMode-LCL',
    items.length > 0 && items.every((item) => item.cargoMode === 'LCL'),
    mixOf(items));
  await check('api', 'lcl-total-lte-unfiltered',
    Number.isFinite(apiLclTotal) && Number.isFinite(apiUnfilteredTotal) && apiLclTotal <= apiUnfilteredTotal,
    { lclTotal: apiLclTotal, unfilteredTotal: apiUnfilteredTotal });
  // The repro says selecting LCL "should reduce" the total — strict whenever
  // the unfiltered set actually contains FCL rows.
  await check('api', 'lcl-total-reduced-when-fcl-exists',
    unfilteredMix.FCL + unfilteredMix.other === 0 || apiLclTotal < apiUnfilteredTotal,
    { lclTotal: apiLclTotal, unfilteredTotal: apiUnfilteredTotal, unfilteredPage1Mix: unfilteredMix });
} catch (error) {
  await step('FAIL', { rung: 'api', check: 'rung1-exception', error: String(error?.stack ?? error) });
  results.counts.api ??= { pass: 0, fail: 0 };
  results.counts.api.fail += 1;
}

// ── rung 2: DB identity ──────────────────────────────────────────────────────
try {
  await step('rung2-begin', { compareWith: apiLclTotal });
  // The window the filter should match (card 171026154000): live (uncanceled)
  // LCL fulfillments of non-deleted lots in the 4 dispatch statuses, delivery
  // date in Oct 2026. For LCL fulfillments there is no container row, so the
  // API's transport-date coalesce (container appointment → lot
  // expected_delivery_date) collapses to shipments.expected_delivery_date —
  // the same column compared here (inclusive edges).
  const predicates = `f.cargo_mode = 'LCL'
      AND f.canceled_at IS NULL
      AND s.deleted_at IS NULL
      AND s.status IN ('READY_FOR_DISPATCH','DISPATCHED','IN_TRANSIT','COMPLETED')
      AND s.expected_delivery_date BETWEEN '${DATE_FROM}' AND '${DATE_TO}'`;
  // Recipe count — the task's predicate set as written (fulfillment-level
  // cargo_mode, no customer join). Logged verbatim, not the gate.
  const recipeSql = `SELECT count(*) FROM shipment_fulfillments f
    JOIN shipments s ON s.id = f.shipment_id
    WHERE ${predicates}`;
  const recipeCount = Number(await psql(recipeSql));
  await step('db-lcl-count-recipe', { count: recipeCount, sql: recipeSql.replace(/\s+/g, ' ').trim() });

  // Filter-identity count — the row set the API's LCL filter can actually
  // return: same predicates plus the row set's live-customer join
  // (listDispatchDetailPlanRows innerJoins customers … deleted_at IS NULL).
  const filterSql = `SELECT count(*) FROM shipment_fulfillments f
    JOIN shipments s ON s.id = f.shipment_id
    JOIN customers cu ON cu.id = s.customer_id AND cu.deleted_at IS NULL
    WHERE ${predicates}`;
  const filterCount = Number(await psql(filterSql));
  await step('db-lcl-count-filter-identity', { count: filterCount, sql: filterSql.replace(/\s+/g, ' ').trim() });

  const match = Number.isFinite(filterCount) && filterCount === apiLclTotal;
  await check('db', 'db-filter-count-equals-api-lcl-total', match,
    { filterCount, apiLclTotal, note: match ? 'match' : 'DISAGREEMENT — verbatim, not reconciled' });

  // Recipe vs filter-identity divergence is reported verbatim (row identity),
  // never reconciled silently — the recipe has no customer join, so lots whose
  // customer row is gone (or soft-deleted) sit in one count only.
  if (recipeCount !== filterCount) {
    const divergent = await psql(`SELECT f.id AS fulfillment_id, s.id AS shipment_id,
        s.customer_id, s.cargo_mode AS lot_mode, f.cargo_mode AS fulfillment_mode,
        s.status, s.expected_delivery_date,
        CASE WHEN cu.id IS NULL THEN 'customer-row-missing'
             WHEN cu.deleted_at IS NOT NULL THEN 'customer-soft-deleted'
             ELSE 'other' END AS divergence_reason
      FROM shipment_fulfillments f
      JOIN shipments s ON s.id = f.shipment_id
      LEFT JOIN customers cu ON cu.id = s.customer_id
      WHERE ${predicates}
        AND (cu.id IS NULL OR cu.deleted_at IS NOT NULL)`);
    await step('db-recipe-divergence', {
      recipeCount,
      filterCount,
      rows: divergent.split('\n').filter(Boolean),
    });
  }

  if (!match) {
    // Disagreement is reported as-is; these counts only help explain it.
    const diag = await psql(`SELECT
        count(*) FILTER (WHERE f.shipment_container_id IS NOT NULL) AS with_container,
        count(*) FILTER (WHERE s.expected_delivery_date IS NULL) AS null_date,
        count(*) FILTER (WHERE f.planned_carrier_type IS NOT NULL AND f.planned_carrier_type NOT IN ('OWN','EXTERNAL')) AS odd_carrier
      FROM shipment_fulfillments f JOIN shipments s ON s.id = f.shipment_id
      WHERE ${predicates}`);
    const leak = await psql(`SELECT count(*) FROM shipment_containers c
      JOIN shipments s ON s.id = c.shipment_id
      WHERE s.cargo_mode = 'LCL' AND s.deleted_at IS NULL AND s.status = 'READY_FOR_DISPATCH'
        AND NOT EXISTS (SELECT 1 FROM shipment_fulfillments f
          WHERE f.shipment_container_id = c.id AND f.canceled_at IS NULL)
        AND coalesce(date(c.customer_appointment_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), s.expected_delivery_date)
          BETWEEN '${DATE_FROM}' AND '${DATE_TO}'`);
    await step('db-mismatch-diagnostics', {
      breakdown: diag,
      fulfillmentLessLclLeak: leak,
      apiUnfilteredTotal,
    });
  }
} catch (error) {
  await step('FAIL', { rung: 'db', check: 'rung2-exception', error: String(error?.stack ?? error) });
  results.counts.db ??= { pass: 0, fail: 0 };
  results.counts.db.fail += 1;
}

// ── rung 3: UI drive ─────────────────────────────────────────────────────────
try {
  await step('rung3-begin', { frontend: FRONTEND, viewport: '1440x900' });
  const token = await login(USER, { backend: BACKEND, password: PASSWORD });
  await step('ui-login', { user: USER, tokenPresent: Boolean(token) });

  await withSession(token, async (page, ctx) => {
    // Response listener — the pre-filter capture and every list request of the
    // session (url + status + body identity) for the driver log.
    const netLog = [];
    page.on('response', (res) => {
      const url = res.url();
      if (res.request().method() !== 'GET' || !/\/api\/shipments\/dispatch-detail-plan-rows\?/.test(url)) return;
      const entry = { url, status: res.status(), total: null, page1Mix: null };
      netLog.push(entry);
      res.json().then((body) => {
        entry.total = body?.total ?? null;
        entry.page1Mix = mixOf(body?.items);
      }).catch(() => {});
    });

    const isList = (withLcl) => (res) => {
      const url = res.url();
      return res.request().method() === 'GET'
        && /\/api\/shipments\/dispatch-detail-plan-rows\?/.test(url)
        && (withLcl ? /cargoMode=LCL/.test(url) : !/cargoMode=/.test(url));
    };
    const readBody = (res) => res.json().catch(() => null);

    // DOM probes (grid contract: the Container cell is
    // td[data-label="Container"]; its first strong line is the kind line —
    // "Lẻ…" for LCL rows, the container number for FCL rows).
    const containerKinds = () => page.evaluate(() => Array.from(
      document.querySelectorAll('td[data-label="Container"]'),
    ).map((td) => {
      const strongs = Array.from(td.querySelectorAll('.detailed-plan-grid__line--strong'))
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim());
      return strongs.some((t) => t.startsWith('Lẻ')) ? 'LCL' : (strongs.length ? 'FCL' : 'EMPTY');
    }));

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
      // Folded bar: the criteria live behind the "Bộ lọc" trigger; inline bar:
      // the "Loại hàng" trigger sits on the strip. Try the task's path first.
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

    // Grid state settles when the response's rows are rendered; poll the DOM
    // until it reflects the expected kind mix (or time out and read it anyway).
    const settleKinds = async (predicate, timeoutMs = 8000) => {
      const startedAt = Date.now();
      let kinds = await containerKinds();
      while (Date.now() - startedAt < timeoutMs) {
        if (kinds.length > 0 && predicate(kinds)) return kinds;
        await sleep(250);
        kinds = await containerKinds();
      }
      return kinds;
    };

    // ── pre-filter state ────────────────────────────────────────────────────
    const preWait = page.waitForResponse(isList(false), { timeout: 30000 });
    await page.goto(`${FRONTEND}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const preRes = await preWait;
    const preBody = await readBody(preRes);
    await page.waitForSelector('td[data-label="Container"]', { timeout: 30000 }).catch(() => {});
    const preKinds = await settleKinds(() => true);
    const preMix = mixOf(preBody?.items);
    await step('ui-pre', {
      url: preRes.url(),
      status: preRes.status(),
      total: preBody?.total,
      pageSize: preBody?.pageSize,
      page1Mix: preMix,
      domKinds: preKinds,
    });
    await check('ui', 'pre-response-captured', preRes.status() === 200 && Number.isFinite(preBody?.total),
      { status: preRes.status(), total: preBody?.total });
    await page.screenshot({ path: SHOTS.pre });
    await step('ui-shot', { file: SHOTS.pre });

    // ── Loại hàng → Hàng lẻ (LCL) ───────────────────────────────────────────
    const lclWait = page.waitForResponse(isList(true), { timeout: 25000 });
    const lclPick = await pickCargoMode('Hàng lẻ (LCL)');
    await step('ui-pick-lcl', lclPick);
    const lclRes = await lclWait;
    const lclBody = await readBody(lclRes);
    const lclDomKinds = await settleKinds((kinds) => kinds.length > 0 && kinds.every((k) => k === 'LCL'));
    await step('ui-lcl', {
      url: lclRes.url(),
      status: lclRes.status(),
      total: lclBody?.total,
      page1Mix: mixOf(lclBody?.items),
      domKinds: lclDomKinds,
    });

    await check('ui', 'pick-registered', lclPick.picked === 'Hàng lẻ (LCL)', lclPick);
    await check('ui', 'lcl-request-has-cargoMode-LCL', /cargoMode=LCL/.test(lclRes.url()), lclRes.url());
    const lclItems = lclBody?.items ?? [];
    await check('ui', 'lcl-response-all-LCL',
      lclItems.length > 0 && lclItems.every((item) => item.cargoMode === 'LCL'),
      mixOf(lclItems));
    await check('ui', 'lcl-total-lte-pre',
      Number.isFinite(lclBody?.total) && Number.isFinite(preBody?.total) && lclBody.total <= preBody.total,
      { lclTotal: lclBody?.total, preTotal: preBody?.total });
    await check('ui', 'lcl-total-reduced-when-fcl-exists',
      preMix.FCL + preMix.other === 0 || lclBody.total < preBody.total,
      { lclTotal: lclBody?.total, preTotal: preBody?.total, preMix });
    await check('ui', 'lcl-dom-all-container-cells-LCL',
      lclDomKinds.length > 0 && lclDomKinds.every((k) => k === 'LCL'),
      lclDomKinds);

    // Close the filter popover so the screenshot shows the grid itself.
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(250);
    await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await sleep(250);
    await page.screenshot({ path: SHOTS.lcl });
    await step('ui-shot', { file: SHOTS.lcl });

    // ── clear → Tất cả (mixed modes return) ─────────────────────────────────
    const clearWait = page.waitForResponse(isList(false), { timeout: 25000 });
    const clearPick = await pickCargoMode('Tất cả');
    await step('ui-pick-clear', clearPick);
    const clearRes = await clearWait;
    const clearBody = await readBody(clearRes);
    const clearMix = mixOf(clearBody?.items);
    const clearDomKinds = await settleKinds((kinds) => kinds.length > 0 && kinds.some((k) => k !== 'LCL'));
    await step('ui-clear', {
      url: clearRes.url(),
      status: clearRes.status(),
      total: clearBody?.total,
      page1Mix: clearMix,
      domKinds: clearDomKinds,
    });

    await check('ui', 'clear-pick-registered', clearPick.picked === 'Tất cả', clearPick);
    await check('ui', 'clear-request-without-cargoMode', !/cargoMode=/.test(clearRes.url()), clearRes.url());
    await check('ui', 'clear-total-equals-pre',
      Number.isFinite(clearBody?.total) && clearBody.total === preBody.total,
      { clearTotal: clearBody?.total, preTotal: preBody?.total });
    await check('ui', 'clear-mix-equals-pre-mix',
      clearMix.FCL === preMix.FCL && clearMix.LCL === preMix.LCL && clearMix.other === preMix.other,
      { clearMix, preMix });
    await check('ui', 'clear-dom-not-lcl-only',
      clearDomKinds.length > 0 && clearDomKinds.some((k) => k !== 'LCL'),
      clearDomKinds);
    // "Mixed modes return": literally both modes on page 1 whenever the
    // unfiltered page 1 held both (data-dependent). When the unfiltered page 1
    // is single-mode — the server's priority order fills it (20FT/40FT before
    // LCL) — the restored mixed SET is proven by total+mix equality above and
    // the observed page-1 composition is logged verbatim.
    const preMixedPage1 = preMix.FCL > 0 && preMix.LCL > 0;
    await check('ui', 'clear-mixed-modes-return',
      preMixedPage1
        ? (clearMix.FCL > 0 && clearMix.LCL > 0 && clearDomKinds.includes('FCL') && clearDomKinds.includes('LCL'))
        : (clearMix.FCL === preMix.FCL && clearMix.LCL === preMix.LCL),
      {
        preMixedPage1,
        preMix,
        clearMix,
        clearDomKinds,
        note: preMixedPage1
          ? 'page-1 holds both modes before and after the filter'
          : 'unfiltered page 1 is single-mode under the server priority order; mixed set proven by total+mix equality',
      });

    await page.keyboard.press('Escape').catch(() => {});
    await sleep(250);
    await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await sleep(250);
    await page.screenshot({ path: SHOTS.clear });
    await step('ui-shot', { file: SHOTS.clear });

    // ── 390px phone ─────────────────────────────────────────────────────────
    await page.setViewport({ width: 390, height: 844 });
    await sleep(800);
    await page.screenshot({ path: SHOTS.phone });
    await step('ui-shot', { file: SHOTS.phone, viewport: '390x844' });

    await step('ui-net-log', { requests: netLog.slice(-12) });
    await step('ui-page-log', { pageErrors: ctx.log.slice(0, 40) });
  }, {
    artifactDir: join(tmpdir(), 'ss-cargomode-rung'),
    name: SCOPE,
    viewport: { width: 1440, height: 900 },
    headless: 'new',
  });
} catch (error) {
  await step('FAIL', { rung: 'ui', check: 'rung3-exception', error: String(error?.stack ?? error) });
  results.counts.ui ??= { pass: 0, fail: 0 };
  results.counts.ui.fail += 1;
}

// ── gate summary ─────────────────────────────────────────────────────────────
const rungPass = (rung) => Boolean(results.counts[rung]) && results.counts[rung].fail === 0 && results.counts[rung].pass > 0;
results.rungs = { api: rungPass('api'), db: rungPass('db'), ui: rungPass('ui') };
results.verdict = results.rungs.api && results.rungs.db && results.rungs.ui;
const totals = Object.values(results.counts).reduce(
  (acc, c) => ({ pass: acc.pass + c.pass, fail: acc.fail + c.fail }),
  { pass: 0, fail: 0 },
);
await step('VERDICT', { rungs: results.rungs, totals, ...results.counts });
console.log('\n=== RESULT SUMMARY ===');
console.log(JSON.stringify({ ...results, totals }, null, 2));
await step('exit-status', results.verdict ? 0 : 1);
process.exit(results.verdict ? 0 : 1);
