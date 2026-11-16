// Account probe on staging (read-only login POSTs only).
import { writeFileSync } from 'node:fs';
const API = 'https://vantai.tingting.vip/api';
const out = [];
const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); out.push(s); };
const tries = [['admin', 'Abc123'], ['ketoan', 'Abc123'], ['laixe', 'Abc123'], ['giamdoc', 'Abc123'], ['khachhang', 'Abc123'], ['thanhdc', 'Abc123'], ['dungnv', 'Abc123'], ['dvthuc', 'Abc123'], ['hoangnh', 'Abc123'], ['cus', 'Abc123'], ['giaonhan', 'Abc123']];
(async () => {
  for (const [identifier, password] of tries) {
    try {
      const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
      const b = await r.json().catch(() => ({}));
      log(identifier, r.status, b.token ? `TOKEN role=${b.user?.role ?? '?'}` : JSON.stringify(b).slice(0, 120));
    } catch (e) { log(identifier, 'ERR', e.message); }
  }
  writeFileSync('/Volumes/LexarSSD/projects/silversea/qa/2026-11-16_staging-accounts-probe.log', out.join('\n') + '\n');
})();
