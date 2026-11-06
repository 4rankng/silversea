// SIL-716 probe — số tờ khai nhập phải PERSIST (reload còn nguyên).
// Ba đường ghi mà FE CUS dùng (use-cus-detail.saveDocuments):
//   A. FCL container row  — POST /shipments/cus-workspace/:id/containers/:cid {declarationNumber}
//   B. Lot-level row tạo  — POST /shipments/:id/declarations {declarationNumber}
//   C. Lot-level row sửa  — PUT  /shipments/:id/declarations/:did {declarationNumber}
// EXPECT: mỗi đường ghi xong, CUS workspace detail + DB vẫn còn đúng giá trị.
// Usage: QA_API=http://localhost:3102/api node testplan/qa/scripts/2026-11-07-sil716-declaration-persist.mjs
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'http://localhost:3102/api';
const OUT = path.resolve(process.env.QA_OUT || 'qa/2026-11-07-lane-r1');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `sil716-api-${process.env.QA_TAG || 'run'}.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
let failures = 0;
const check = (name, ok, detail = '') => { log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures += 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (identifier, password = 'Abc123') => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const authed = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const TAG = `SIL716-${Date.now()}`;
const cus = await login('cus');
log(`LOGIN ok TAG=${TAG} API=${API}`);

const detail = async (id) => fetch(`${API}/shipments/cus-workspace/${id}`, { headers: authed(cus) }).then((r) => r.json());
const waitReady = async (id) => {
  for (let i = 0; i < 80; i++) {
    const d = await detail(id);
    const st = d?.shipment?.status ?? d?.summary?.status ?? d?.status;
    if (st === 'READY_FOR_DISPATCH' || st === 'DISPATCHED') return d;
    await sleep(3000);
  }
  return null;
};

// ── A. FCL: tờ khai theo container-line command ──
const blA = `${TAG}-FCL`;
const created = await fetch(`${API}/shipments/quick`, {
  method: 'POST', headers: { ...authed(cus), 'Idempotency-Key': `${blA}-c` },
  body: JSON.stringify({
    customerId: 1, tradeDirection: 'IMPORT', blNumber: blA, cargoMode: 'FCL',
    containers: [{ containerTypeId: 1, containerNumber: null, cargoWeightKg: 5000, customerAppointmentAt: `${new Date(Date.now() + 96 * 3600e3).toISOString().slice(0, 10)}T01:00:00.000Z`, routeId: 106, pickupPortId: 1, dropoffPortId: 2 }],
  }),
});
const ca = await created.json();
log(`create FCL ${ca.id}`);
const dA = await waitReady(ca.id);
if (!dA) throw new Error('FCL lot never became READY_FOR_DISPATCH');
const lineA = (dA.containers ?? dA.lines ?? [])[0];
const verA = dA.summary?.version ?? dA.shipment?.version;
log(`FCL detail: line=${lineA?.id ?? JSON.stringify(Object.keys(dA))} version=${verA}`);
const DECL_A = `${TAG}-TK1`;
const saveA = await fetch(`${API}/shipments/cus-workspace/${ca.id}/containers/${lineA.id}`, {
  method: 'POST', headers: { ...authed(cus), 'Idempotency-Key': `sil716-line-${ca.id}` },
  body: JSON.stringify({ expectedShipmentVersion: verA, declarationNumber: DECL_A }),
});
const saveAText = await saveA.text();
log(`container-line declaration -> ${saveA.status} ${saveAText.slice(0, 160)}`);
check('A: container-line ghi tờ khai OK', saveA.ok);
const reloadA = await detail(ca.id);
const lineAAfter = (reloadA.containers ?? reloadA.lines ?? []).find((x) => x.id === lineA.id);
const gotA = lineAAfter?.declarationNumber ?? lineAAfter?.raw?.declarationNumber ?? null;
check('A: reload CUS detail còn tờ khai', gotA === DECL_A, `got=${gotA}`);
const { execSync } = await import('node:child_process');
const dbA = execSync(`docker exec ss-prod-db psql -U postgres -d silversea -tAc "select declaration_number from shipment_containers where shipment_id=${ca.id};"`, { encoding: 'utf8' }).trim();
check('A: DB shipment_containers.declaration_number còn', dbA === DECL_A, `got=${dbA}`);

// ── B/C. LCL: tờ khai theo shipment-declaration API (lot-level row) ──
const blB = `${TAG}-LCL`;
const createdB = await fetch(`${API}/shipments/quick`, {
  method: 'POST', headers: { ...authed(cus), 'Idempotency-Key': `${blB}-c` },
  body: JSON.stringify({ customerId: 1, tradeDirection: 'IMPORT', blNumber: blB, cargoMode: 'LCL', routeId: 106, cargoWeightKg: 6000 }),
});
const cb = await createdB.json();
log(`create LCL ${cb.id}`);
const subB = await fetch(`${API}/shipments/${cb.id}/submit-for-dispatch`, { method: 'POST', headers: { ...authed(cus), 'Idempotency-Key': `${blB}-sub` }, body: JSON.stringify({ expectedVersion: 1 }) });
log(`submit-for-dispatch LCL -> ${subB.status} ${(await subB.text()).slice(0, 140)}`);
const DECL_B = `${TAG}-TK2`;
const decB = await fetch(`${API}/shipments/${cb.id}/declarations`, {
  method: 'POST', headers: { ...authed(cus), 'Idempotency-Key': `sil716-decl-${cb.id}` },
  body: JSON.stringify({ declarationNumber: DECL_B }),
});
const decBText = await decB.text();
log(`lot declaration create -> ${decB.status} ${decBText.slice(0, 200)}`);
check('B: lot-level POST /declarations OK (không 400)', decB.status === 201 || decB.status === 200, decBText.slice(0, 160));
const reloadB = await detail(cb.id);
const rawB = reloadB.summary?.raw ?? reloadB;
const gotB = rawB.declarationNumber ?? null;
const declsB = rawB.declarations ?? [];
check('B: reload CUS detail còn tờ khai (lot-level)', gotB === DECL_B, `got=${gotB} declarations=${JSON.stringify(declsB).slice(0, 200)}`);
const dbB = execSync(`docker exec ss-prod-db psql -U postgres -d silversea -tAc "select declaration_number from shipment_declarations where shipment_id=${cb.id};"`, { encoding: 'utf8' }).trim();
check('B: DB shipment_declarations còn', dbB === DECL_B, `got=${dbB}`);

// C. sửa lại số tờ khai trên chính declaration row đó
const declRow = (declsB.find((x) => x.declarationNumber === DECL_B) ?? declsB[0]) ?? JSON.parse(decBText);
const DECL_C = `${TAG}-TK2B`;
const decC = await fetch(`${API}/shipments/${cb.id}/declarations/${declRow.id}`, {
  method: 'PUT', headers: { ...authed(cus), 'Idempotency-Key': `sil716-declupd-${cb.id}` },
  body: JSON.stringify({ declarationNumber: DECL_C }),
});
log(`lot declaration update -> ${decC.status} ${(await decC.text()).slice(0, 160)}`);
check('C: PUT /declarations/:id OK', decC.ok);
const reloadC = await detail(cb.id);
const rawC = reloadC.summary?.raw ?? reloadC;
check('C: reload còn số MỚI', rawC.declarationNumber === DECL_C, `got=${rawC.declarationNumber}`);
const dbC = execSync(`docker exec ss-prod-db psql -U postgres -d silversea -tAc "select declaration_number from shipment_declarations where shipment_id=${cb.id};"`, { encoding: 'utf8' }).trim();
check('C: DB còn số MỚI', dbC === DECL_C, `got=${dbC}`);

log(`DONE failures=${failures}`);
process.exit(failures ? 1 : 0);
