// Phase 1c (read-only) — accounting debit-board rows for the fixture lots,
// plus the check-3 positive control: pre-existing staging lots that carry
// freight_rate_snapshots and are NOT override-qualified must still read the
// computed snapshot sums on both boards (fallback unchanged).
import { appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const DIR = 'qa/2026-10-16_161026113900_f2-override-read';
const LOG = `${DIR}/f2-api-driver.log`;
const step = (s, o) => {
  const e = { at: new Date().toISOString(), step: s, ...o };
  appendFileSync(LOG, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};
const save = (name, data) => writeFileSync(`${DIR}/${name}`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
const API = 'https://vantai.tingting.vip/api';
const vnDate = (offset = 0) => new Date(Date.now() + 7 * 3600 * 1000 + offset * 86400 * 1000).toISOString().slice(0, 10);
async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const body = await res.json();
  return { auth: { Authorization: `Bearer ${body.token}` } };
}
async function api(account, method, path, body, { idem = method !== 'GET' } = {}) {
  const headers = { ...account.auth, 'Content-Type': 'application/json' };
  if (idem) headers['Idempotency-Key'] = randomUUID();
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 400); }
  return { status: res.status, body: parsed };
}
const sshPsql = (sql) => execSync(`ssh root@vantai.tingting.vip "docker exec vantai-postgres-1 psql -U vantai -d vantai -At -c \\"${sql}\\""`, { encoding: 'utf8' });

const cus = await login('tiepvv');
const acc = await login('hoapt');
const state = JSON.parse(readFileSync(`${DIR}/f2-state.json`, 'utf8'));
const ids = { A: state.lots.A.id, B: state.lots.B.id, C: state.lots.C.id, D: state.lotsDe.D.id, E: state.lotsDe.E.id };

// ── fresh accounting board (post-stamp) ──────────────────────────────────────
const bb = await api(acc, 'GET', `/accounting/debit-board?dateFrom=${vnDate(-7)}&dateTo=${vnDate(7)}`, undefined, { idem: false });
save('f2-api-accounting-board-post.json', bb.body);
const boardRows = bb.body.items ?? [];
for (const [suffix, id] of Object.entries(ids)) {
  const r = boardRows.find((x) => x.shipmentId === id);
  step('board-post', { suffix, shipmentId: id, cuocThu: r?.thu?.cuocThu ?? '__NOT_ON_BOARD__', tongThu: r?.thu?.tongThu ?? null, traDv: r?.tra?.cuocTraDv ?? null });
}

// ── check-3 control: pre-existing snapshot-bearing unqualified lots ──────────
const cand = sshPsql(`SELECT g.shipment_id || '|' || g.total_amount
FROM freight_rate_snapshots g
WHERE g.trip_id IS NULL
  AND g.id = (SELECT max(l.id) FROM freight_rate_snapshots l WHERE l.shipment_id = g.shipment_id AND l.trip_id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM freight_rate_snapshots x WHERE x.shipment_id = g.shipment_id AND x.trip_id IS NOT NULL)
  AND EXISTS (SELECT 1 FROM shipments s2 WHERE s2.id = g.shipment_id AND s2.deleted_at IS NULL AND s2.rev_group_id IS NULL AND s2.cargo_mode = 'LCL')
  AND NOT EXISTS (
    SELECT 1 FROM trips t
    LEFT JOIN trip_financial_state tfs ON tfs.trip_id = t.id
    WHERE t.shipment_id = g.shipment_id AND t.deleted_at IS NULL AND t.status <> 'CANCELED' AND tfs.revenue_overridden_at IS NOT NULL
  )
ORDER BY g.shipment_id DESC LIMIT 5`);
const controls = cand.trim().split('\n').filter(Boolean).map((line) => {
  const [shipmentId, expected] = line.split('|');
  return { shipmentId: Number(shipmentId), expected };
});
step('control-candidates', { controls });
if (controls.length === 0) throw new Error('no control candidates found');

// each control lot's live trip ids (for CUS board law: trip-NULL row counts once)
const ds = await api(cus, 'GET', `/shipments/debit-summary?deliveryDateFrom=2026-01-01&deliveryDateTo=${vnDate(30)}`, undefined, { idem: false });
const dsRows = Array.isArray(ds.body) ? ds.body : (ds.body?.items ?? ds.body?.rows ?? []);
save('f2-api-debit-summary-all.json', dsRows.map((r) => ({ shipmentId: r.shipmentId, freightAuto: r.freightAuto })));
const bb2 = await api(acc, 'GET', `/accounting/debit-board?dateFrom=2026-09-01&dateTo=${vnDate(30)}`, undefined, { idem: false });
const board2 = bb2.body.items ?? [];
save('f2-api-accounting-board-controls.json', board2.filter((r) => controls.some((c) => c.shipmentId === r.shipmentId)));
for (const c of controls) {
  const row = dsRows.find((x) => x.shipmentId === c.shipmentId);
  const brow = board2.find((x) => x.shipmentId === c.shipmentId);
  step('control-check', {
    shipmentId: c.shipmentId, expectedSnapshotSum: c.expected,
    cusFreightAuto: row?.freightAuto ?? '__NO_ROW__', cusReason: row?.freightOverrideReason ?? null,
    accCuocThu: brow?.thu?.cuocThu ?? '__NOT_ON_BOARD__',
    cusMatch: row ? String(row.freightAuto) === c.expected : false,
    accMatch: brow ? String(brow.thu.cuocThu) === c.expected : false,
  });
}
step('done-phase1c', {});
