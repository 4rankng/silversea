// Cards 201026112400 (FB-061 admin, R24 B6) + 201026112500 (FB-014 điều vận, R24 B2)
// — wire-level READ-ONLY repro against the CURRENT staging build. No mutation.
// FB-061: /accounting/phoi-phieu Kiểm soát phơi phiếu must never list QA-fixture
//         signatures (KHO-SEAM, STG VERIFY, BL-QAKE, E2E-, 51K-PROBE, Test Driver,
//         99T-99999, QA% refs, epoch-stamped names).
// FB-014: /dispatch-detail "Lọc nhanh gán xe" → tab "Chưa gán xe" must list ONLY
//         rows without a plate; assigned rows excluded (R17 batch2 contract).
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = process.env.OUT_DIR || path.resolve(import.meta.dirname, '../../../qa/2026-10-20-fb061-fb014');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};

const health = await (await fetch(`${API}/health`)).json();
log('build_gate', { buildHash: health.buildHash });
fs.writeFileSync(path.join(OUT, 'build-gate.json'), JSON.stringify(health, null, 2));

async function login(identifier) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!r.ok) { console.error(`BLOCKED: login ${identifier} -> ${r.status}`); process.exit(2); }
  const { token, user } = await r.json();
  log('login', { identifier, user: user?.username, role: user?.role });
  return token;
}

// ---------- FB-061: phoi-phieu board (admin) ----------
const adminToken = await login('admin');
const pp = await (await fetch(`${API}/expense-accounting/phoi-phieu/rows`, {
  headers: { Authorization: `Bearer ${adminToken}` },
})).json();
const rows = pp.items ?? [];
log('phoi_phieu_rows', { count: rows.length });

// The card's signature list + generic QA-ish heuristics.
const SIGNATURES = [
  /KHO-SEAM/i, /STG VERIFY/i, /BL-QAKE/i, /E2E-/i, /51K-PROBE/i,
  /Test Driver/i, /99T-99999/i, /QA0915/i,
];
const GENERIC = [
  /\bQA[-_ ]?\d/i, /-1[0-9]{9,12}$/, /-1[0-9]{12}-/, /PROBE/i, /VERIFY[- ]?\d/i,
  /fixture/i, /QA (Lead|lane|probe)/i, /SEAM-17/i, /\bE2E\b/i,
];
const scanRow = (r) => {
  const hay = [
    r.factoryName, r.factorySiteName, r.customerName, r.carrierName,
    r.externalDriverName, r.driverName, r.blNumber, r.bookingRef,
    r.shipmentCode, r.plateNumber, r.externalPlateNumber, r.licensePlate,
    r.tripCode, r.notes,
  ]
    .filter((v) => typeof v === 'string' && v.trim() !== '');
  const hits = [];
  for (const v of hay) {
    for (const re of SIGNATURES) if (re.test(v)) hits.push({ kind: 'card-signature', value: v });
    for (const re of GENERIC) if (re.test(v)) hits.push({ kind: 'generic-qa-ish', value: v });
  }
  return hits;
};
const flagged = [];
for (const r of rows) {
  const hits = scanRow(r);
  if (hits.length > 0) flagged.push({ shipmentId: r.shipmentId, blNumber: r.blNumber, bookingRef: r.bookingRef, hits });
}
log('fb061_flagged_rows', { flaggedCount: flagged.length, flagged: flagged.slice(0, 30) });
// Keep a raw sample so the report can quote real values.
fs.writeFileSync(path.join(OUT, 'fb061_wire_rows_sample.json'),
  JSON.stringify(rows.slice(0, 15), null, 2));

// ---------- FB-014: dispatch-detail unassigned tab (điều vận) ----------
const dvToken = await login('dieuvan');
const url = `${API}/shipments/dispatch-detail-plan-rows?assignmentStatus=UNASSIGNED&limit=50&page=1`;
const dd = await (await fetch(url, { headers: { Authorization: `Bearer ${dvToken}` } })).json();
const items = dd.items ?? [];
log('fb014_unassigned_page', {
  rowCount: items.length,
  counts: dd.assignmentStatusCounts,
  total: dd.total,
});
const withPlates = items.filter((r) => typeof r.plannedVehiclePlateNumber === 'string' && r.plannedVehiclePlateNumber.trim() !== '');
log('fb014_unassigned_rows_with_plate', {
  count: withPlates.length,
  samples: withPlates.slice(0, 15).map((r) => ({
    shipmentId: r.shipmentId, shipmentCode: r.shipmentCode, blNumber: r.blNumber,
    plate: r.plannedVehiclePlateNumber, cargoMode: r.cargoMode,
    fulfillmentType: r.fulfillmentType ?? null, tripId: r.tripId ?? null,
  })),
});
// Also capture the ASSIGNED tab count for the report.
const dda = await (await fetch(`${API}/shipments/dispatch-detail-plan-rows?assignmentStatus=ASSIGNED&limit=5&page=1`, {
  headers: { Authorization: `Bearer ${dvToken}` },
})).json();
log('fb014_assigned_probe', { total: dda.total, counts: dda.assignmentStatusCounts, samplePlate: (dda.items ?? []).slice(0, 3).map((r) => r.plannedVehiclePlateNumber) });

fs.writeFileSync(path.join(OUT, 'wire-probe.log'), JSON.stringify(LOG, null, 2));
const fb061Ok = flagged.filter((f) => f.hits.some((h) => h.kind === 'card-signature')).length === 0;
const fb014Ok = withPlates.length === 0;
log('verdict', { fb061_wire: fb061Ok ? 'CLEAN' : 'FLAGGED', fb014_wire: fb014Ok ? 'CLEAN' : 'FLAGGED' });
