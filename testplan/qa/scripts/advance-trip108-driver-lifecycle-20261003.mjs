// Advance fixture trip 108 through the driver lifecycle as dvthuc (2026-10-03,
// be2 — for card 292's chi-ho dialog rung): accept -> depart -> incidental chi-ho
// fee -> POD create/submit -> complete, checking the chi-ho rows after each step.
import { writeFileSync } from 'fs';
import crypto from 'crypto';

const API = process.env.API_URL || 'https://vantai.tingting.vip/api';
const LOG = process.env.LOG_FILE || 'qa/2026-10-03_292-driver-lifecycle.log';
const FULFILLMENT = Number(process.env.FULFILLMENT_ID || 194);
const TRIP = Number(process.env.TRIP_ID || 108);
const MARKER = 'QA292-FIXTURE 2026-10-03';

const lines = [];
const log = (s, extra) => {
  const line = extra === undefined ? s : `${s} ${JSON.stringify(extra)}`;
  console.log(line);
  lines.push(line);
  writeFileSync(LOG, lines.join('\n') + '\n');
};

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.IDENTIFIER || 'dvthuc', password: process.env.PASSWORD || 'Abc123' }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const { token } = await login.json();
const api = async (method, path, body) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const mine = await api('GET', '/driver/me/trips');
const owns = (mine.body?.items ?? []).some((t) => (t.id ?? t.tripId) === TRIP);
log('ownership', { trips: mine.body?.items?.length ?? 0, ownsTrip108: owns });
if (!owns) throw new Error('dvthuc does not own trip 108 — re-target first');

const chiHo = async (label) => {
  const r = await api('GET', `/expense-accounting/phoi-phieu/${TRIP}/chi-ho`);
  const rows = r.body?.rows ?? r.body?.items ?? r.body;
  const list = Array.isArray(rows) ? rows : [];
  log(`chi-ho rows ${label}`, { status: r.status, count: list.length, sample: list.slice(0, 2).map((x) => x.feeName ?? x.sourceId) });
  return list;
};

const tripState = async (label) => {
  const r = await api('GET', '/driver/me/trips');
  const t = (r.body?.items ?? []).find((x) => (x.id ?? x.tripId) === TRIP);
  log(`trip ${label}`, { status: t?.status ?? t?.tripStatus });
  return t;
};

await chiHo('before');

const detail = await api('GET', `/driver/me/fulfillments/${FULFILLMENT}`);
const fulfillmentVersion = detail.body?.tripVersion ?? detail.body?.version ?? 1;
log('fulfillment detail', { keys: Object.keys(detail.body ?? {}), body: JSON.stringify(detail.body).slice(0, 400), chosen: fulfillmentVersion });

const occurred = new Date().toISOString();
for (const eventType of ['ORDER_RECEIVED', 'DEPARTED']) {
  const r = await api('POST', `/driver/me/fulfillments/${FULFILLMENT}/progress`, { eventType, occurredAt: occurred, expectedVersion: fulfillmentVersion });
  log(`progress ${eventType}`, { status: r.status, body: JSON.stringify(r.body).slice(0, 120) });
  await tripState(`after ${eventType}`);
}

const today = new Date().toISOString().slice(0, 10);
const cost = await api('POST', `/driver/me/trips/${TRIP}/incidental-costs`, {
  costType: 'LIFT_FEE',
  amount: 1500000,
  payerKind: 'USER',
  occurredAt: today,
  note: `${MARKER} — chi ho phi rung (xoa duoc sau QA)`,
});
log('incidental cost', { status: cost.status, body: JSON.stringify(cost.body).slice(0, 160) });
const rowsAfterCost = await chiHo('after incidental cost');
if (rowsAfterCost.length === 0) throw new Error('no chi-ho rows after the fee — refusing to complete (completion locks the fee path)');

if (!Number.isFinite(fulfillmentVersion)) throw new Error(`fulfillmentVersion unresolved: ${JSON.stringify(detail.body).slice(0, 200)}`);
const pod = await api('POST', `/driver/me/fulfillments/${FULFILLMENT}/pod`, { fulfillmentVersion });
log('pod create', { status: pod.status, body: JSON.stringify(pod.body).slice(0, 160) });
const submissionId = pod.body?.id ?? pod.body?.submission?.id;
if (submissionId) {
  const submitted = await api('POST', `/driver/me/fulfillments/${FULFILLMENT}/pod/${submissionId}/submit`, { fulfillmentVersion });
  log('pod submit', { status: submitted.status, body: JSON.stringify(submitted.body).slice(0, 120) });
}
await chiHo('after pod submit');
await tripState('after pod submit');

const completed = await api('POST', `/driver/me/fulfillments/${FULFILLMENT}/complete`, { fulfillmentVersion });
log('complete', { status: completed.status, body: JSON.stringify(completed.body).slice(0, 160) });
await chiHo('after complete');
await tripState('final');

log('LIFECYCLE_DONE', { marker: MARKER, trip: TRIP, fulfillment: FULFILLMENT });
console.log('LIFECYCLE_DONE');
