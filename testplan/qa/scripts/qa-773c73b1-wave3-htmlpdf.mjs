// Muse QA wave 3 — cards 171026004331/171026004332 on the HTML/PDF export seam.
// STAGING only. The xlsx seam is covered by wave 2; this covers
// GET /api/finance/billing-documents/:id/export?format=html|pdf — the endpoint
// commit 15d11b98 actually fixed (the route used to project doc.lines without
// renderData, so the template's Biển số xe / Loại xe cells printed EMPTY).
// Usage: EXPECT_BUILD=e5559305 node testplan/qa/scripts/qa-773c73b1-wave3-htmlpdf.mjs
import {
  BASE, API, PIN, sleep, uuid, makeLogger, healthGate, login, api, psql,
} from './fullguide-lib.mjs';
import { writeFileSync } from 'node:fs';

const SCOPE = 'qa773c73b1-wave3';
const logger = makeLogger(SCOPE);
const { step, log } = logger;
const results = {};
const record = (id, verdict, note) => { results[id] = { verdict, note }; step('VERDICT', { id, verdict, note }); };

await healthGate(logger);
const admin = await login('admin');
const cus = await login('thanhdc');
if (!admin.token || !cus.token) throw new Error('logins failed');
step('logins', { admin: !!admin.token, cus: !!cus.token });

const hex = uuid().slice(0, 6);
const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const customers = await api(admin.token, 'GET', '/customers?limit=50');
const customerList = (customers.json?.items ?? customers.json ?? []).filter((c) => !c.deletedAt && c.status === 'ACTIVE');
const customer = customerList.find((c) => c.id === 1) ?? customerList[0];
const routes = await api(admin.token, 'GET', '/routes?limit=50');
const routeList = (routes.json?.items ?? routes.json ?? []).filter((r) => !r.deletedAt);
const route = routeList.find((r) => r.id === 11) ?? routeList[0];
const classes = await api(admin.token, 'GET', '/vehicle-size-classes?limit=50');
const classList = classes.json?.items ?? classes.json ?? [];
const cls5t = classList.find((c) => c.code === '5T') ?? classList.find((c) => !c.isContainer);
step('catalog', { customer: customer.id, route: route.id, cls5t: cls5t?.code });

// Unique far-future lane so the price row cannot collide with another agent's.
const laneDate = '2031-07-07';
const cleanupPricing = [];
let lotId = null;
try {
  const price = await api(admin.token, 'POST', '/pricing-tables', {
    customerId: customer.id, routeId: route.id, vehicleSizeClassId: cls5t.id,
    price: 2468000, effectiveDate: laneDate, note: `QA773 W3 ${hex}`,
  });
  cleanupPricing.push(price.json?.id);
  step('lane-price', { status: price.status, id: price.json?.id });

  const ref = `QA-W3-${hex}`;
  const rLot = await api(cus.token, 'POST', '/shipments', {
    customerId: customer.id, bookingRef: ref, tradeDirection: 'EXPORT', cargoMode: 'LCL',
    expectedDeliveryDate: today, routeId: route.id,
  });
  lotId = rLot.json?.id;
  step('lot', { ref, id: lotId, status: rLot.status });
  if (!lotId) throw new Error(`lot create failed: ${rLot.text}`);

  // Actual (real) vs billing (virtual / "Báo khách") plate — the whole point of 86/4331.
  const actualPlate = '15H-209.51';
  const virtPlate = `W3K-${hex.slice(0, 5).toUpperCase()}`;
  const tRes = await api(cus.token, 'POST', '/shipments/lcl/truck', {
    shipmentId: lotId, actualTruckNo: actualPlate, billingTruckNo: virtPlate,
  });
  const cRes = await api(cus.token, 'POST', '/shipments/lcl/rev-class', {
    shipmentId: lotId, vehicleSizeClassId: cls5t.id,
  });
  step('truck+class', { truck: tRes.status, cls: cRes.status, actualPlate, virtPlate });

  const lock = await api(cus.token, 'POST', `/shipments/${lotId}/lock`, {});
  step('lock', { status: lock.status, body: (lock.text ?? '').slice(0, 120) });

  const dn = await api(cus.token, 'POST', `/shipments/${lotId}/debit-note`, {}, { 'Idempotency-Key': `idemp-w3-${hex}` });
  step('debit-note', { status: dn.status, body: (dn.text ?? '').slice(0, 200) });
  const docId = dn.json?.id;
  if (!docId) throw new Error(`debit note create failed: ${dn.text}`);

  const grab = async (fmt) => {
    const res = await fetch(`${API}/finance/billing-documents/${docId}/export?format=${fmt}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const text = await res.text();
    return { status: res.status, type: res.headers.get('content-type'), text };
  };

  for (const fmt of ['html', 'pdf']) {
    const r = await grab(fmt);
    const hasVirt = r.text.includes(virtPlate);
    const hasActual = r.text.includes(actualPlate);
    // The template's own column labels are BKS / LOẠI XE (uppercase in the
    // snapshot), not "Biển số xe" — match what the served page actually prints.
    const hasPlateHeader = />\s*BKS\s*</i.test(r.text);
    const hasClassHeader = />\s*LOẠI\s*XE\s*</i.test(r.text);
    step(`export-${fmt}`, {
      status: r.status, type: r.type, len: r.text.length,
      hasVirt, hasActual, hasPlateHeader, hasClassHeader,
    });
    writeFileSync(`qa/2026-10-17_${SCOPE}_${fmt}-export.html`, r.text);
    const ok = r.status === 200 && hasVirt && !hasActual && hasPlateHeader && hasClassHeader;
    record(`CARD-171026004331-HTMLPDF-${fmt.toUpperCase()}`, ok ? 'PASS' : 'FAIL',
      `GET /api/finance/billing-documents/${docId}/export?format=${fmt} → ${r.status} (${r.type}, ${r.text.length}B) :: template cols [Biển số xe=${hasPlateHeader} Loại xe=${hasClassHeader}] :: virtual plate "${virtPlate}" printed=${hasVirt} :: actual plate "${actualPlate}" leaked=${hasActual}`);
  }
} catch (e) {
  record('CARD-171026004331-HTMLPDF-HTML', 'FAIL', String(e.message ?? e));
  record('CARD-171026004331-HTMLPDF-PDF', 'FAIL', String(e.message ?? e));
}

// ── cleanup ─────────────────────────────────────────────────────────────────
if (lotId) {
  const s = await api(admin.token, 'GET', `/shipments/${lotId}`).then((r) => r.json?.shipment ?? r.json ?? null).catch(() => null);
  if (s?.id) {
    const del = await api(admin.token, 'DELETE', `/shipments/${lotId}?version=${s.version}`);
    step('cleanup-lot', { id: lotId, status: del.status });
  }
}
for (const id of cleanupPricing) {
  if (id) { const d = await api(admin.token, 'DELETE', `/pricing-tables/${id}`); step('cleanup-price', { id, status: d.status }); }
}
step('SUMMARY', { pin: PIN, results });
writeFileSync(`qa/${SCOPE}_results.json`, JSON.stringify({ pin: PIN, date: new Date().toISOString(), results }, null, 2));
log('WAVE 3 DONE');
