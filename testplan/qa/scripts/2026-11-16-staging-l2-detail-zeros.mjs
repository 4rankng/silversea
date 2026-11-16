// L2 per-lot debit detail for the named pairs — fake-zero check (Bảng 2.1).
import { writeFileSync } from 'node:fs';
const API = process.env.API ?? 'https://vantai.tingting.vip/api';
const out = [];
const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); out.push(s); };
async function login(identifier) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const b = await r.json();
  if (!b.token) throw new Error(`login ${identifier} -> ${r.status}`);
  return { auth: { Authorization: `Bearer ${b.token}` } };
}
const get = (a, p) => fetch(`${API}${p}`, { headers: a.auth }).then(async r => ({ s: r.status, b: await r.json().catch(() => null) }));

(async () => {
  const admin = await login('admin');
  for (const id of [775, 776, 777, 759, 760, 772, 773, 778]) {
    const { s, b } = await get(admin, `/shipments/${id}/debit-detail`);
    if (s !== 200) { log(`LOT ${id} status ${s}`, JSON.stringify(b).slice(0, 200)); continue; }
    const j = JSON.stringify(b);
    const pick = {};
    for (const k of ['contractFreightTotal', 'freightCharge', 'freightAuto', 'receivableTotal', 'chiHoTotal', 'serviceTotal', 'total', 'sellTotal', 'freight']) {
      const m = j.match(new RegExp(`"${k}":("[^"]*"|[0-9.]+|null)`));
      if (m) pick[k] = m[1];
    }
    log(`LOT ${id}`, pick);
  }
  writeFileSync('/Volumes/LexarSSD/projects/silversea/qa/2026-11-16_staging-l2-detail-zeros.log', out.join('\n') + '\n');
})();
