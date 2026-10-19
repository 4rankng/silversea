// Muse QA wave 1 — API surfaces, STAGING only, pin c2288933 (live).
// Covers:
//   A.6a 161026095800 — POST /api/pricing-tables with vehicleSizeClassId → 201 (was 400)
//   A.6b 161026121500 — delete + re-add same selector → only 1 ACTIVE row (no phantom dup)
//   spec-gap 66 — cross-customer rev merge rejected 400 with named error
//   card 171026010018 — material-write registry: every LCL/pricing write here is non-500
// Usage: EXPECT_BUILD=c2288933 node testplan/qa/scripts/qa-773c73b1-api-wave1.mjs
import {
  PIN, sleep, uuid, makeLogger, healthGate, login, api, psql,
} from './fullguide-lib.mjs';
import { writeFileSync } from 'node:fs';

const SCOPE = 'qa773c73b1-wave1';
const logger = makeLogger(SCOPE);
const { step } = logger;
const results = {};
const record = (id, verdict, note) => { results[id] = { verdict, note }; step('VERDICT', { id, verdict, note }); };
const http500 = [];

await healthGate(logger);
const admin = await login('admin');
const cus = await login('thanhdc');
if (!admin.token) throw new Error('admin login failed');
step('logins', { admin: !!admin.token, cus: !!cus.token });

// Track any 5xx across every write below — the material-write-registry (card
// 171026010018) failure class is a 500 on a live call while suites stay green.
const wrap500 = (label) => (r) => { if (r.status >= 500) http500.push({ label, status: r.status, body: (r.text ?? '').slice(0, 160) }); return r; };

// ── catalog facts ────────────────────────────────────────────────────────────
const customers = await api(admin.token, 'GET', '/customers?limit=200').then(wrap500('customers'));
const customerList = (customers.json?.items ?? customers.json ?? []).filter((c) => !c.deletedAt && c.status === 'ACTIVE');
const custA = customerList.find((c) => c.name && c.name.length <= 40) ?? customerList[0];
const custB = customerList.find((c) => c.id !== custA?.id);
const routes = await api(admin.token, 'GET', '/routes?limit=200').then(wrap500('routes'));
const routeList = (routes.json?.items ?? routes.json ?? []).filter((r) => !r.deletedAt);
const route = routeList[0];
const classes = await api(admin.token, 'GET', '/vehicle-size-classes?limit=50').then(wrap500('classes'));
const classList = classes.json?.items ?? classes.json ?? [];
const cls5t = classList.find((c) => /(^|\D)5\s*tấn/i.test(c.name ?? '')) ?? classList.find((c) => !c.isContainer);
const testDate = '2028-11-15';
step('catalog', { custA: { id: custA?.id, name: custA?.name }, custB: { id: custB?.id, name: custB?.name }, route: { id: route?.id, name: route?.name }, cls5t: { id: cls5t?.id, name: cls5t?.name, code: cls5t?.code } });
if (!custA || !route || !cls5t) throw new Error('catalog facts incomplete');

const activePriceRows = async (selector) => {
  const q = new URLSearchParams({ customerId: String(selector.customerId), routeId: String(selector.routeId), limit: '100' });
  const r = await api(admin.token, 'GET', `/pricing-tables?${q}`).then(wrap500('pricing-list'));
  const items = r.json?.items ?? r.json ?? [];
  const arr = Array.isArray(items) ? items : [];
  return arr.filter((p) => !p.deletedAt
    && Number(p.vehicleSizeClassId ?? -1) === Number(selector.vehicleSizeClassId)
    && String(p.effectiveDate).slice(0, 10) === selector.effectiveDate);
};

// ══ A.6a — 161026095800: class+rateKey POST succeeds (was 400) ══════════════
{
  const hex = uuid().slice(0, 6);
  const payload = {
    customerId: custA.id, routeId: route.id, vehicleSizeClassId: cls5t.id,
    price: 1111000, effectiveDate: testDate, note: `QA773 A6a ${hex}`,
  };
  const create = await api(admin.token, 'POST', '/pricing-tables', payload).then(wrap500('A6a-create'));
  step('A6a-create', { status: create.status, id: create.json?.id, body: (create.text ?? '').slice(0, 240) });
  const created = create.status === 201 && create.json?.id;
  // UPDATE path (the ticket's second half): patch the price, expect 200.
  let updated = null;
  if (created) {
    const put = await api(admin.token, 'PUT', `/pricing-tables/${create.json.id}`, { price: 1222000, version: create.json.version }, { 'If-Unmodified-Since': create.json.updatedAt }).then(wrap500('A6a-update'));
    updated = put.status === 200;
    step('A6a-update', { status: put.status, body: (put.text ?? '').slice(0, 200) });
  }
  // cleanup
  if (created) {
    const fresh = await api(admin.token, 'GET', `/pricing-tables/${create.json.id}`);
    const del = await api(admin.token, 'DELETE', `/pricing-tables/${create.json.id}`, null, { 'If-Unmodified-Since': fresh.json?.updatedAt ?? create.json.updatedAt }).then(wrap500('A6a-delete'));
    step('A6a-delete', { status: del.status });
  }
  record('A.6a-161026095800', created ? 'PASS' : 'FAIL',
    `POST /api/pricing-tables with vehicleSizeClassId=${cls5t.id} → HTTP ${create.status} (expect 201; pre-fix was 400 "Chỉ được chọn một trục giá"). id=${create.json?.id ?? '—'} · PUT→${updated === null ? 'n/a' : (updated ? '200' : 'non-200')}`);
}

// ══ A.6b — 161026121500: delete + re-add → only 1 ACTIVE row ════════════════
{
  const hex = uuid().slice(0, 6);
  const selector = { customerId: custA.id, routeId: route.id, vehicleSizeClassId: cls5t.id, effectiveDate: testDate };
  const base = { ...selector, price: 1333000, note: `QA773 A6b ${hex}` };
  const first = await api(admin.token, 'POST', '/pricing-tables', base).then(wrap500('A6b-first'));
  step('A6b-first', { status: first.status, id: first.json?.id });
  if (first.status !== 201) { record('A.6b-161026121500', 'FAIL', `create #1 → HTTP ${first.status} ${(first.text ?? '').slice(0, 160)}`); }
  else {
    // soft-delete (tombstone)
    const del = await api(admin.token, 'DELETE', `/pricing-tables/${first.json.id}`, null, { 'If-Unmodified-Since': first.json.updatedAt }).then(wrap500('A6b-del'));
    step('A6b-del', { status: del.status });
    // re-add the SAME selector
    const second = await api(admin.token, 'POST', '/pricing-tables', { ...base, price: 1444000, note: `QA773 A6b readd ${hex}` }).then(wrap500('A6b-second'));
    step('A6b-second', { status: second.status, id: second.json?.id, body: (second.text ?? '').slice(0, 200) });
    const live = await activePriceRows(selector);
    // DB cross-check on the staging DB (ssh path).
    const dbCount = psql(`SELECT count(*) FROM pricing_tables WHERE customer_id=${custA.id} AND route_id=${route.id} AND vehicle_size_class_id=${cls5t.id} AND effective_date='${testDate}' AND deleted_at IS NULL`);
    step('A6b-rows', { apiLive: live.length, dbActive: dbCount, ids: live.map((r) => r.id) });
    const ok = second.status === 201 && live.length === 1 && Number(dbCount) === 1;
    record('A.6b-161026121500', ok ? 'PASS' : 'FAIL',
      `soft-delete id=${first.json.id} (HTTP ${del.status}) → re-add → HTTP ${second.status} id=${second.json?.id ?? '—'}; ACTIVE rows by API=${live.length} DB=${dbCount} (expect exactly 1, no phantom dup). ids=[${live.map((r) => r.id).join(',')}]`);
    // cleanup the survivor
    for (const row of live) await api(admin.token, 'DELETE', `/pricing-tables/${row.id}`, null, { 'If-Unmodified-Since': row.updatedAt }).then(wrap500('A6b-cleanup'));
  }
}

// ══ spec-gap 66 — cross-customer rev merge rejected ═════════════════════════
{
  if (!custB) { record('SPECGAP-66-cross-customer', 'SKIP', 'no second ACTIVE customer available'); }
  else {
    const hex = uuid().slice(0, 6);
    const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const mkLot = async (customerId, ref) => api(cus.token, 'POST', '/shipments', {
      customerId, bookingRef: ref, tradeDirection: 'EXPORT', cargoMode: 'LCL',
      expectedDeliveryDate: today, packageType: 'Pallet', quantity: '5', weightKg: '1900', volumeCbm: '4',
      routeId: route.id,
    }).then(wrap500('gap66-lot'));
    const lotA = await mkLot(custA.id, `QA773-XC-A-${hex}`);
    const lotB = await mkLot(custB.id, `QA773-XC-B-${hex}`);
    step('gap66-lots', { a: { id: lotA.json?.id, status: lotA.status }, b: { id: lotB.json?.id, status: lotB.status } });
    if (!lotA.json?.id || !lotB.json?.id) {
      record('SPECGAP-66-cross-customer', 'FAIL', `fixture lots failed A=${lotA.status} B=${lotB.status}`);
    } else {
      const merge = await api(cus.token, 'POST', '/shipments/lcl/rev-group', {
        shipmentIds: [lotA.json.id, lotB.json.id], vehicleSizeClassId: cls5t.id,
      }).then(wrap500('gap66-merge'));
      step('gap66-merge', { status: merge.status, body: (merge.text ?? '').slice(0, 300) });
      const msg = merge.json?.error ?? merge.json?.message ?? (merge.text ?? '');
      const rejected = merge.status === 400 && /cùng một khách hàng|khác khách/i.test(msg);
      // confirm neither lot joined a group (money untouched)
      const dbRev = psql(`SELECT id, booking_ref, rev_group_id, rev_group_order FROM shipments WHERE id IN (${lotA.json.id},${lotB.json.id}) ORDER BY id`);
      step('gap66-db', { rev: dbRev });
      const clean = !/\|[0-9a-f-]{6,}\|/.test(dbRev) || dbRev.split('\n').every((l) => l.includes('||') || l.endsWith('|'));
      record('SPECGAP-66-cross-customer', (rejected && clean) ? 'PASS' : 'FAIL',
        `POST /api/shipments/lcl/rev-group mixing customers ${custA.id}/${custB.id} → HTTP ${merge.status} "${String(msg).slice(0, 160)}" (expect 400 naming different-customer) · no group formed=${clean} · db=[${dbRev.replace(/\n/g, '; ')}]`);
      // cleanup lots
      for (const id of [lotA.json.id, lotB.json.id]) {
        const s = await api(admin.token, 'GET', `/shipments/${id}`).then(wrap500('gap66-get')).catch(() => null);
        const ship = s?.json?.shipment ?? s?.json ?? null;
        if (ship?.id) await api(admin.token, 'DELETE', `/shipments/${id}?version=${ship.version}`).then(wrap500('gap66-del'));
      }
    }
  }
}

// ══ card 171026010018 — no 5xx on any write above (registry green) ══════════
record('CARD-171026010018-material-write', http500.length === 0 ? 'PASS' : 'FAIL',
  http500.length === 0
    ? 'every LCL/pricing write in this wave returned <500 — no undeclared-material-write 500 (registry live-green for the touched LCL family: lcl/rev-group, pricing-tables CRUD, shipments create/delete)'
    : `5xx observed: ${JSON.stringify(http500)}`);

step('SUMMARY', { pin: PIN, results });
writeFileSync(`qa/${SCOPE}_results.json`, JSON.stringify({ pin: PIN, date: new Date().toISOString(), results, http500 }, null, 2));
step('DRIVER DONE');
