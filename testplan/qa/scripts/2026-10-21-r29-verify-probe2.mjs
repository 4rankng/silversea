// R29 probe #2 — LCL merge candidates (tiepvv) + paper-order gate state.
import fs from 'node:fs';
const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const LOG = 'qa/2026-10-21-r29-verify/probe2.log';
const log = (l) => { console.log(l); fs.appendFileSync(LOG, l + '\n'); };
fs.writeFileSync(LOG, `probe2 ${new Date().toISOString()}\n`);
async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  if (!res.ok) { log(`LOGIN FAIL ${identifier} ${res.status}`); return null; }
  const { token } = await res.json(); return token;
}
const get = async (t, p) => {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${t}` } });
  const text = await res.text(); try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text.slice(0, 200) }; }
};

// LCL candidates for FB-093 merge
const cus = await login('tiepvv');
const d = await get(cus, '/shipments/debit-summary');
const rows = d.body?.items ?? [];
log(`total rows ${rows.length}`);
const byCustomer = new Map();
for (const r of rows) {
  if (r.cargoMode !== 'LCL') continue;
  if (r.revGroupId != null) continue;
  if (r.lockStatus === 'LOCKED') {
    log(`  skip locked ship=${r.shipmentId} lock=${r.lockStatus}`);
    continue;
  }
  const k = r.customerId;
  if (!byCustomer.has(k)) byCustomer.set(k, { name: r.customerName, rows: [] });
  byCustomer.get(k).rows.push(r);
}
for (const [id, g] of byCustomer) {
  if (g.rows.length >= 2) {
    log(`CUSTOMER ${id} ${g.name}: ${g.rows.length} unlocked LCL lots`);
    for (const r of g.rows.slice(0, 8)) {
      log(`  ship=${r.shipmentId} ${r.code} bill=${r.billOrBookNumber} freightAuto=${r.freightAuto} lock=${r.lockStatus} chiHo=${r.chiHoTotal} truck=${r.actualTruckNo} revClass=${r.revVehicleClassCode}`);
    }
  }
}

// paper-order gate on the NEW cards (FB-019): fetch fulfillment details
const drv = await login('bqhuong');
for (const ful of [596, 352, 322]) {
  const det = await get(drv, `/driver/me/fulfillments/${ful}`);
  log(`ful ${ful} status=${det.status} keys=${det.body ? Object.keys(det.body).slice(0, 30).join(',') : '?'}`);
  if (det.status === 200) {
    const b = det.body;
    log(`  trip=${b.tripId} tripCode=${b.tripCode} status=${b.tripStatus ?? b.status} paper=${b.paperOrderCollectedAt} truck=${b.truckPlate ?? b.truckNo} milestones=${JSON.stringify(b.milestones ?? b.progress ?? null)?.slice(0, 120)}`);
  }
}
log('PROBE2 DONE');
