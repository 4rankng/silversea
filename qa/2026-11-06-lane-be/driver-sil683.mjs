// SIL-683 driver — transport-register completionDate vs the trip's completedAt.
// Usage: node driver-sil683.mjs <baseUrl> <from> <to> [search]
// Mirrors the ticket probe: GET /api/finance/billing-documents/transport-register
// for a working window, print each row's completionDate.
const [baseUrl, from, to, search] = process.argv.slice(2);
if (!baseUrl || !from || !to) { console.error('usage: node driver-sil683.mjs <baseUrl> <from> <to> [search]'); process.exit(2); }

const api = `${baseUrl.replace(/\/$/, '')}/api`;
const loginRes = await fetch(`${api}/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'ketoan', password: 'Abc123' }),
});
const login = await loginRes.json();
if (!loginRes.ok) { console.error('LOGIN FAILED', loginRes.status, JSON.stringify(login)); process.exit(1); }
const token = login.token ?? login.accessToken ?? login.data?.token ?? login.data?.accessToken;
if (!token) { console.error('NO TOKEN IN LOGIN RESPONSE', JSON.stringify(login).slice(0, 400)); process.exit(1); }

const url = new URL(`${api}/finance/billing-documents/transport-register`);
url.searchParams.set('from', from); url.searchParams.set('to', to);
if (search) url.searchParams.set('search', search);
const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
const body = await res.json().catch(() => null);
if (!res.ok) { console.error(`register ${from}..${to}: HTTP ${res.status}`, JSON.stringify(body)); process.exit(1); }
console.log(`window ${from}..${to}: HTTP ${res.status} total=${body.total}`);
for (const row of body.items ?? []) {
  console.log(`tripId=${row.tripId} ${row.tripCode} completionDate=${row.completionDate}`);
}
