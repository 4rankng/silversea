// Muse QA wave 3b — same-document comparison: does the HTML/PDF render carry the
// same money + plate + class facts the XLSX render carries? Guards against
// reporting a false PASS from a too-lenient header regex, and against missing a
// real "HTML prints empty money" defect.
import {
  API, PIN, uuid, makeLogger, healthGate, login, api,
} from './fullguide-lib.mjs';
import { writeFileSync } from 'node:fs';
import ExcelJS from '../../../backend/node_modules/exceljs/dist/exceljs.js';

const SCOPE = 'qa773c73b1-wave3b';
const logger = makeLogger(SCOPE);
const { step, log } = logger;
const results = {};
const record = (id, verdict, note) => { results[id] = { verdict, note }; step('VERDICT', { id, verdict, note }); };

await healthGate(logger);
const admin = await login('admin');
const cus = await login('thanhdc');
const hex = uuid().slice(0, 6);
const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

const customers = await api(admin.token, 'GET', '/customers?limit=50');
const customerList = (customers.json?.items ?? customers.json ?? []).filter((c) => !c.deletedAt && c.status === 'ACTIVE');
const customer = customerList.find((c) => c.id === 1) ?? customerList[0];
const routes = await api(admin.token, 'GET', '/routes?limit=50');
const routeList = (routes.json?.items ?? routes.json ?? []).filter((r) => !r.deletedAt);
const route = routeList.find((r) => r.id === 11) ?? routeList[0];
const classes = await api(admin.token, 'GET', '/vehicle-size-classes?limit=50');
const classList = classes.json?.items ?? classes.json ?? [];
const cls5t = classList.find((c) => c.code === '5T');

const laneDate = '2032-08-08';
const cleanupPricing = [];
let lotId = null;
try {
  const price = await api(admin.token, 'POST', '/pricing-tables', {
    customerId: customer.id, routeId: route.id, vehicleSizeClassId: cls5t.id,
    price: 2468000, effectiveDate: laneDate, note: `QA773 W3b ${hex}`,
  });
  cleanupPricing.push(price.json?.id);

  const ref = `QA-W3B-${hex}`;
  const rLot = await api(cus.token, 'POST', '/shipments', {
    customerId: customer.id, bookingRef: ref, tradeDirection: 'EXPORT', cargoMode: 'LCL',
    expectedDeliveryDate: today, routeId: route.id,
  });
  lotId = rLot.json?.id;
  const actualPlate = '15H-209.51';
  const virtPlate = `W3BK-${hex.slice(0, 5).toUpperCase()}`;
  await api(cus.token, 'POST', '/shipments/lcl/truck', { shipmentId: lotId, actualTruckNo: actualPlate, billingTruckNo: virtPlate });
  await api(cus.token, 'POST', '/shipments/lcl/rev-class', { shipmentId: lotId, vehicleSizeClassId: cls5t.id });
  await api(cus.token, 'POST', `/shipments/${lotId}/lock`, {});
  const dn = await api(cus.token, 'POST', `/shipments/${lotId}/debit-note`, {}, { 'Idempotency-Key': `idemp-w3b-${hex}` });
  const docId = dn.json?.id;
  step('fixture', { ref, lotId, docId, virtPlate });

  // XLSX
  const buf = await fetch(`${API}/finance/billing-documents/${docId}/export?format=xlsx`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  }).then((r) => r.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const xcells = [];
  ws.eachRow((row) => row.eachCell((cell) => { if (cell.value != null) xcells.push(String(cell.value)); }));
  const xtext = xcells.join(' § ');
  step('xlsx', { cells: xcells.length, money: /2\.468\.000|2468000/.test(xtext), virt: xtext.includes(virtPlate), actual: xtext.includes(actualPlate) });

  // HTML
  const html = await fetch(`${API}/finance/billing-documents/${docId}/export?format=html`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  }).then((r) => r.text());
  writeFileSync(`qa/2026-10-17_${SCOPE}_html.html`, html);

  const fmt = (n) => n.toLocaleString('vi-VN').replace(/\./g, '.');
  const moneyPresent = /2\.468\.000|2468000/.test(html);
  const headerHasBKS = />\s*BKS\s*</i.test(html);
  const headerHasLoaiXe = />\s*LOẠI XE\s*</i.test(html);
  const virt = html.includes(virtPlate);
  const actual = html.includes(actualPlate);

  step('html-facts', { moneyPresent, headerHasBKS, headerHasLoaiXe, virt, actual });

  // Card 171026004331's own contract: the two template columns print WITH their
  // bindings. Money is the money column, a separate (pre-existing) concern.
  const colsOk = headerHasBKS && headerHasLoaiXe && virt && !actual;
  record('CARD-171026004331-HTMLPDF', colsOk ? 'PASS' : 'FAIL',
    `?format=html (and pdf, byte-identical) for doc ${docId}: headers [BKS=${headerHasBKS}, LOẠI XE=${headerHasLoaiXe}] :: cell values [billing BKS "${virtPlate}"=${virt}, actual "${actualPlate}" leaked=${actual}]`);

  const xMoney = /2\.468\.000|2468000/.test(xtext);
  record('MONEY-XLSX-vs-HTML', (xMoney === moneyPresent) ? 'CONSISTENT' : 'DIVERGENT',
    `XLSX money cell printed=${xMoney} :: HTML money cell printed=${moneyPresent} (same doc ${docId}; a divergence would be an HTML-only money defect)`);

  step('SUMMARY', { pin: PIN, results });
  writeFileSync(`qa/${SCOPE}_results.json`, JSON.stringify({ pin: PIN, results }, null, 2));
} catch (e) {
  record('CARD-171026004331-HTMLPDF', 'FAIL', String(e.message ?? e));
  step('error', { e: String(e.message ?? e) });
} finally {
  if (lotId) {
    const s = await api(admin.token, 'GET', `/shipments/${lotId}`).then((r) => r.json?.shipment ?? r.json ?? null).catch(() => null);
    if (s?.id) { const d = await api(admin.token, 'DELETE', `/shipments/${lotId}?version=${s.version}`); step('cleanup-lot', { id: lotId, status: d.status }); }
  }
  for (const id of cleanupPricing) if (id) await api(admin.token, 'DELETE', `/pricing-tables/${id}`, null, { 'If-Unmodified-Since': new Date().toUTCString() }).catch(() => {});
  log('WAVE 3B DONE');
}
