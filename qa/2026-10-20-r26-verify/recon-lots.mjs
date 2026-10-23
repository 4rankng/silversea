// QA R26 (d39ee741) recon — pick 2 lots for the FB-014 re-drive:
//   (a) day inside the topbar month (Oct 2026), (b) day outside it.
// A lot qualifies when its deep-linked scope (q = Bill|Booking|shipmentCode,
// day = appointment[0].localDate ?? expectedDeliveryDate) returns >=1 row from
// GET /shipments/dispatch-detail-plan-rows. Read-only.
import { stagingPassword } from './creds.mjs';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;

const health = await (await fetch(`${API}/health`)).json();
console.log(JSON.stringify({ step: 'build_gate', buildHash: health.buildHash }));
if (health.buildHash !== 'd39ee741') {
  console.log('STOP: buildHash mismatch');
  process.exit(2);
}

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dieuvan', password: stagingPassword() }),
});
if (!loginRes.ok) { console.log(`STOP: login ${loginRes.status}`); process.exit(2); }
const { token, user } = await loginRes.json();
console.log(JSON.stringify({ step: 'login', username: user?.username, role: user?.role }));
const H = { Authorization: `Bearer ${token}` };

async function paged(url) {
  const out = [];
  for (let page = 1; page <= 12; page += 1) {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}page=${page}&limit=50`, { headers: H });
    const body = await res.json();
    if (!Array.isArray(body.items) || body.items.length === 0) break;
    out.push(...body.items);
    if (out.length >= (body.total ?? 0)) break;
  }
  return out;
}

const rows = await paged(`${API}/shipments/dispatch-detail-plan-rows`);
const rowDates = new Set(rows.map((r) => r.time?.deliveryDate).filter(Boolean));
console.log(JSON.stringify({
  step: 'detail_rows_loaded',
  rows: rows.length,
  dates: [...rowDates].sort(),
  perDate: [...rowDates].sort().map((d) => [d, rows.filter((r) => r.time?.deliveryDate === d).length]),
}));

const shipments = await paged(`${API}/shipments`);
console.log(JSON.stringify({ step: 'shipments_loaded', count: shipments.length }));

const day = (s) => s.appointmentGroups?.[0]?.localDate ?? s.expectedDeliveryDate ?? '';
const ref = (s) => (s.blNumber?.trim() || s.bookingRef?.trim() || s.shipmentCode || '');

const rough = shipments
  .map((s) => ({ s, d: day(s), q: ref(s) }))
  .filter((x) => x.d && x.q && rowDates.has(x.d));

const candidates = [];
for (const { s, d, q } of rough) {
  const res = await fetch(
    `${API}/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(q)}&date=${d}&limit=20`,
    { headers: H },
  );
  const body = await res.json();
  const total = typeof body.total === 'number' ? body.total : 0;
  if (total > 0) {
    candidates.push({
      shipmentId: s.id,
      shipmentCode: s.shipmentCode,
      blNumber: s.blNumber,
      bookingRef: s.bookingRef,
      q,
      day: d,
      rows: total,
      inTopbarMonth: d.startsWith('2026-10'),
      status: s.status,
      customer: s.customerName ?? null,
    });
  }
}
candidates.sort((a, b) => (a.day < b.day ? 1 : -1));
console.log(JSON.stringify({ step: 'candidates_with_rows', count: candidates.length }));
for (const c of candidates) console.log(JSON.stringify(c));
