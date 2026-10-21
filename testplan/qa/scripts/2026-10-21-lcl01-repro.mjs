#!/usr/bin/env node
/**
 * LCL-01 (card 211026132257) — repro + fix proof: "lô hàng lẻ hiện ở TỔNG
 * QUAN nhưng KHÔNG có ở CHI TIẾT". LOCAL DEV only.
 *
 *   BACKEND=http://localhost:3002/api node testplan/qa/scripts/2026-10-21-lcl01-repro.mjs
 *
 * Models the two screens' ACTUAL default queries (the audit's "so sánh API
 * response 2 màn"):
 *   - Tổng quan  (/shipments,         ShipmentsPage)        → NO default date scope
 *   - Chi tiết   (/shipments-detail,  ShipmentContainersPage) → default day lens
 *     transportDateFrom=To=<Vietnam today> (ShipmentContainersPage:83-84)
 * Invariant of the card: every LCL lot Tổng quan lists must be findable on
 * Chi tiết — especially the DATED lot that the 2026-10-18 partial (undated-
 * only exemption) still dropped under the default day lens.
 *
 * Creates 2 self-owned LCL lots (UNDATED + DATED ≠ today) through the real
 * create API (fresh Idempotency-Key each). Read-only after the creates.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { login, api, DEFAULT_BACKEND } from '../../../scripts/lib/http.mjs';

const BACKEND = process.env.BACKEND ?? DEFAULT_BACKEND;
const OUT = 'qa/2026-10-21-lcl01-dri03';
mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/lcl01-repro.log`;
const stamp = Date.now().toString().slice(-6);
const log = (l) => { console.log(l); appendFileSync(LOG, `\n${l}`); };

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// Vietnam business day (Asia/Ho_Chi_Minh) — the exact default the detail
// screen injects (useVietnamToday).
const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const DATED_EDD = '2099-06-15'; // far future ⇒ never inside the default lens
log(`RUN stamp=${stamp} backend=${BACKEND} vietnamToday=${today} datedEdd=${DATED_EDD}`);

const token = await login('admin', { backend: BACKEND });
// Every call MUST carry the backend option — `api()` silently falls back to
// the default :3002 otherwise (the lesson of this repro's first runs: they
// were answered by ANOTHER checkout's backend on :3002).
const call = (method, path, body, opts = {}) => api(token, method, path, body, { ...opts, backend: BACKEND });
const customers = await call('GET', '/customers?limit=1');
const customerId = customers.data?.items?.[0]?.id ?? customers.data?.[0]?.id;
if (!customerId) { log('ABORT: no customer visible to admin'); process.exit(2); }

const mkLot = async (suffix, extra) => {
  const body = {
    customerId,
    cargoMode: 'LCL',
    tradeDirection: 'IMPORT',
    blNumber: `LCL01-${suffix}-${stamp}`,
    packageType: 'Pallet',
    packageCount: 5,
    cargoWeightKg: 800,
    ...extra,
  };
  const res = await call('POST', '/shipments', body, {
    headers: { 'Idempotency-Key': `lcl01-repro-${suffix}-${stamp}` },
  });
  log(`create ${suffix}: status=${res.status} id=${res.data?.id ?? '?'}`);
  return res.data?.id ?? null;
};

const undatedId = await mkLot('UNDATED', { expectedDeliveryDate: null });
const datedId = await mkLot('DATED', { expectedDeliveryDate: DATED_EDD });
if (!undatedId || !datedId) { log('ABORT: lot create failed'); process.exit(2); }

const overview = await call('GET', '/shipments/cus-workspace?page=1&limit=200');
const detailDefault = await call('GET',
  `/shipments/cus-workspace/containers?page=1&limit=200&transportDateFrom=${today}&transportDateTo=${today}`);
const detailBare = await call('GET', '/shipments/cus-workspace/containers?page=1&limit=200');
// Presence checks ride the record search (the "find the lot" action) so they
// are pagination-proof — the unsearched lists carry 10k+ rows behind a
// 200-row page cap.
const overviewSearch = await call('GET', `/shipments/cus-workspace?page=1&limit=200&searchSuffix=${stamp}`);
const detailDefaultSearch = await call('GET',
  `/shipments/cus-workspace/containers?page=1&limit=200&transportDateFrom=${today}&transportDateTo=${today}&searchSuffix=${stamp}`);
const detailBareSearch = await call('GET',
  `/shipments/cus-workspace/containers?page=1&limit=200&searchSuffix=${stamp}`);

const ov = JSON.stringify(overview.data);
const os = JSON.stringify(overviewSearch.data);
const dd = JSON.stringify(detailDefault.data);
const ds = JSON.stringify(detailDefaultSearch.data);
const dbs = JSON.stringify(detailBareSearch.data);
log(`overview(bare) status=${overview.status} total=${overview.data?.total}`);
log(`detail(default lens ${today}) status=${detailDefault.status} total=${detailDefault.data?.total}`);
log(`detail(bare) status=${detailBare.status} total=${detailBare.data?.total}`);

// LCL01-R1: both self-created lots are on Tổng quan.
check('R1 undated LCL lot listed on TỔNG QUAN', os.includes(`LCL01-UNDATED-${stamp}`));
check('R1 dated LCL lot listed on TỔNG QUAN', os.includes(`LCL01-DATED-${stamp}`));
// LCL01-R2/R3: the same lots are on CHI TIẾT under the screen's DEFAULT day
// lens — the dated one is the fix (the 2026-10-18 partial dropped it here).
check('R2 undated LCL lot on CHI TIẾT default lens', ds.includes(`LCL01-UNDATED-${stamp}`));
check('R2 dated LCL lot on CHI TIẾT default lens', ds.includes(`LCL01-DATED-${stamp}`));
// LCL01-R4: parity without any date filter on either side.
check('R4 undated lot in detail(bare) payload', dbs.includes(`LCL01-UNDATED-${stamp}`));
check('R4 dated lot in detail(bare) payload', dbs.includes(`LCL01-DATED-${stamp}`));
// LCL01-R5: the record search finds the lot under the default lens too.
check('R5 search finds both lots under default lens',
  ds.includes(`LCL01-UNDATED-${stamp}`) && ds.includes(`LCL01-DATED-${stamp}`));
// Invariant: every LCL lot row the overview lists must also be on Chi tiết's
// default lens — "không rớt".
const overviewLots = [...os.matchAll(/LCL01-[A-Z]+-\d+/g)].map((m) => m[0]);
const dropped = [...new Set(overviewLots)].filter((lot) => !ds.includes(lot));
check('INVARIANT overview LCL lots drop none on CHI TIẾT default', dropped.length === 0, dropped.join(','));
log(`DONE failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
