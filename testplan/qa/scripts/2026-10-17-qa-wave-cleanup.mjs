// QA wave cleanup — delete ONLY lots this wave created (tag-matched), or a
// flagged single id. Never touches rows without an explicit tag match.
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const login = async (id) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) });
  if (!r.ok) throw new Error(`login ${id} ${r.status}`);
  return (await r.json()).token;
};
const token = await login('admin');
const call = async (method, path, body) => {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (method !== 'GET') headers['Idempotency-Key'] = `qa-cleanup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const r = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, ok: r.ok, text };
};
const only = process.argv[2]; // optional exact numeric id
const r = await call('GET', '/shipments?limit=100&page=1');
const j = JSON.parse(r.text);
const items = j.items ?? j.data ?? [];
const TAGS = /^(FB105|FB106|FB107|KBQA|CLF-086-QA|FB086QA)/i;
const targets = only
  ? items.filter((s) => String(s.id) === only)
  : items.filter((s) => TAGS.test(s.blNumber || '') || TAGS.test(s.bookingRef || ''));
for (const s of targets) {
  const label = s.blNumber || s.bookingRef || `(no-ref id=${s.id})`;
  if (!only && !TAGS.test(s.blNumber || '') && !TAGS.test(s.bookingRef || '')) {
    console.log(`SKIP id=${s.id} ${label} (no tag)`);
    continue;
  }
  const d = await call('DELETE', `/shipments/cus-workspace/${s.id}`, { version: s.version, reason: 'QA dọn fixture (kanban QA wave 17/10)' });
  console.log(`${d.ok ? 'DELETED' : 'FAILED'} id=${s.id} ${label} → ${d.status} ${d.text.slice(0, 200)}`);
}
console.log(`done, ${targets.length} candidate(s)`);
