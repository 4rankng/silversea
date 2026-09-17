// HAHA-INVTYPE rollback probe (card 20260916_19 staging rung): an entry on a
// requiresInvoice type with no evidence must make the settlement create throw
// inside runTx — 400 + ROLLBACK (no partial settlement, entry stays open).
const API = (process.env.STAGING_URL || 'https://vantai.tingting.vip').replace(/\/$/, '') + '/api';
const IDK = () => crypto.randomUUID();

async function login(identifier) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  return (await r.json()).token;
}

async function call(token, method, path, body, key) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (key) headers['Idempotency-Key'] = key;
  const r = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed, raw: text };
}

const admin = await login('admin');
const hungld = await login('hungld');

const listBefore = await call(hungld, 'GET', '/ops/settlements?limit=50');
const beforeItems = listBefore.body.items ?? listBefore.body ?? [];
const countBefore = Array.isArray(beforeItems) ? beforeItems.length : 0;
console.log('settlements before:', countBefore);

const exp = await call(admin, 'POST', '/expense-accounting/entries', {
  tripId: 31,
  expenseTypeCode: 'HAHA-INVTYPE',
  amount: 60000,
  customerChargeAmount: 0,
  expenseDate: new Date().toISOString().slice(0, 10),
  costGroup: 'OPS_INCIDENTAL',
  feeName: 'HAHA-INVTYPE rollback probe',
  payerKind: 'USER',
  payerUserId: 4,
  note: 'HAHA-INVTYPE rollback probe — requiresInvoice, no evidence',
});
const ej = exp.body;
console.log('entry →', exp.status, 'id=' + ej?.id, 'status=' + ej?.status, 'paidById=' + ej?.paidById);

const s = await call(hungld, 'POST', '/ops/settlements', { note: 'HAHA-INVTYPE rollback probe' });
console.log('settlement create →', s.status, JSON.stringify(s.body).slice(0, 160));

const listAfter = await call(hungld, 'GET', '/ops/settlements?limit=50');
const afterItems = listAfter.body.items ?? listAfter.body ?? [];
const countAfter = Array.isArray(afterItems) ? afterItems.length : 0;
console.log('settlements before/after:', countBefore, '/', countAfter,
  countBefore === countAfter ? '⇒ ROLLBACK held (no partial settlement)' : '⇒ COUNT CHANGED');
