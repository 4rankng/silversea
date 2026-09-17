// Priority driver for LEAD task: run the chungtu-regression API cases
// (TC-CUS-API-*) with a minimal API-only ctx shim (NO browser — QA holds the
// single browser), then smoke the new governance endpoints for role authz.
// Fixtures: HAHA-* where the smoke creates anything (it only reads).
const BASE = (process.env.STAGING_URL || 'https://vantai.tingting.vip').replace(/\/$/, '');
const API = `${BASE}/api`;
const PASSWORD = 'Abc123';

async function login(identifier) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login ${identifier}: ${r.status}`);
  return (await r.json()).token;
}

async function main() {
  const tokens = {
    ADMIN: await login('admin'),
    CUS: await login('thanhdc'),
    DISPATCHER: await login('dungnv'),
    DRIVER: await login('dvthuc'),
  };

  // ── Part 1: the two API regression cases (ctx shim, CUS token) ──────────
  const ctx = {
    env: { api: API, baseUrl: BASE },
    token: tokens.CUS,
    async apiGet(path) {
      const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${tokens.CUS}` } });
      const text = await r.text();
      return { status: r.status, body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
    },
  };
  const { default: masterRefCase } = await import('../cases/chungtu-regression/TC-CUS-API-MASTERREF-001.mjs');
  const { default: errContractCase } = await import('../cases/chungtu-regression/TC-CUS-API-ERRCONTRACT-001.mjs');
  const masterRef = await masterRefCase(ctx);
  const errContract = await errContractCase(ctx);
  console.log('=== CHUNGTU API CASES ===');
  console.log(`TC-CUS-API-MASTERREF-001: ${masterRef.verdict}`);
  console.log(`  createLeg: ${masterRef.phantomCreate?.detail ?? '-'} | updateLeg: ${masterRef.phantomUpdate?.detail ?? '-'} | fixture: ${masterRef.fixtureShipmentId ?? '-'}`);
  if (masterRef.errors?.length) console.log(`  notes: ${masterRef.errors.join(' | ')}`);
  console.log(`TC-CUS-API-ERRCONTRACT-001: ${errContract.verdict}`);
  if (errContract.probe) console.log(`  probe: ${errContract.probe.status} ${errContract.probe.error} | details: ${JSON.stringify(errContract.probe.details).slice(0, 160)}`);
  if (errContract.reason) console.log(`  reason: ${errContract.reason}`);

  // ── Part 2: new governance endpoints — role authz matrix ───────────────
  console.log('=== NEW ENDPOINT ROLE MATRIX ===');
  const endpoints = [
    ['GET', '/expense-accounting/entries?page=1&limit=5'],
    ['GET', '/finance/debt-offsets?page=1&limit=5'],
    ['GET', '/advance-requests?page=1&limit=5'],
  ];
  for (const [method, path] of endpoints) {
    const row = [];
    for (const [role, token] of Object.entries(tokens)) {
      const r = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      const text = await r.text();
      let detail = text.slice(0, 60);
      if (r.status < 400) {
        try {
          const parsed = JSON.parse(text);
          const items = parsed.items ?? parsed.data ?? parsed;
          detail = `items=${Array.isArray(items) ? items.length : 'ok'}`;
        } catch { detail = 'ok'; }
      }
      row.push(`${role}=${r.status} (${detail})`);
    }
    console.log(`${method} ${path}\n  ${row.join('\n  ')}`);
  }
  console.log('=== DONE ===');
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
