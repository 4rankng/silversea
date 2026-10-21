#!/usr/bin/env node
/**
 * LCL-01 lan 2 (card 211026180528) — repro + fix proof. LOCAL DEV only.
 *
 *   BACKEND=http://localhost:3016/api node testplan/qa/scripts/2026-10-21-lcl01-lan2-repro.mjs
 *
 * Models the two screens' ACTUAL default queries:
 *   - Tổng quan  (/shipments,         ShipmentsPage)          → NO default date scope
 *   - Chi tiết   (/shipments-detail,  ShipmentContainersPage) → default day lens
 *     transportDateFrom=To=<Vietnam today> (ShipmentContainersPage useVietnamToday)
 *
 * Seeds THREE shapes through the real APIs — exactly the way QA made them:
 *   A. containerless LCL, EDD null        (lan-1 old shape, undated)
 *   B. containerless LCL, EDD far-future  (lan-1 old shape, dated)
 *   C. intake skeleton: minimal POST /shipments {customerId} (cargo_mode NULL)
 *      + 2×20' containers with NO appointment — the staging QA lot
 *      SHP-2610-00069 shape (card 211026180528). Read-only after the seeds.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { login, api, DEFAULT_BACKEND } from '../../../scripts/lib/http.mjs';

const BACKEND = process.env.BACKEND ?? DEFAULT_BACKEND;
const OUT = 'qa/2026-10-21-lcl01-lan2';
mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/local-repro.log`;
const stamp = Date.now().toString().slice(-6);
const tag = process.env.QA_TAG ?? 'LCL01L2';
const log = (l) => { console.log(l); appendFileSync(LOG, `${l}\n`); };
appendFileSync(LOG, `\n===== ${new Date().toISOString()} backend=${BACKEND}\n`);

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const DATED_EDD = '2099-06-15';
log(`RUN stamp=${stamp} vietnamToday=${today} datedEdd=${DATED_EDD}`);

const token = await login('admin', { backend: BACKEND });
const call = (method, path, body, opts = {}) => api(token, method, path, body, { ...opts, backend: BACKEND });
const customers = await call('GET', '/customers?limit=1');
const customerId = customers.data?.items?.[0]?.id ?? customers.data?.[0]?.id;
if (!customerId) { log('ABORT: no customer visible to admin'); process.exit(2); }

// Shapes A + B: containerless LCL lots (lan-1 law must keep holding).
const mkLot = async (suffix, extra) => {
  const body = {
    customerId,
    cargoMode: 'LCL',
    tradeDirection: 'IMPORT',
    blNumber: `${tag}-${suffix}-${stamp}`,
    packageType: 'Pallet',
    packageCount: 5,
    cargoWeightKg: 800,
    ...extra,
  };
  const res = await call('POST', '/shipments', body, {
    headers: { 'Idempotency-Key': `lcl01l2-${suffix}-${stamp}` },
  });
  log(`create ${suffix}: status=${res.status} id=${res.data?.id ?? '?'}`);
  return res.data?.id ?? null;
};
const undatedId = await mkLot('UNDATED', { expectedDeliveryDate: null });
const datedId = await mkLot('DATED', { expectedDeliveryDate: DATED_EDD });

// Shape C: the QA skeleton — minimal create (cargo_mode NULL, no EDD), then
// 2×20' containers with no appointment. Mirrors the staging audit trail of
// SHP-2610-00069: POST /api/shipments {customerId} → PUT /:id/containers.
const skelRes = await call('POST', '/shipments', { customerId }, {
  headers: { 'Idempotency-Key': `lcl01l2-skel-${stamp}` },
});
const skeletonId = skelRes.data?.id ?? null;
log(`create SKELETON: status=${skelRes.status} id=${skeletonId}`);
if (skeletonId) {
  // ISO-format numbers (XXXX+7 digits) — QA's staging rows ended up
  // number-less (`containerNo` key stripped by the schema); the day-triage
  // behavior under test rides on the MISSING APPOINTMENT × missing EDD, not
  // the number, and numbers make the lot findable on both screens' search.
  const contRes = await call('PUT', `/shipments/${skeletonId}/containers`, {
    containers: [
      { containerNumber: 'MSKU7654328', containerTypeId: 1 },
      { containerNumber: 'CSQU3054383', containerTypeId: 1 },
    ],
    expectedVersion: 1,
  }, { headers: { 'Idempotency-Key': `lcl01l2-skel-cont-${stamp}` } });
  log(`skeleton containers: status=${contRes.status}`);
  const ws = await call('GET', `/shipments/cus-workspace/${skeletonId}`);
  log(`skeleton shape: cargoMode=${ws.data?.summary?.cargoMode ?? ws.data?.raw?.cargoMode} edd=${ws.data?.raw?.expectedDeliveryDate ?? ws.data?.summary?.transportDate} containers=${(ws.data?.containers ?? []).length}`);
}
if (!undatedId || !datedId || !skeletonId) { log('ABORT: seed failed'); process.exit(2); }

// The two screens' actual default queries (search-scoped so the checks are
// pagination-proof; detail carries the default day lens). Two searches: the
// stamp matches lots A/B (Bill numbers), `MSKU7654328` matches the skeleton's
// container numbers — its only searchable identifier (no Bill/Booking).
const overviewSearch = await call('GET', `/shipments/cus-workspace?page=1&limit=200&searchSuffix=${stamp}`);
const detailDefaultSearch = await call('GET',
  `/shipments/cus-workspace/containers?page=1&limit=200&transportDateFrom=${today}&transportDateTo=${today}&searchSuffix=${stamp}`);
const detailBareSearch = await call('GET',
  `/shipments/cus-workspace/containers?page=1&limit=200&searchSuffix=${stamp}`);
const overviewSkel = await call('GET', `/shipments/cus-workspace?page=1&limit=200&searchSuffix=MSKU7654328`);
const detailDefaultSkel = await call('GET',
  `/shipments/cus-workspace/containers?page=1&limit=200&transportDateFrom=${today}&transportDateTo=${today}&searchSuffix=MSKU7654328`);
const detailBareSkel = await call('GET',
  `/shipments/cus-workspace/containers?page=1&limit=200&searchSuffix=MSKU7654328`);
const os = JSON.stringify(overviewSearch.data);
const ds = JSON.stringify(detailDefaultSearch.data);
const dbs = JSON.stringify(detailBareSearch.data);
const osSkel = JSON.stringify(overviewSkel.data);
const dsSkel = JSON.stringify(detailDefaultSkel.data);
const dbsSkel = JSON.stringify(detailBareSkel.data);
log(`overview(bare search) status=${overviewSearch.status} total=${overviewSearch.data?.total}`);
log(`detail(default lens ${today}) status=${detailDefaultSearch.status} total=${detailDefaultSearch.data?.total}`);
log(`detail(bare) status=${detailBareSearch.status} total=${detailBareSearch.data?.total}`);
log(`overview(skel search MSKU7654328) total=${overviewSkel.data?.total}`);
log(`detail default(skel search) total=${detailDefaultSkel.data?.total}`);
log(`detail bare(skel search) total=${detailBareSkel.data?.total}`);

// Old shapes (lan-1 law — must keep passing, no regression).
check('R1 undated LCL lot on TỔNG QUAN', os.includes(`${tag}-UNDATED-${stamp}`));
check('R1 dated LCL lot on TỔNG QUAN', os.includes(`${tag}-DATED-${stamp}`));
check('R3 undated LCL lot on CHI TIẾT default lens (lan-1, no regression)', ds.includes(`${tag}-UNDATED-${stamp}`));
check('R3 dated LCL lot on CHI TIẾT default lens (lan-1, no regression)', ds.includes(`${tag}-DATED-${stamp}`));
// New shape (lan-2 fix target): the skeleton lot + its containers.
const skelRowsDefault = (detailDefaultSkel.data?.items ?? []).filter((r) => r.shipmentId === skeletonId);
const skelRowsBare = (detailBareSkel.data?.items ?? []).filter((r) => r.shipmentId === skeletonId);
check('R2 skeleton lot (nullMode + 2 cont chưa hẹn ngày) on TỔNG QUAN',
  (overviewSkel.data?.items ?? []).some((r) => r.id === skeletonId), `id=${skeletonId}`);
check('R2 skeleton rows on CHI TIẾT default lens (card 211026180528)', skelRowsDefault.length > 0,
  `rows=${skelRowsDefault.length}`);
check('R4 skeleton rows on CHI TIẾT bare', skelRowsBare.length > 0, `rows=${skelRowsBare.length}`);
if (skelRowsBare.length > 0) {
  log(`skeleton bare row: classification=${skelRowsBare[0].classification} containerNumber=${skelRowsBare[0].containerNumber} transportDate=${skelRowsBare[0].transportDate}`);
}
// Invariant: every seeded shipment visible on Tổng quan must be on Chi tiết
// under the default lens — the card's own phrasing. (Scoped to THIS run's
// seeded ids: the container-number search can also surface unrelated lots
// like the DRI-03 fixture that shares the ISO number.)
const detailIds = new Set([
  ...(detailDefaultSearch.data?.items ?? []).map((r) => r.shipmentId),
  ...(detailDefaultSkel.data?.items ?? []).map((r) => r.shipmentId),
]);
const seeded = [undatedId, datedId, skeletonId];
const overviewAll = await call('GET', `/shipments/cus-workspace?page=1&limit=200&searchSuffix=${stamp}`);
const skelOnOverviewOk = (overviewSkel.data?.items ?? []).some((r) => r.id === skeletonId);
const dropped = seeded.filter((id) => (id === skeletonId ? skelOnOverviewOk && !detailIds.has(id) : !detailIds.has(id)));
check('INVARIANT seeded lots drop none on CHI TIẾT default', dropped.length === 0, dropped.join(','));
log(`DONE failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
