// W3b r20 — targeted purge of the 7 abandoned 'Nhà xe E2E <hex>' QA carriers
// (case QA-2026-10-04-345; FAIL record testplan/2026-10-16-w3b-r20-verify.md).
// Owner instruction 2026-10-16: purge ONLY the QA-pattern carriers; every real
// carrier must be untouched (names-compared before/after).
//
// Path: the in-app admin API (soft-delete via governed CRUD — the same
// sanctioned surface the customers screen uses), never ad-hoc SQL.
// Guards: build pin, name+createdAt pattern match, expected-count bound,
// If-Unmodified-Since optimistic lock per row, abort-on-first-failure.
// Verify: re-run testplan/qa/scripts/w3b-r20-customer-seed.mjs afterwards
// (covers carrier catalog + KH list + CUS picker UI).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://vantai.tingting.vip/api';
const EXPECT_BUILD = process.env.QA_EXPECT_BUILD || '2888f77f';
const EXPECTED_COUNT = Number(process.env.EXPECTED_PURGE_COUNT || 7);
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-16_w3b-r20-verify');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
let exitCode = 0;

// The abandoned batch signature: exactly 'Nhà xe E2E ' + 8 hex chars, created
// 2026-09-30T23:19–23:30Z (W3b census). Both conditions must hold.
const QA_NAME = /^Nhà xe E2E [0-9A-Fa-f]{8}$/;
const QA_CREATED_DAY = '2026-09-30';

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT_BUILD });
if (health.buildHash !== EXPECT_BUILD) { console.error('STALE BUILD — abort'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const token = (await login.json()).token;
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const listCustomers = async (qs) => {
  const r = await fetch(`${API}/customers${qs}`, { headers: H }).then((x) => x.json());
  const items = r.items ?? r.customers ?? r ?? [];
  return Array.isArray(items) ? items : [];
};

const nameOf = (c) => c.name ?? c.customerName ?? c.companyName ?? '?';
const carriersBefore = await listCustomers('?isCarrier=true&limit=200');
const defaultBefore = await listCustomers('?limit=200');
const realBefore = carriersBefore.filter((c) => !QA_NAME.test(nameOf(c))).map(nameOf).sort();
const targets = carriersBefore.filter((c) =>
  QA_NAME.test(nameOf(c)) && String(c.createdAt ?? '').startsWith(QA_CREATED_DAY));

log('before', {
  carriersTotal: carriersBefore.length,
  realCarriers: realBefore.length,
  defaultKhCount: defaultBefore.length,
  targets: targets.map((c) => ({ id: c.id, name: nameOf(c), createdAt: c.createdAt })),
});

if (targets.length !== EXPECTED_COUNT) {
  console.error(`GUARD: expected ${EXPECTED_COUNT} QA carriers, matched ${targets.length} — aborting, NOTHING deleted`);
  log('guard-abort', { matched: targets.length, expected: EXPECTED_COUNT });
  fs.writeFileSync(path.join(OUT, 'carrier-purge_log.json'), JSON.stringify(LOG, null, 2));
  process.exit(3);
}

// Purge — one governed soft-delete per carrier, optimistic-locked.
for (const target of [...targets].sort((a, b) => a.id - b.id)) {
  const res = await fetch(`${API}/customers/${target.id}`, {
    method: 'DELETE',
    headers: {
      ...H,
      'Idempotency-Key': crypto.randomUUID(),
      // Raw ISO like the FE transport (client.ts): toUTCString() drops the
      // milliseconds and the optimistic lock 409s on :350-style stamps.
      'If-Unmodified-Since': target.updatedAt,
    },
    body: JSON.stringify({ reason: 'W3b r20: dọn carrier QA bỏ hoang (case QA-2026-10-04-345, owner 2026-10-16)' }),
  });
  const body = await res.text();
  log('delete', { id: target.id, name: nameOf(target), status: res.status, body: body.slice(0, 200) });
  if (!res.ok) {
    console.error(`DELETE ${target.id} FAILED (${res.status}) — aborting remaining deletes for inspection`);
    exitCode = 4;
    break;
  }
}

// After-state: carriers list, real-name identity, KH default list.
const carriersAfter = await listCustomers('?isCarrier=true&limit=200');
const defaultAfter = await listCustomers('?limit=200');
const realAfter = carriersAfter.filter((c) => !QA_NAME.test(nameOf(c))).map(nameOf).sort();
const qaAfter = carriersAfter.filter((c) => QA_NAME.test(nameOf(c))).map(nameOf);
const realUnchanged = JSON.stringify(realBefore) === JSON.stringify(realAfter);
log('after', {
  carriersTotal: carriersAfter.length,
  realCarriers: realAfter.length,
  qaRemaining: qaAfter,
  defaultKhCount: defaultAfter.length,
  realUnchanged,
});

const pass = exitCode === 0 && qaAfter.length === 0 && realUnchanged
  && carriersAfter.length === carriersBefore.length - EXPECTED_COUNT
  && defaultAfter.length === defaultBefore.length;
log('TC', { id: 'CARRIER-PURGE', verdict: pass ? 'PASS' : 'FAIL' });
if (!pass) exitCode = exitCode || 1;

fs.writeFileSync(path.join(OUT, 'carrier-purge_log.json'), JSON.stringify(LOG, null, 2));
process.exit(exitCode);
