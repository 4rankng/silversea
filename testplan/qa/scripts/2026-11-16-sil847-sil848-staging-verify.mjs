// SIL-847 verify probe — staging read-only (build 4db1a331 = local HEAD).
// 1) /shipments/debit-summary rows for the R3N/R3M pairs — fake-zero check.
// 2) /driver/me/journey-board for R3P-677-R — badge resolution check.
import { writeFileSync } from 'node:fs';
const API = 'https://vantai.tingting.vip/api';
const out = [];
const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); out.push(s); console.log(s); };

async function login(identifier) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const b = await r.json();
  if (!b.token) throw new Error(`login ${identifier} -> ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
  return { token: b.token, user: b.user, auth: { Authorization: `Bearer ${b.token}` } };
}

const pick = (h) => ({
  id: h.shipmentId ?? h.id, code: h.code, bill: h.billOrBookNumber ?? h.blNumber, lock: h.lockStatus,
  freightAuto: h.freightAuto, receivableTotal: h.receivableTotal, chiHoTotal: h.chiHoTotal,
  revGroupId: h.revGroupId, revOrder: h.revGroupOrder, revMembers: h.revGroupMemberCount,
  overrideReason: h.freightOverrideReason, chiHoSell: h.chiHoSellTotal, svcSell: h.serviceSellTotal,
  docs: h.documentsSummary, cust: h.customerName ?? h.customer?.name,
});

async function main() {
  const ketoan = await login('admin');
  log('login', ketoan.user?.username, ketoan.user?.role);
  const sum = await fetch(`${API}/shipments/debit-summary?lockStatus=ALL`, { headers: ketoan.auth }).then(r => r.json());
  const items = sum.items ?? sum.data?.items ?? [];
  log('debit-summary rows:', items.length);
  const hits = items.filter(it => /R3[NMP]/.test(JSON.stringify(it)));
  log('R3 rows:', hits.length);
  for (const h of hits) log('ROW', pick(h));

  // driver journey board — find the account whose board has R3P-677-R
  for (const who of ['dvthuc', 'admin', 'dungnv']) {
    try {
      const s = await login(who);
      const board = await fetch(`${API}/driver/me/journey-board`, { headers: s.auth }).then(r => r.json());
      const cards = board.cards ?? board.items ?? board.data ?? board;
      const arr = Array.isArray(cards) ? cards : (cards?.cards ?? cards?.items ?? []);
      const hits2 = arr.filter(c => /R3P-677|RTAU401105/.test(JSON.stringify(c)));
      log(`board ${who}: ${arr.length} cards, R3P hits: ${hits2.length}`);
      for (const c of hits2) log('CARD', {
        bl: c.blNumber, tripId: c.tripId, classification: c.classification, linked: c.linked,
        pairId: c.pairId, pairKind: c.pairKind, containers: (c.containers ?? []).map(x => x.containerNumber),
      });
    } catch (e) { log(`board ${who}: ERR ${e.message}`); }
  }
}

main().catch(e => { log('FATAL', e.message); }).then(() => {
  writeFileSync('/Volumes/LexarSSD/projects/silversea/qa/2026-11-16_sil847-verify-staging.log', out.join('\n') + '\n');
});
