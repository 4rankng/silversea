// Staging API fixture probe — login via POST /api/auth/login, then GET endpoints given on argv.
// Usage: node probe-api-20261005.mjs <user> <path> [path...]   (paths under /api)
const BASE = 'https://vantai.tingting.vip';
const [user, ...paths] = process.argv.slice(2);
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: user, password: 'Abc123' }),
});
const lj = await login.json().catch(() => ({}));
const token = lj.token || lj.accessToken || (lj.data && lj.data.token);
if (!token) { console.log('LOGIN FAIL', login.status, JSON.stringify(lj).slice(0, 300)); process.exit(1); }
console.log('LOGIN OK as', user);
for (const p of paths) {
  const r = await fetch(`${BASE}/api${p}`, { headers: { authorization: `Bearer ${token}` } });
  const t = await r.text();
  console.log(`--- ${p} -> ${r.status}`);
  console.log(t.slice(0, 4000));
}
