// Ticket 201026124500 — API-only source-classification probe (no browser).
// For every FCL lot with containers, classify WHERE the ref line's displayed
// Tuyến/Nâng/Hạ/Nhà xe resolve from:
//   COLUMN  — shipment_containers.route_id / pickup_port_id / dropoff_port_id
//             (these are what addCusShipmentContainer's inheritLotDefault reads)
//   FALLBACK— display non-empty but the column backing is absent (port site
//             snapshot on the fulfillment, planned allocation for carrier):
//             THIS is the shape whose adds arrive blank (QA round-2).
// Ports catalog identity comes from detail.selectors.ports: a liftSiteId that
// matches a ports entry is column-backed; a name that exists in the catalog
// under a DIFFERENT id (or no id at all) is snapshot-sourced.
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = process.env.OUT_DIR || path.resolve(import.meta.dirname, '../../../qa/2026-10-20-201026124500');
fs.mkdirSync(OUT, { recursive: true });
const IDENTIFIER = process.env.IDENTIFIER || 'cus';
const PASSWORD = 'Abc123';

const api = async (method, p, body, token) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* raw */ }
  return { status: res.status, body: parsed };
};

const login = await api('POST', '/auth/login', { identifier: IDENTIFIER, password: PASSWORD });
if (login.status !== 200) { console.error(`BLOCKED: login -> ${login.status}`); process.exit(2); }
const token = login.body.token;

const list = await api('GET', '/shipments/cus-workspace?page=1&limit=200', undefined, token);
const rows = list.body.items ?? list.body.data ?? [];
const classifyPort = (siteId, siteName, ports) => {
  if (siteName == null || siteName === '') return 'EMPTY';
  const byId = ports.find((p) => String(p.id) === String(siteId ?? ''));
  if (byId && (byId.name ?? byId.label ?? '').includes(siteName)) return 'COLUMN';
  const byName = ports.find((p) => (p.name ?? p.label ?? '').includes(siteName));
  return byName ? 'FALLBACK(id-mismatch)' : 'FALLBACK(not-in-ports)';
};

const out = [];
const counts = { COLUMN: 0, FALLBACK: 0, MIXED: 0 };
for (const row of rows) {
  const hasContainers = Boolean((row.containerSummary ?? '').trim()) || (row.containerCount ?? 0) > 0;
  if (!hasContainers || row.cargoMode === 'LCL') continue;
  const d = await api('GET', `/shipments/cus-workspace/${row.id}`, undefined, token);
  if (d.status !== 200 || (d.body.containers ?? []).length === 0) continue;
  const ports = d.body.selectors?.ports ?? [];
  const lines = d.body.containers.map((line) => ({
    id: line.id,
    number: line.containerNumber,
    tuyen: line.routeName == null ? 'EMPTY' : (line.raw?.routeId != null ? 'COLUMN' : 'FALLBACK'),
    nang: classifyPort(line.liftSiteId, line.liftSite, ports),
    ha: classifyPort(line.dropoffSiteId, line.dropoffSite, ports),
    nhaXe: line.carrierName == null ? 'EMPTY' : 'ALLOCATION',
    rawRouteId: line.raw?.routeId ?? null,
    liftSiteId: line.liftSiteId ?? null,
    dropoffSiteId: line.dropoffSiteId ?? null,
  }));
  const ref = lines[0];
  const anyFallback = lines.some((l) => [l.tuyen, l.nang, l.ha].some((v) => String(v).startsWith('FALLBACK')));
  const anyColumn = [ref.tuyen, ref.nang, ref.ha].some((v) => v === 'COLUMN');
  if (anyFallback && anyColumn) counts.MIXED += 1;
  else if (anyFallback) counts.FALLBACK += 1;
  else counts.COLUMN += 1;
  out.push({
    id: row.id,
    identity: row.billOrBookNumber ?? null,
    status: d.body.summary?.status ?? null,
    activeLock: d.body.summary?.activeLock != null,
    containers: lines.length,
    lines,
  });
}
fs.writeFileSync(path.join(OUT, '201026124500_source-classification.json'), JSON.stringify({ counts, lots: out }, null, 2));
console.log(JSON.stringify({ lots: out.length, counts }));
const fallbackLots = out.filter((l) => l.lines.some((x) => [x.tuyen, x.nang, x.ha].some((v) => String(v).startsWith('FALLBACK'))));
console.log('FALLBACK lots:', JSON.stringify(fallbackLots.map((l) => ({ id: l.id, identity: l.identity, status: l.status, lines: l.lines })), null, 1));
