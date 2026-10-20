// FB-036 wire + DB proof: correct API path (/shipments/dispatch-detail-plan-rows),
// then match the rendered phones back to the drivers roster in the DB.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-r25-regressions');
const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }) });
const { token } = await login.json();

const wire = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&page=1`, { headers: { Authorization: `Bearer ${token}` } });
const body = await wire.json();
const rows = body.items ?? [];
const withPhone = rows.filter((r) => r?.dispatch?.assignedDriverPhone);
log('fb036-wire-proof', {
  status: wire.status,
  rows: rows.length,
  rowsWithPhone: withPhone.length,
  plannedBranch: withPhone.filter((r) => r.dispatch.tripId == null).length,
  tripBranch: withPhone.filter((r) => r.dispatch.tripId != null).length,
  sample: withPhone.slice(0, 6).map((r) => ({
    shipmentCode: r.shipmentCode,
    plate: r.dispatch.assignedPlate,
    driver: r.dispatch.assignedDriverName,
    phone: r.dispatch.assignedDriverPhone,
    tripId: r.dispatch.tripId ?? null,
  })),
});

if (withPhone.length > 0) {
  const phones = [...new Set(withPhone.map((r) => r.dispatch.assignedDriverPhone))].slice(0, 8);
  const names = [...new Set(withPhone.map((r) => r.dispatch.assignedDriverName))].slice(0, 8);
  const sql = `select name, phone from drivers where deleted_at is null and phone in (${phones.map((p) => `'${p}'`).join(',')}) order by name;`;
  try {
    const roster = execSync(`docker exec ss-prod-db psql -U postgres -d silversea -Atc ${JSON.stringify(sql)}`, { encoding: 'utf8' }).trim();
    log('fb036-db-proof', { sql, roster, wireNames: names, wirePhones: phones });
  } catch (err) {
    log('fb036-db-proof-failed', { message: String(err.message).slice(0, 200) });
    process.exitCode = 1;
  }
} else {
  log('fb036-db-proof', { skipped: 'no rows with phone on the wire' });
}

fs.writeFileSync(path.join(OUT, 'fb036-wire-db-proof.log'), LOG.map((l) => JSON.stringify(l)).join('\n') + '\n');
