// Full L2 debit-detail dump for R3N-KR1 (775) + R3M-KR1 (772) — every money field.
import { writeFileSync } from 'node:fs';
const API = 'https://vantai.tingting.vip/api';
const out = [];
const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x, null, 1)).join(' '); out.push(s); };
async function login(identifier) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const b = await r.json();
  return { auth: { Authorization: `Bearer ${b.token}` } };
}
(async () => {
  const admin = await login('admin');
  for (const id of [775, 772]) {
    const b = await fetch(`${API}/shipments/${id}/debit-detail`, { headers: admin.auth }).then(r => r.json());
    log(`LOT ${id}`, b);
  }
  writeFileSync('/Volumes/LexarSSD/projects/silversea/qa/2026-11-16_staging-l2-full-dump.log', out.join('\n') + '\n');
})();
