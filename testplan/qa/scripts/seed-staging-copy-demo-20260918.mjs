// Seed the staging copy-date demo (2026-09-18): the user asked for test data on
// https://vantai.tingting.vip/shipments so the bulk appointment copy button can
// be seen without hunting for a suitable lot.
//
// Creates two FCL lots under the CUS account thanhdc, both with four containers:
//   A — "copy demo": container 1 dated, containers 2..4 empty (the source-gated
//       affordance shows on the drawer ledger and on /shipments-detail).
//   B — "chưa có lịch": every container empty (the customer's original case).
//
// Idempotent enough for QA: re-running creates another pair with a fresh BL
// suffix, so repeat runs never edit an existing lot.
//
// Usage: node testplan/qa/scripts/seed-staging-copy-demo-20260918.mjs
import { writeFileSync } from 'fs';

const API = process.env.API_URL || 'https://vantai.tingting.vip/api';
const IDENTIFIER = process.env.IDENTIFIER || 'thanhdc';
const PASSWORD = process.env.PASSWORD || 'Abc123';
const CONTAINERS = Number(process.env.CONTAINERS || 4);
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const LOGFILE = process.env.LOG_FILE || 'qa/2026-09-18-copy-demo-staging/seed.log';

const lines = [];
const log = (s, extra) => {
  const line = extra === undefined ? s : `${s} ${JSON.stringify(extra)}`;
  console.log(line);
  lines.push(line);
  if (LOGFILE) writeFileSync(LOGFILE, lines.join('\n') + '\n');
};

/** ISO 6346 check digit — the container-number gate downstream rejects a bad
 *  one, so the demo data must be genuinely valid. */
const LETTERS = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };
function containerNumber(prefix, serial) {
  const digits = String(serial).padStart(6, '0');
  const body = `${prefix}${digits}`;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const char = body[i];
    const value = i < 4 ? LETTERS[char] : Number(char);
    if (value === undefined || Number.isNaN(value)) throw new Error(`bad container character: ${char}`);
    sum += value * 2 ** i;
  }
  return `${body}${(sum % 11) % 10}`;
}

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const { token } = await login.json();
log(`login ${IDENTIFIER} @ ${API}`);

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

// Reference taxonomy from a live lot: the demo must reuse staging's real
// customer / container type / route / ports, not invented ids.
const workboard = await api('GET', '/shipments/cus-workspace/containers?page=1&limit=100&transportDateFrom=2020-01-01&transportDateTo=2030-12-31');
if (workboard.status !== 200) throw new Error(`workboard failed: ${workboard.status}`);
const referenceRow = workboard.body.items.find((row) => row.customerId && !row.isAdHoc && row.containerTypeLabel && row.liftSite && row.dropoffSite);
if (!referenceRow) throw new Error('no reference container row on staging to copy taxonomy from');
const reference = await api('GET', `/shipments/cus-workspace/${referenceRow.shipmentId}`);
const referenceContainer = reference.body.containers.find((container) => container.id === referenceRow.id);
const taxonomy = {
  customerId: referenceRow.customerId ?? reference.body.summary.customerId ?? null,
  containerTypeId: referenceContainer?.containerTypeId ?? null,
  routeId: referenceContainer?.routeId ?? null,
  pickupPortId: referenceContainer?.liftSiteId ?? null,
  dropoffPortId: referenceContainer?.dropoffSiteId ?? null,
  operationalSiteId: referenceContainer?.operationalSiteId ?? null,
};
log('taxonomy from lot', { shipmentId: referenceRow.shipmentId, ...taxonomy });
if (!taxonomy.customerId || !taxonomy.containerTypeId || !taxonomy.routeId || !taxonomy.pickupPortId || !taxonomy.dropoffPortId) {
  throw new Error(`incomplete reference taxonomy: ${JSON.stringify(taxonomy)}`);
}

/** 08:00 Vietnam time tomorrow, as the ISO instant the wire expects. */
function appointmentTomorrow() {
  const now = new Date();
  const vnDay = new Date(now.getTime() + 7 * 3600_000);
  const iso = `${vnDay.toISOString().slice(0, 10)}T08:00:00+07:00`;
  return new Date(new Date(iso).getTime() + 24 * 3600_000).toISOString();
}

async function createLot(label, appointmentFor) {
  const bl = `QACOPY-${STAMP}-${label}`;
  const created = await api('POST', '/shipments', {
    customerId: taxonomy.customerId,
    cargoMode: 'FCL',
    tradeDirection: 'IMPORT',
    blNumber: bl,
    shippingLineName: 'QA Line',
    customerNotes: `Dữ liệu QA 2026-09-18 — kiểm tra copy ngày giờ đóng trả (${label}). Xóa được sau khi xong.`,
  });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`create ${label} failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const shipmentId = created.body.id ?? created.body.shipment?.id;
  const version = created.body.version ?? created.body.shipment?.version ?? 1;
  log(`created lot ${label}`, { shipmentId, bl, version, status: created.status });

  // ISO 6346 numbers are XXXX + 6 digits + check digit; the serial must stay
  // six digits, so the stamp picks a stable 6-digit window per run.
  const base = 900_000 + (Number(STAMP.slice(-4)) % 900) * 10 + (label === 'copy' ? 0 : 500);
  const containers = Array.from({ length: CONTAINERS }, (_, index) => ({
    containerNumber: containerNumber('QATU', base + index),
    containerTypeId: taxonomy.containerTypeId,
    routeId: taxonomy.routeId,
    pickupPortId: taxonomy.pickupPortId,
    dropoffPortId: taxonomy.dropoffPortId,
    operationalSiteId: taxonomy.operationalSiteId,
    shippingLineName: 'QA Line',
    cargoWeightKg: '11000',
    customerAppointmentAt: appointmentFor(index + 1),
  }));
  const reconciled = await api('PUT', `/shipments/${shipmentId}/containers`, { expectedVersion: version, containers });
  if (reconciled.status !== 200) {
    throw new Error(`containers ${label} failed: ${reconciled.status} ${JSON.stringify(reconciled.body)}`);
  }
  const detail = await api('GET', `/shipments/cus-workspace/${shipmentId}`);
  log(`lot ${label} containers`, detail.body.containers.map((container) => ({
    id: container.id,
    number: container.containerNumber,
    appointment: container.customerAppointmentAt,
    editable: container.permissions.customerAppointmentEditable,
  })));
  return { shipmentId, bl, containers: detail.body.containers };
}

const copyDemo = await createLot('copy', (ordinal) => (ordinal === 1 ? appointmentTomorrow() : null));
const undated = await createLot('undated', () => null);

log('');
log('READY — mở https://vantai.tingting.vip/shipments và tìm theo BL:');
log(`  • ${copyDemo.bl} — 1 cont có lịch + ${CONTAINERS - 1} cont trống (thấy nút copy)`);
log(`  • ${undated.bl} — mọi cont trống (ca "chưa có lịch")`);
log('  Sổ container trong drawer phải bật "Chỉnh sửa" mới thấy icon copy;');
log('  ở /shipments-detail icon nằm ở ô Khách hàng & lộ trình, chỉ hiện khi hover.');
log(`artifact seed log: ${LOGFILE}`);
