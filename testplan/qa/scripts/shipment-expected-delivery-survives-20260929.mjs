// Card 20260929_203 — TC-SHIP-EXPECTED-DELIVERY-001, on the DEPLOYED build.
//
// The card's own acceptance test: create a shipment carrying
// expectedDeliveryDate, declare a container, then assert BOTH that the date
// survived the container write and that the lot now appears in
// GET /api/ops/orders?date=<that date>. Asserting only 201 is what let this
// defect through the first time.
//
// A bad-check-digit control runs FIRST, so a container that silently failed to
// write cannot masquerade as "the date survived because nothing happened".
import { loadEnv } from '../lib/env.mjs';

const env = await loadEnv();
const build = await fetch(`${env.api}/health`).then((r) => r.json()).then((j) => j.buildHash);
console.log(`env=${env.env} build=${build} api=${env.api}`);

async function login(role) {
  for (const c of env.candidatesFor(role).filter((u) => /^[a-z][a-z0-9-]+$/i.test(u))) {
    const r = await fetch(`${env.api}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: c, password: env.password }),
    });
    if (r.ok) { const { token, user } = await r.json(); return { token, who: c, id: user?.id }; }
  }
  throw new Error(`no account logs in for ${role}`);
}
const cus = await login('CUS');
const ops = await login('OPS');
console.log(`CUS=${cus.who} OPS=${ops.who}`);

const DAY = new Date().toISOString().slice(0, 10);
const stamp = `QA203${Date.now().toString().slice(-9)}`;
// ISO 6346 check digit — taken from the PROJECT's own helper rather than
// reimplemented. A hand-rolled version got the letter map wrong (ISO skips
// both 11 and 22, so S is 30, not 28) and produced MSCU1234563, which the API
// correctly rejected as "Sai số kiểm tra". The API was right; the probe was
// wrong. Two runs in a row failed on this before the helper was reused.
const { calculateCheckDigit, validateCheckDigit } = await import(
  '../../../shared/src/calculations/iso6346.ts');
const BODY = 'MSCU123456';
const GOOD = BODY + String(calculateCheckDigit(BODY));
const BAD  = GOOD.slice(0, 10) + String((Number(GOOD[10]) + 1) % 10);
console.log(`container: valid=${GOOD} (${validateCheckDigit(GOOD)})  tampered=${BAD} (${validateCheckDigit(BAD)})`);

const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
const call = (t, m, p, body, extra = {}) =>
  fetch(env.api + p, { method: m, headers: { ...auth(t), ...extra }, body: body ? JSON.stringify(body) : undefined });

// Reuse EXISTING master data rather than creating customer/route rows: those
// writes need their own Idempotency-Key and are not what this card is about.
const adm = await login('ADMIN');
const custs = await (await call(cus.token, 'GET', '/customers')).json();
const routes = await (await call(adm.token, 'GET', '/routes')).json();
const ctypes = await (await call(adm.token, 'GET', '/container-types')).json();
const ports = await (await call(adm.token, 'GET', '/ports')).json();
const customer = custs.items[0];
const route = routes.items[0];
const ctype = (ctypes.items || ctypes)[0];
const port = (ports.items || ports)[0];
console.log(`reusing customer=${customer.id} route=${route.id} containerType=${ctype?.id} port=${port?.id}`);

// ── STEP 1: create with the date, NO container ──────────────────────────────
const created = await call(cus.token, 'POST', '/shipments', {
  customerId: customer.id,
  tradeDirection: 'IMPORT',
  cargoMode: 'FCL',
  blNumber: `BK-${stamp}`,
  expectedDeliveryDate: DAY,
  routeId: route.id,
}, { 'Idempotency-Key': `${stamp}-create` });
const lot = await created.json();
console.log(`\nSTEP 1 create -> ${created.status}`);
console.log(`  shipmentId=${lot.id} expectedDeliveryDate=${JSON.stringify(lot.expectedDeliveryDate)}`);

const problems = [];
if (!lot.id) { console.log('cannot continue: no shipment id'); process.exit(1); }
if (lot.expectedDeliveryDate !== DAY) problems.push(`create did not store the date (got ${JSON.stringify(lot.expectedDeliveryDate)})`);

// ── CONTROL: a container with a bad check digit must be REJECTED ────────────
const bad = await call(cus.token, 'PUT', `/shipments/${lot.id}/containers`, {
  expectedVersion: lot.version ?? 1,
  containers: [{ containerNumber: BAD, containerTypeId: ctype.id, routeId: route.id, liftPortId: port.id, dischargePortId: port.id, weightKg: 25000 }],
}, { 'Idempotency-Key': `${stamp}-bad` });
const badBody = await bad.text();
console.log(`\nCONTROL bad check-digit PUT -> ${bad.status}`);
if (bad.status < 400) problems.push(`a container with a bad check digit was ACCEPTED (${bad.status}) — the control proves nothing`);

// ── STEP 2: a VALID container write — this is the one that used to erase it ─
const valid = await call(cus.token, 'PUT', `/shipments/${lot.id}/containers`, {
  expectedVersion: lot.version ?? 1,
  containers: [{ containerNumber: GOOD, containerTypeId: ctype.id, routeId: route.id,
                 liftPortId: port.id, dischargePortId: port.id, weightKg: 25000 }],
}, { 'Idempotency-Key': `${stamp}-good` });
const validBody = await valid.json().catch(() => ({}));
console.log(`\nSTEP 2 valid container PUT -> ${valid.status}`);
if (valid.status >= 400) console.log(`  ${JSON.stringify(validBody).slice(0, 200)}`);
else {
  // The PUT response does not echo the container list; read it back where it
  // lives. Without this, "the date survived" would be equally consistent with
  // "the container write silently did nothing" — the run has to prove the
  // thing that used to break it actually happened.
  const reread = await (await call(cus.token, 'GET', `/shipments/${lot.id}`)).json();
  const stored = reread.containers || [];
  console.log(`  stored containers: ${JSON.stringify(stored.map((c) => ({ n: c.containerNumber, appt: c.customerAppointmentAt })))}`);
  if (!stored.length) problems.push('the valid container write returned 2xx but stored no container — the date surviving would prove nothing');
  else if (stored.some((c) => c.customerAppointmentAt != null)) {
    problems.push('the fixture container carries an appointment, so this run did NOT exercise the null-derivation case the defect needs');
  }
}

// GET /shipments/:id does NOT return expectedDeliveryDate, so reading it there
// reported `undefined` and nearly became a false "THE DEFECT" verdict on a
// request that had in fact been rejected for an unrelated reason. The column is
// read where it is actually authoritative: the Ops board, which filters on it.
// STEP 4 below is therefore the real assertion, not a convenience check.
console.log('\nSTEP 3 (no local read: GET /shipments/:id does not carry the column)');
console.log('  -> deferred to STEP 4, which queries the surface that filters on it');

// ── STEP 4: the lot must reach the Ops board for that date ───────────────────
const board = await call(ops.token, 'GET', `/ops/orders?date=${DAY}`);
const boardJson = await board.json().catch(() => ({}));
const items = boardJson.items || [];
const onBoard = items.find((i) => i.id === lot.id);
console.log(`\nSTEP 4 GET /ops/orders?date=${DAY} -> ${board.status}, ${items.length} lot(s) on the board`);
console.log(`  our lot ${lot.id} on the board: ${onBoard ? `YES (${onBoard.shipmentCode})` : 'NO'}`);
if (!onBoard) problems.push(`the lot is still missing from the Ops board for ${DAY} — the user-facing symptom is unfixed`);
if (valid.status >= 400) problems.push('the container write never landed, so this run never exercised the defect at all');

console.log(`\n================ ${problems.length ? 'NOT PROVEN' : 'PROVEN'} ================`);
for (const p of problems) console.log('  -', p);
if (!problems.length) console.log(`  a lot created with expectedDeliveryDate=${DAY} kept that date through a real container write, and now appears on the Ops board for ${DAY}.`);
process.exit(problems.length ? 1 : 0);
