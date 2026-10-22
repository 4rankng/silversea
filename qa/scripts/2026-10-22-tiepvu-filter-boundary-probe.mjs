// Card 261022201006b — CUS date-filter boundary probe (LOCAL ONLY, QA script).
// Seeds 3 consecutive VN (Asia/Ho_Chi_Minh) days of fixture lots/containers at
// 00:00/23:59 VN boundary instants (the instants whose UTC date differs from
// their VN date) and asserts every date-filtered list-shipment query returns
// exactly the rows whose VN schedule day matches. Expectations are VN-correct
// behaviour, so a FAIL line is the reproduced leak (save both runs in qa/).
//
// Run: node qa/scripts/2026-10-22-tiepvu-filter-boundary-probe.mjs
//      (API env override; default http://localhost:3006/api — worktree stack)
import { execSync } from 'node:child_process';

const API = process.env.API ?? 'http://localhost:3006/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function jf(path, opts) {
  const res = await fetch(`${API}${path}`, opts);
  let body = null; try { body = await res.json(); } catch { body = `<non-json ${res.status}>`; }
  return { status: res.status, body };
}
const auth = (t, e = {}) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...e });
const psql = (sql) => execSync(`docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c ${JSON.stringify(sql)}`).toString().trim();

const results = [];
const check = (id, ok, detail) => { results.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} :: ${detail}`); };

async function login(identifier) {
  let L = null;
  for (let i = 0; i < 3 && !L?.token; i++) {
    const r = await jf('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
    L = r.body;
    if (!L?.token) await sleep(1000);
  }
  if (!L?.token) { console.log(`LOGIN FAILED for ${identifier}`); process.exit(1); }
  return L.token;
}

// ── VN day math (UTC+7, no DST) ──────────────────────────────────────────────
const vnToday = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
function vnDay(offset) {
  const d = new Date(`${vnToday}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
/** VN wall time `day HH:MM` → the UTC instant ISO string. */
function vnInstant(day, hhmm) {
  const [H, M] = hhmm.split(':').map(Number);
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, H, M) - 7 * 3600e3).toISOString();
}
const day1 = vnDay(1), day2 = vnDay(2), day3 = vnDay(3), day9 = vnDay(9);
console.log(`VN window: day1=${day1} day2=${day2} day3=${day3} (fixture EDD far day=${day9})`);

const T = await login('cus');
const TAdmin = await login('admin');
const key = () => crypto.randomUUID();

// ── Fixture ──────────────────────────────────────────────────────────────────
const boot = (await jf('/catalogs/bootstrap', { headers: auth(T) })).body;
const customers = (await jf('/customers?limit=5', { headers: auth(T) })).body;
const cust = (customers.items ?? customers.rows ?? customers)[0];
const ct = (boot.containerTypes ?? [])[0];
const stamp = Date.now().toString().slice(-6);
const sid = {};

async function makeLot(tag, expectedDeliveryDate, containerCount) {
  const r = await jf('/shipments/quick', {
    method: 'POST', headers: auth(T, { 'Idempotency-Key': key() }),
    body: JSON.stringify({
      customerId: cust.id, tradeDirection: 'IMPORT', blNumber: `TBFL${stamp}${tag}`,
      shippingLineName: 'MAERSK', expectedDeliveryDate, cargoMode: 'FCL',
      containers: Array.from({ length: containerCount }, () => ({ containerNumber: '', containerTypeId: ct.id })),
    }),
  });
  if (r.status !== 201) { console.log(`FIXTURE FAIL ${tag}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); process.exit(1); }
  sid[tag] = r.body.id;
  return r.body.id;
}
const cidsOf = (tag) => psql(`select id from shipment_containers where shipment_id=${sid[tag]} order by id`).split('\n').filter(Boolean).map(Number);
const setAppt = (cid, iso) => psql(`update shipment_containers set customer_appointment_at='${iso}' where id=${cid}`);
const setCutoff = (tag, iso) => psql(`update shipments set customs_cutoff_at='${iso}' where id=${sid[tag]}`);

// A: EDD inside the window, container WITHOUT appointment (EDD fallback arm).
await makeLot('A', day2, 1);
// B..F: EDD far outside the window — only the container-appointment arm can
// match. The boundary instants B (day2 00:30 VN = day1 UTC) and D
// (day3 00:15 VN = day2 UTC) are the UTC-vs-VN discriminators.
await makeLot('B', day9, 1); setAppt(cidsOf('B')[0], vnInstant(day2, '00:30'));
await makeLot('C', day9, 1); setAppt(cidsOf('C')[0], vnInstant(day2, '23:30'));
await makeLot('D', day9, 1); setAppt(cidsOf('D')[0], vnInstant(day3, '00:15'));
await makeLot('E', day9, 1); setAppt(cidsOf('E')[0], vnInstant(day1, '23:45'));
await makeLot('F', day9, 1); setAppt(cidsOf('F')[0], vnInstant(day2, '12:00'));
// G: multi-day lot (day1 + day3 containers) — appears under each of its days.
await makeLot('G', day9, 2);
const g = cidsOf('G'); setAppt(g[0], vnInstant(day1, '10:00')); setAppt(g[1], vnInstant(day3, '10:00'));
// H..K: customsCutoffAt boundary lots for the /shipments dateFrom/dateTo arm
// (one undated container each — EDD far away, so they never match the
// transport-date probes).
await makeLot('H', day9, 1); setCutoff('H', vnInstant(day2, '00:30'));
await makeLot('I', day9, 1); setCutoff('I', vnInstant(day2, '23:30'));
await makeLot('J', day9, 1); setCutoff('J', vnInstant(day3, '00:30'));
await makeLot('K', day9, 1); setCutoff('K', vnInstant(day1, '00:30'));
// Z: the card-261022201006b symptom — EDD says day1 but every container was
// reappointed to day3. Filtering day1 must NOT return it (its only days are
// day3); filtering day3 must. Today's unconditional EDD arm leaks it under
// day1 ("lọc ngày A vẫn trả lô ngày khác").
await makeLot('Z', day1, 1); setAppt(cidsOf('Z')[0], vnInstant(day3, '10:00'));
psql(`update shipments set closing_at='${vnInstant(day3, '17:00')}' where id=${sid.Z}`);
console.log(`fixture lots: ${Object.entries(sid).map(([t, id]) => `${t}=${id}`).join(' ')} (bl prefix TBFL${stamp})`);

// ── Expectations (VN-correct) ────────────────────────────────────────────────
const byDay = {
  [day1]: ['E', 'G'],
  [day2]: ['A', 'B', 'C', 'F'],
  [day3]: ['D', 'G', 'Z'],
};
const byCutoffDay = {
  [day1]: ['K'],
  [day2]: ['H', 'I'],
  [day3]: ['J'],
};
const tagOf = (bl) => String(bl ?? '').replace(`TBFL${stamp}`, '');
const sorted = (xs) => [...xs].sort().join(',');
const billOf = (it) => it.blNumber ?? it.billOrBookNumber ?? it.shipment?.blNumber ?? '';

async function probeLots(path, searchKey, paramPairs, expect) {
  for (const [day, tags] of Object.entries(expect)) {
    const qs = paramPairs.map(([k, v]) => `${k}=${v(day)}`).join('&');
    const r = await jf(`${path}?limit=100&${searchKey}=TBFL${stamp}&${qs}`, { headers: auth(path.startsWith('/shipments?') ? TAdmin : T) });
    const got = (r.body?.items ?? []).map((it) => tagOf(billOf(it))).filter(Boolean);
    check(`rows ${path} ${qs}`, sorted(got) === sorted(tags), `expect=[${sorted(tags)}] got=[${sorted(got)}]`);
    for (const it of (r.body?.items ?? [])) {
      const shown = it.transportDate ?? it.shipment?.expectedDeliveryDate ?? '?';
      console.log(`   row ${tagOf(billOf(it))} transportDate=${shown} groups=${(it.appointmentGroups ?? []).map((g2) => g2.localDate).join('|')}`);
    }
    if (r.status !== 200) console.log(`   (status=${r.status} ${JSON.stringify(r.body).slice(0, 160)})`);
  }
}

// P1 — CUS Tổng quan (lot list): transportDateFrom/To.
await probeLots('/shipments/cus-workspace', 'searchSuffix', [['transportDateFrom', (d) => d], ['transportDateTo', (d) => d]], byDay);
// P3 — list-summaries customsCutoffAt arm: dateFrom/dateTo.
await probeLots('/shipments', 'q', [['dateFrom', (d) => d], ['dateTo', (d) => d]], byCutoffDay);
// P4 — list-summaries delivery-date arm (same container/EDD contract as P1).
await probeLots('/shipments', 'q', [['deliveryDateFrom', (d) => d], ['deliveryDateTo', (d) => d]], byDay);

// P2 — CUS Chi tiết (container rows): per-row VN day must equal the filter day.
for (const [day, tags] of Object.entries(byDay)) {
  const r = await jf(`/shipments/cus-workspace/containers?limit=100&searchSuffix=TBFL${stamp}&transportDateFrom=${day}&transportDateTo=${day}`, { headers: auth(T) });
  const rows = r.body?.items ?? [];
  const got = rows.map((it) => tagOf(billOf(it))).filter(Boolean);
  check(`rows /containers day=${day}`, sorted(got) === sorted(tags), `expect=[${sorted(tags)}] got=[${sorted(got)}]`);
  for (const it of rows) console.log(`   cont-row ${tagOf(billOf(it))} transportDate=${it.transportDate ?? '?'}`);
}

// R3 — 3-day range từ=A..đến=B trả về đúng union.
{
  const r = await jf(`/shipments/cus-workspace?limit=100&searchSuffix=TBFL${stamp}&transportDateFrom=${day1}&transportDateTo=${day3}`, { headers: auth(T) });
  const got = (r.body?.items ?? []).map((it) => tagOf(billOf(it))).filter(Boolean);
  check('rows /shipments/cus-workspace range day1..day3', sorted(got) === sorted(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Z']),
    `expect=[A,B,C,D,E,F,G,Z] got=[${sorted(got)}]${r.status !== 200 ? ` status=${r.status} ${JSON.stringify(r.body).slice(0, 160)}` : ''}`);
}

// ── Cleanup (fixture rows only) ──────────────────────────────────────────────
psql(`update shipments set deleted_at=now() where bl_number like 'TBFL${stamp}%'`);
console.log(`\ncleanup: fixture lots TBFL${stamp}% soft-deleted`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
