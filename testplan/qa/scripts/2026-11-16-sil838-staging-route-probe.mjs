#!/usr/bin/env node
/** SIL-838 round-3 probe v2 — tier inputs per QA-named lot (READ-ONLY). */
import { login } from '../../../scripts/lib/http.mjs';

const FRONT = 'https://vantai.tingting.vip';
const API = `${FRONT}/api`;
const CODES = ['R3M-KR1', 'R3M-KR2', 'R3K-J1', 'R3P-KR1', 'R3Q-679-B', 'R4B-D3-A', 'JWLEM26100907'];
const H = (token) => ({ Authorization: `Bearer ${token}` });

const token = await login('hoapt', { backend: API, frontend: FRONT });

for (const code of CODES) {
  const res = await fetch(`${API}/shipments?q=${encodeURIComponent(code)}`, { headers: H(token) });
  const d = await res.json();
  const row = (d.items ?? []).find((s) => (s.shipmentCode ?? '').includes(code) || code.includes((s.bookingRef ?? '').slice(0, 6)))
    ?? (d.items ?? []).find((s) => JSON.stringify(s).includes(code));
  if (!row) { console.log(code, 'NO MATCH'); continue; }
  const det = await (await fetch(`${API}/shipments/${row.id}`, { headers: H(token) })).json();
  const s = det.shipment ?? det;
  const tripsRes = await fetch(`${API}/trips?shipmentId=${row.id}&limit=20`, { headers: H(token) });
  const trips = await tripsRes.json();
  const tripRows = (trips.items ?? trips ?? []).map((t) => ({
    status: t.status, routeId: t.routeId,
    from: t.canonicalOrigin ?? null, to: t.canonicalDestination ?? null,
    routeName: t.routeName ?? null,
  }));
  console.log(JSON.stringify({
    code, shipmentId: row.id, mode: s.cargoMode,
    lotRouteId: s.routeId, rawRouteName: s.rawRouteName ?? null,
    pickupLocation: s.pickupLocation ?? null, deliveryLocation: s.deliveryLocation ?? null,
    containers: (det.containers ?? []).map((c) => ({
      routeId: c.routeId ?? null, raw: c.rawRouteName ?? null,
      pickupPort: c.pickupPortName ?? null, dropPort: c.dropoffPortName ?? null,
      factory: c.factoryName ?? null,
    })),
    trips: tripRows,
  }));
}
