// Search staging shipments client-side for codes/BL/containers across pages.
// Usage: node probe-shipments-search-20261005.mjs <user> <needle> [maxPages]
const BASE = 'https://vantai.tingting.vip';
const [user, needle, maxPages = '20'] = process.argv.slice(2);
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: user, password: 'Abc123' }),
});
const lj = await login.json();
const token = lj.token || lj.accessToken || (lj.data && lj.data.token);
if (!token) { console.log('LOGIN FAIL', JSON.stringify(lj).slice(0, 300)); process.exit(1); }
const H = { authorization: `Bearer ${token}` };
const hit = (o) => JSON.stringify(o).toLowerCase().includes(needle.toLowerCase());
for (let page = 1; page <= Number(maxPages); page++) {
  const r = await fetch(`${BASE}/api/shipments?limit=100&page=${page}`, { headers: H });
  const j = await r.json();
  const items = j.items || j.data || [];
  if (!items.length) { console.log(`page ${page}: empty, stop`); break; }
  const matches = items.filter(hit);
  for (const m of matches) {
    console.log(`HIT page ${page}: id=${m.id} code=${m.shipmentCode} bl=${m.blNumber} status=${m.status} cargoMode=${m.cargoMode}`);
  }
  console.log(`page ${page}: ${items.length} items, ${matches.length} hits`);
}
