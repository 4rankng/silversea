// R29 re-verify (2026-10-21) — staging data probe for the 5 FAIL items.
// READ-ONLY: logins + GETs only. Reports what repro conditions already exist.
// Usage: node testplan/qa/scripts/2026-10-21-r29-verify-probe.mjs
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const OUT = path.resolve('qa/2026-10-21-r29-verify');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'probe.log');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) { log(`LOGIN FAIL ${identifier} HTTP ${res.status}`); return null; }
  const { token, user } = await res.json();
  log(`LOGIN ok ${identifier} role=${user?.role ?? '?'}`);
  return token;
}
const get = async (token, p) => {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  return { status: res.status, body };
};

fs.writeFileSync(LOG, `R29 probe ${new Date().toISOString()} api=${API}\n`);

// ── FB-019: driver bqhuong board ──────────────────────────────────────────
log('\n== FB-019 probe: bqhuong journey board ==');
const drv = await login('bqhuong');
if (drv) {
  const board = await get(drv, '/driver/me/journey-board');
  const items = board.body?.items ?? [];
  log(`board status=${board.status} items=${items.length}`);
  for (const it of items) {
    log(`  [${it.bucket}] ful=${it.fulfillmentId} trip=${it.tripId} code=${it.tripCode} bill=${it.blNumber} booking=${it.bookingRef} truck=${it.truckPlate} status=? pairLocked=${it.pairLocked}`);
  }
}

// ── FB-033: ops wallet state per ops user ────────────────────────────────
log('\n== FB-033 probe: ops wallet summaries ==');
for (const u of ['giaonhan', 'hoangnh', 'hungld', 'duongtt', 'tuvn', 'hoangnm', 'cuongvd']) {
  const t = await login(u);
  if (!t) continue;
  const w = await get(t, '/ops/wallet/summary');
  log(`wallet ${u}: status=${w.status} body=${JSON.stringify(w.body).slice(0, 400)}`);
}

// ── FB-093: CUS tiepvv debit rows — look for merge groups / candidates ───
log('\n== FB-093 probe: tiepvv debit-summary ==');
const cus = await login('tiepvv');
if (cus) {
  const d = await get(cus, '/shipments/debit-summary');
  const rows = d.body?.rows ?? d.body?.items ?? [];
  log(`debit-summary status=${d.status} rows=${rows.length}`);
  const keys = rows[0] ? Object.keys(rows[0]).slice(0, 40) : [];
  log(`row keys: ${keys.join(',')}`);
  for (const r of rows.slice(0, 30)) {
    const rev = r.freightAuto ?? r.revenue ?? '?';
    const grp = r.revGroupId ?? r.revGroup ?? null;
    const note = r.freightOverrideReason ?? r.overrideReason ?? null;
    log(`  ship=${r.shipmentId ?? r.id} code=${r.shipmentCode ?? r.code} bill=${r.blNumber ?? r.bookingRef ?? '?'} rev=${rev} revGroup=${grp ? String(grp).slice(0, 8) : '-'} note=${note ? String(note).slice(0, 50) : '-'} trip=${r.tripStatus ?? r.tripId ?? '?'}`);
  }
}

log('\nPROBE DONE');
