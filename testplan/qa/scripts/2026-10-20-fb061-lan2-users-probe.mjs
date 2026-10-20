// FB-061 lan 2 (card 201026112400) — /users sample-data census on STAGING.
// READ-ONLY wire probe: login admin → GET /api/auth/users → classify every
// visible user against the FB-061 signature set + generic QA heuristics.
// No mutation. Output: qa/<OUT>/users-census.json + users-probe.log
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = process.env.OUT_DIR || path.resolve(import.meta.dirname, '../../../qa/2026-10-20-fb061-lan2-users');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};

const health = await (await fetch(`${API}/health`)).json();
log('build_gate', { buildHash: health.buildHash });

const r = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!r.ok) { console.error(`BLOCKED: login admin -> ${r.status}`); process.exit(2); }
const { token, user } = await r.json();
log('login', { identifier: 'admin', role: user?.role });

const res = await fetch(`${API}/auth/users?limit=500`, {
  headers: { Authorization: `Bearer ${token}` },
});
const body = await res.json();
const items = body.items ?? [];
log('users_wire', { status: res.status, count: items.length, total: body.total, counts: body.counts });

// FB-061 card signature set (lineage #41–45) applied to user fields.
const SIGNATURES = [
  [/KHO-SEAM/i, 'KHO-SEAM'], [/STG VERIFY/i, 'STG VERIFY'], [/BL-QAKE/i, 'BL-QAKE'],
  [/E2E-/i, 'E2E-'], [/51K-PROBE/i, '51K-PROBE'], [/Test Driver/i, 'Test Driver'],
  [/99T-99999/i, '99T-99999'], [/QA0915/i, 'QA0915'],
];
// Generic QA-ish heuristics (same families the phoi-phieu probe uses).
const GENERIC = [
  [/\bQA[-_ ]?\d/i, 'QA<digit>'], [/-1[0-9]{9,12}$/, 'epoch-suffix'], [/-1[0-9]{12}-/, 'epoch-mid'],
  [/PROBE/i, 'PROBE'], [/VERIFY[- ]?\d/i, 'VERIFY-<n>'], [/fixture/i, 'fixture'],
  [/SEAM-17/i, 'SEAM-17'], [/\bE2E\b/i, 'E2E'], [/test[_ ]?user/i, 'test user'],
  [/\btest\b/i, 'test-token'], [/demo/i, 'demo-token'],
];

const classify = (u) => {
  const hay = [u.username, u.fullName, u.email, u.employeeCode, u.phone].filter(Boolean);
  const hits = [];
  for (const [re, name] of SIGNATURES) if (hay.some((f) => re.test(String(f)))) hits.push(name);
  for (const [re, name] of GENERIC) if (hay.some((f) => re.test(String(f)))) hits.push(name);
  return hits;
};

const flagged = [];
const clean = [];
for (const u of items) {
  const hits = classify(u);
  const row = {
    id: u.id, username: u.username, fullName: u.fullName, email: u.email,
    employeeCode: u.employeeCode ?? null, role: u.role, status: u.status,
    driverId: u.driverId ?? null, createdAt: u.createdAt,
  };
  (hits.length ? flagged : clean).push({ ...row, hits });
}

log('census', {
  visible: items.length,
  flagged: flagged.length,
  clean: clean.length,
  flaggedUsernames: flagged.map((f) => `${f.username}|${f.fullName}|${f.role}|${f.status}|${f.employeeCode ?? '-'}`),
});

fs.writeFileSync(path.join(OUT, 'users-census.json'), JSON.stringify({
  at: new Date().toISOString(), buildHash: health.buildHash,
  visible: items.length, flagged, clean,
}, null, 2));
fs.writeFileSync(path.join(OUT, 'users-probe.log'), LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
console.log(`\nflagged ${flagged.length}/${items.length}; census → ${OUT}/users-census.json`);
