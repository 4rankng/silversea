#!/usr/bin/env node
/**
 * LCL-01 lan 2 (card 211026180528) — STAGING READ-ONLY probe.
 *
 * Fix lan 1 (454fab6b, in build 9aab78d2) put container-less LCL lots
 * outside the day triage. QA 18:05 still sees a lot on Tổng quan that is
 * missing on Chi tiết ⇒ a DIFFERENT shape still leaks. This probe diffs the
 * two screens' ACTUAL list responses (all pages) and reports every overview
 * lot missing from the detail default lens (and from detail bare, which
 * isolates rowSource exclusions from day-triage drops).
 *
 * READ-ONLY: GET + login only. No writes.
 *
 *   node testplan/qa/scripts/2026-10-21-lcl01-lan2-stg-probe.mjs
 *   BACKEND=https://vantai.tingting.vip/api QA_USER=tiepvv node …
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { login, api, DEFAULT_PASSWORD } from '../../../scripts/lib/http.mjs';

const BACKEND = process.env.BACKEND ?? 'https://vantai.tingting.vip/api';
const QA_USER = process.env.QA_USER ?? 'tiepvv';
const OUT = 'qa/2026-10-21-lcl01-lan2';
mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/stg-probe.log`;
const stamp = new Date().toISOString();
const log = (l) => { console.log(l); appendFileSync(LOG, `${l}\n`); };
appendFileSync(LOG, `\n===== ${stamp} ${QA_USER} @ ${BACKEND}\n`);

// Vietnam business day — the exact default the detail screen injects.
const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
log(`vietnamToday=${today}`);

const token = await login({ username: QA_USER, password: DEFAULT_PASSWORD }, { backend: BACKEND });
const call = (path) => api(token, 'GET', path, undefined, { backend: BACKEND });

async function fetchAll(name, base) {
  const rows = [];
  let page = 1;
  let total = null;
  let totalPages = null;
  for (;;) {
    const sep = base.includes('?') ? '&' : '?';
    const res = await call(`${base}${sep}page=${page}&limit=200`);
    if (res.status !== 200) {
      log(`${name} page=${page} status=${res.status} — ABORT`);
      process.exit(2);
    }
    const d = res.data;
    total = d.total;
    totalPages = d.totalPages;
    rows.push(...d.items);
    if (page >= totalPages || page > 60) break;
    page += 1;
  }
  log(`${name}: pages=${page} total=${total} rows=${rows.length}`);
  return { rows, total };
}

// 1) Tổng quan — no default date scope.
const overview = await fetchAll('overview', '/shipments/cus-workspace');
// 2) Chi tiết — the screen's DEFAULT day lens (today).
const detailDefault = await fetchAll('detail-default', `/shipments/cus-workspace/containers?transportDateFrom=${today}&transportDateTo=${today}`);
// 3) Chi tiết bare — no date arms (isolates rowSource exclusion).
const detailBare = await fetchAll('detail-bare', '/shipments/cus-workspace/containers');

const detailDefaultIds = new Set(detailDefault.rows.map((r) => r.shipmentId));
const detailBareIds = new Set(detailBare.rows.map((r) => r.shipmentId));

// Every overview lot, keyed by id, with the fields that decide the query
// branches: cargoMode (rowSource + triage), transportDate/EDD (day lens).
const lots = overview.rows.map((r) => ({
  id: r.id,
  cargoMode: r.cargoMode ?? null,
  transportDate: r.transportDate ?? null,
  billOrBook: r.billOrBookNumber ?? r.blNumber ?? null,
  status: r.status ?? null,
}));

const lclLots = lots.filter((l) => l.cargoMode === 'LCL');
const nullModeLots = lots.filter((l) => l.cargoMode == null);
log(`overview lots=${lots.length} lcl=${lclLots.length} nullMode=${nullModeLots.length}`);
log(`detail-default ids=${detailDefaultIds.size} detail-bare ids=${detailBareIds.size}`);

const dropDefault = lclLots.filter((l) => !detailDefaultIds.has(l.id));
const dropBare = lclLots.filter((l) => !detailBareIds.has(l.id));
const nullDropBare = nullModeLots.filter((l) => !detailBareIds.has(l.id));

log(`LCL lots missing from DETAIL-DEFAULT lens (${today}): ${dropDefault.length}`);
for (const l of dropDefault) log(`  DROP-DEFAULT id=${l.id} edd=${l.transportDate} status=${l.status} bill=${l.billOrBook}`);
log(`LCL lots missing from DETAIL-BARE (rowSource): ${dropBare.length}`);
for (const l of dropBare) log(`  DROP-BARE id=${l.id} edd=${l.transportDate} status=${l.status} bill=${l.billOrBook}`);
log(`nullMode lots missing from DETAIL-BARE: ${nullDropBare.length}/${nullModeLots.length}`);
for (const l of nullDropBare.slice(0, 15)) log(`  NULLMODE-DROP id=${l.id} edd=${l.transportDate} status=${l.status} bill=${l.billOrBook}`);

// Also diff container-mode detail rows per shipment: an LCL lot that HAS
// container rows on the detail board (mixed shape) — the lan-1 exemption
// only rides container-less rows.
const lclDetailRows = detailBare.rows.filter((r) => r.classification === 'LCL' || r.containerNumber == null);
log(`detail-bare rows on lot-level/classification-LCL: ${lclDetailRows.length}`);
const mixedRows = detailDefault.rows.filter((r) => r.classification === 'LCL' && r.containerNumber != null);
log(`detail-default LCL-classified rows WITH containerNumber (mixed): ${mixedRows.length}`);

log('PROBE DONE');
