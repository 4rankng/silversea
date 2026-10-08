// Card 365 + 360 QA fixtures (lane CusQA). Staging only.
// Creates, as CUS `thanhdc`, three lots whose codes carry the card numbers so
// no other lane collides:
//   QA365LCL01  LCL lot, no containers, EDD = tomorrow  -> 365 parity fixture
//   QA365FCLNC  FCL lot, no containers, EDD = tomorrow  -> 365 FCL-absence pin
//   QA360FCLW   FCL lot, 2 containers (weights 10000 / 100.50) -> 360 + FCL row pin
// Idempotent: an existing code is reused, never duplicated.
import https from 'node:https';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE || 'https://vantai.tingting.vip';
const IDENT = process.env.IDENTIFIER || 'thanhdc';
const OUT = new URL('../evidence/2026-10-05_hang-le-lcl-365-tong-quan-chi-tiet/seed.json', import.meta.url).pathname;
const OUT_360 = new URL('../evidence/2026-10-05_360-trong-luong-bo-2-so-0-thap-phan/seed.json', import.meta.url).pathname;

function req(method, path, { token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const u = new URL(path.startsWith('http') ? path : BASE + path);
    const r = https.request({
      method, hostname: u.hostname, path: u.pathname + u.search,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let parsed = b; try { parsed = JSON.parse(b); } catch {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// Vietnam calendar day (staging runs UTC; business zone is Asia/Ho_Chi_Minh).
function vnDatePlus(days) {
  const vn = new Date(Date.now() + 7 * 3600 * 1000 + days * 86400 * 1000);
  return vn.toISOString().slice(0, 10);
}

const TOMORROW = vnDatePlus(1);
const TODAY = vnDatePlus(0);
const CUSTOMER_ID = Number(process.env.CUSTOMER_ID || 20);

async function login() {
  const r = await req('POST', '/api/auth/login', { body: { identifier: IDENT, password: 'Abc123' } });
  if (r.status !== 200) throw new Error(`login ${IDENT} -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.token;
}

async function findLot(token, code) {
  const r = await req('GET', `/api/shipments/cus-workspace?searchSuffix=${encodeURIComponent(code)}&limit=50`, { token });
  if (r.status !== 200) throw new Error(`list ${code} -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return (r.body.items || []).find((i) => i.billOrBookNumber === code) || null;
}

async function ensureLot(token, code, payload) {
  let lot = await findLot(token, code);
  if (lot) { console.log(`reuse ${code} shipmentId=${lot.id} version=${lot.version}`); return lot; }
  const r = await req('POST', '/api/shipments', {
    token,
    headers: { 'Idempotency-Key': randomUUID() },
    body: payload,
  });
  if (r.status !== 201) throw new Error(`create ${code} -> ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  console.log(`create ${code} shipmentId=${r.body.id} version=${r.body.version}`);
  lot = await findLot(token, code);
  if (!lot) throw new Error(`create ${code} succeeded but the lot is not listed`);
  return lot;
}

async function ensureContainer(token, code, shipmentId, container) {
  const r = await req('GET', `/api/shipments/cus-workspace/containers?searchSuffix=${encodeURIComponent(code)}&limit=50`, { token });
  const existing = (r.body.items || []).find((i) => i.containerNumber === container.containerNumber);
  if (existing) { console.log(`reuse container ${container.containerNumber} id=${existing.id}`); return existing; }
  const lot = await findLot(token, code);
  const add = await req('POST', `/api/shipments/cus-workspace/${shipmentId}/containers`, {
    token,
    headers: { 'Idempotency-Key': randomUUID() },
    body: { expectedShipmentVersion: lot.version, ...container },
  });
  if (add.status !== 201) throw new Error(`add ${container.containerNumber} -> ${add.status} ${JSON.stringify(add.body).slice(0, 400)}`);
  console.log(`add container ${container.containerNumber} -> id=${add.body?.id ?? add.body?.containerId ?? '?'}`);
  return add.body;
}

const token = await login();

const lcl = await ensureLot(token, 'QA365LCL01', {
  customerId: CUSTOMER_ID,
  cargoMode: 'LCL',
  tradeDirection: 'IMPORT',
  blNumber: 'QA365LCL01',
  expectedDeliveryDate: TOMORROW,
  packageCount: 5,
  packageType: 'Pallet',
  cargoWeightKg: 10000,
  cargoVolumeCbm: 12.5,
  shippingLineName: 'SilverSea',
  factoryName: 'NHÀ MÁY QA365',
});

const fclNoContainer = await ensureLot(token, 'QA365FCLNC', {
  customerId: CUSTOMER_ID,
  cargoMode: 'FCL',
  tradeDirection: 'IMPORT',
  blNumber: 'QA365FCLNC',
  expectedDeliveryDate: TOMORROW,
  packageCount: 1,
  packageType: 'Kiện',
  cargoWeightKg: 1234,
});

let fclWithContainers = await ensureLot(token, 'QA360FCLW', {
  customerId: CUSTOMER_ID,
  cargoMode: 'FCL',
  tradeDirection: 'IMPORT',
  blNumber: 'QA360FCLW',
  expectedDeliveryDate: TOMORROW,
  shippingLineName: 'SilverSea',
});
await ensureContainer(token, 'QA360FCLW', fclWithContainers.id, {
  containerNumber: 'QA360CT1', containerTypeId: 1, cargoWeightKg: '10000', cargoVolumeCbm: '20',
});
await ensureContainer(token, 'QA360FCLW', fclWithContainers.id, {
  containerNumber: 'QA360CT2', containerTypeId: 1, cargoWeightKg: '100.50', cargoVolumeCbm: '20.5',
});

// Fresh reads so the rungs carry the POST-seed truth.
const out = {
  seededAt: new Date().toISOString(),
  base: BASE,
  today: TODAY,
  tomorrow: TOMORROW,
  lcl: await findLot(token, 'QA365LCL01'),
  fclNoContainer: await findLot(token, 'QA365FCLNC'),
  fclWithContainers: await findLot(token, 'QA360FCLW'),
};
const containers = await req('GET', '/api/shipments/cus-workspace/containers?searchSuffix=QA360&limit=50', { token });
out.fclContainers = (containers.body.items || []).filter((i) => String(i.containerNumber || '').startsWith('QA360'));
console.log(JSON.stringify(out, null, 2));
fs.mkdirSync(OUT.replace(/\/seed\.json$/, ''), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
fs.mkdirSync(OUT_360.replace(/\/seed\.json$/, ''), { recursive: true });
fs.writeFileSync(OUT_360, JSON.stringify(out, null, 2));
console.log('wrote', OUT, 'and', OUT_360);
