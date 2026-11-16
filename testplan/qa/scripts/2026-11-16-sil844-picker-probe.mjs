// SIL-844 probe (read-only): which /ops/orders lots render the expense-modal
// container picker DISABLED (containerIds empty) on staging, and why.
import { writeFileSync } from 'node:fs';
const API = 'https://vantai.tingting.vip/api';
const out = [];
const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); out.push(s); };
async function login(identifier) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const b = await r.json();
  if (!b.token) throw new Error(`login ${identifier} -> ${r.status}`);
  return { auth: { Authorization: `Bearer ${b.token}` }, user: b.user };
}
const get = (a, p) => fetch(`${API}${p}`, { headers: a.auth }).then(async r => ({ s: r.status, b: await r.json().catch(() => null) }));

(async () => {
  const ops = await login('hoangnh');
  log('login hoangnh ok, role', ops.user?.role);
  // sweep last 14 days of the ops plan list (old build: date param required, defaults today)
  const seen = new Map();
  let emptyDays = 0, totalItems = 0;
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const r = await get(ops, `/ops/orders?date=${iso}`);
    const items = r.b?.items ?? [];
    if (items.length === 0) emptyDays++;
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.set(it.id, it);
      totalItems++;
    }
  }
  log('days swept: 14, empty days:', emptyDays, 'distinct lots:', totalItems);
  const pickerDisabled = [...seen.values()].filter(it => (it.containerIds ?? []).length === 0);
  log('lots with picker DISABLED (containerIds empty):', pickerDisabled.length);
  for (const it of pickerDisabled) {
    log('DISABLED', { id: it.id, code: it.shipmentCode, bill: it.billRef, cargoMode: it.cargoMode, status: it.status, containerCount: it.containerCount, numbers: it.containerNumbers });
    // inspect real container rows
    const d = await get(ops, `/shipments/${it.id}`);
    const conts = d.b?.containers ?? [];
    log('  containers raw:', conts.map(c => ({ id: c.id, num: c.containerNumber, mode: c.cargoMode ?? null })));
  }
  const enabled = [...seen.values()].filter(it => (it.containerIds ?? []).length > 0);
  log('lots with picker ENABLED:', enabled.length, 'sample:', enabled.slice(0, 3).map(it => ({ id: it.id, bill: it.billRef, mode: it.cargoMode, ids: it.containerIds, nums: it.containerNumbers })));
  writeFileSync('/Volumes/LexarSSD/projects/silversea/qa/2026-11-16_sil844-picker-probe.log', out.join('\n') + '\n');
})();
