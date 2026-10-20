// Ticket 201026090200 (card 191026202000 verify-fail): does the chốt-debit
// board wire carry operational (short) names for customer + nhà xe?
// RED before the fix: customerName/carrier labels are full legal names.
const API = process.env.API || 'http://localhost:3002/api';

import httpModule from 'node:http';

const http = (method, path, { body, token } = {}) => new Promise((resolve, reject) => {
  const r = httpModule.request(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
  }, (res) => {
    let b = '';
    res.on('data', (c) => (b += c));
    res.on('end', () => { let j = b; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: j }); });
  });
  r.on('error', reject);
  if (body) r.write(JSON.stringify(body));
  r.end();
});

async function main() {
  const login = await http('POST', '/auth/login', { body: { identifier: 'admin', password: 'Abc123' } });
  if (login.status !== 200) throw new Error(`login -> ${login.status}`);
  const token = login.body.token;
  const board = await http('GET', '/accounting/debit-board', { token });
  if (board.status !== 200) throw new Error(`board -> ${board.status}`);
  const items = board.body.items ?? [];
  if (items.length === 0) { console.log(JSON.stringify({ verdict: 'NO_ROWS' })); return; }
  // Prefer rows that actually exercise the Phân xe carrier-label path; fall
  // back to the head of the list when none do.
  const withLabels = items.filter((r) => (r.phanXe ?? []).some((p) => p.trim() !== ''));
  const sampleSource = withLabels.length > 0 ? withLabels : items;
  const sample = sampleSource.slice(0, 5).map((r) => ({
    code: r.code,
    customerName: r.customerName,
    phanXe: r.phanXe,
    customerId: r.customerId,
  }));
  const legalCustomer = sample.some((r) => r.customerName != null && r.customerName.length > 40);
  console.log(JSON.stringify({
    verdict: legalCustomer ? 'RED_FULL_NAMES_PRESENT' : 'NAMES_LOOK_SHORT_OR_ABSENT',
    rowCount: items.length,
    sample,
  }, null, 2));
}

main().catch((e) => { console.error('PROBE_ERROR', e.message); process.exit(1); });
