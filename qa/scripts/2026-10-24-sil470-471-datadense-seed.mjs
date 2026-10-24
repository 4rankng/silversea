// QA data seed (LOCAL ONLY) — SIL-470/471 UI drive needs real rows through the
// REAL workflow (POST /api/expenses → Ghi nợ → vendor ledger → payables
// summary). No fake UI data anywhere; these are ordinary local-dev expense
// records the driver pages read back. 3 suppliers (one phone=null → sub-line
// absent case), 7 UNPAID phiếu, backdated so the entry-date badge shows.
// Run: node qa/scripts/2026-10-24-sil470-471-datadense-seed.mjs
import fs from 'node:fs';

const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const MARK = '/tmp/sil470-471-seed-ids.json';

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }),
});
if (!login.ok) { console.error('ABORT login', login.status); process.exit(2); }
const { token } = await login.json();

if (fs.existsSync(MARK)) {
  console.log('SKIP: seed already applied (marker', MARK, 'exists)');
  process.exit(0);
}

const SEED = [
  { expenseDate: '2026-10-20', supplierId: 4, categoryId: 1, truckId: 1, vehicleComponent: 'TRUCK', amount: '1250000' },
  { expenseDate: '2026-10-06', supplierId: 4, categoryId: 7, truckId: 2, vehicleComponent: 'TRUCK', amount: '480000' },
  { expenseDate: '2026-09-30', supplierId: 8, categoryId: 1, truckId: 3, vehicleComponent: 'TRUCK', amount: '3400000' },
  { expenseDate: '2026-08-21', supplierId: 4, categoryId: 1, truckId: null, vehicleComponent: 'TRUCK', amount: '890000' },
  { expenseDate: '2026-08-19', supplierId: 6, categoryId: 7, truckId: 4, vehicleComponent: 'TRUCK', amount: '2750000' },
  { expenseDate: '2026-07-08', supplierId: 6, categoryId: 1, truckId: 5, vehicleComponent: 'TRUCK', amount: '6200000' },
  { expenseDate: '2026-06-15', supplierId: 8, categoryId: 7, truckId: 1, vehicleComponent: 'TRUCK', amount: '1100000' },
];

const created = [];
for (const [i, body] of SEED.entries()) {
  const res = await fetch(`${API}/expenses/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Idempotency-Key': `sil470-471-seed-${i}-${body.expenseDate}` },
    body: JSON.stringify({ ...body, paymentStatus: 'UNPAID', reason: 'QA data-dense redesign drive 24/10 (SIL-470/471)' }),
  });
  const text = await res.text();
  console.log(`seed[${i}] ${body.expenseDate} supplier=${body.supplierId} → ${res.status} ${text.slice(0, 120)}`);
  if (!res.ok && res.status !== 200) { console.error('ABORT seed failure'); process.exit(1); }
  created.push(JSON.parse(text).id ?? null);
}
fs.writeFileSync(MARK, JSON.stringify(created));
console.log('created ids:', created.join(','));

const summary = await fetch(`${API}/reports/payables-summary`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
console.log('payables after seed:', JSON.stringify({ totalSuppliers: summary.totalSuppliers, totalOutstanding: summary.totalOutstanding, totals: summary.totals }));
