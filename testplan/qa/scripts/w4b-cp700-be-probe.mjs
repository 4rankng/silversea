// W4b verify — card 141026230700 BE rule probes (staging API, DRIVER token).
// CP700-03 BE refusal, DRIVER_ROAD exemption, CP700-04 invoiced-without-number
// (+ legacy number retained), ROAD_ALLOWANCE regression pin. Every write rides
// a fresh Idempotency-Key UUID; QA-marked rows for the purge class.
//
//   EXPECT_BUILD=1c00c17a node testplan/qa/scripts/w4b-cp700-be-probe.mjs
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const BASE = 'https://vantai.tingting.vip';
const API = BASE + '/api';
const PIN = process.env.EXPECT_BUILD || '1c00c17a';
const LOG = path.resolve('qa/2026-10-16_w4b-cp700_be-probe.log');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const uuid = () => randomUUID();

const health = await fetch(API + '/health').then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} buildHash=${health?.buildHash} pin=${PIN}`);
if (health?.status !== 'ok' || health?.buildHash !== PIN) { log('ABORT: pin mismatch'); process.exit(2); }

async function login(identifier) {
  const res = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  return res.ok ? (await res.json()).token : null;
}
const token = await login('bqhuong');
if (!token) { log('ABORT: no driver login'); process.exit(2); }
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const today = new Date().toISOString().slice(0, 10);
const tripId = 173; // the Phase-A trip — live shipment, driver-owned

const costs = () => fetch(`${API}/driver/me/trips/${tripId}/incidental-costs`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).then((j) => j.items || []);

// Storage key uploaded by THIS driver for THIS trip in Phase A (tripPhotos
// ownership check in insertDriverIncidentalCostTx requires exactly that).
const RECEIPT_KEY = 'trips/173/other-00bab35345c83998d2717f408122853e.png';

// ── Probe 1 — batch: lot row WITHOUT receipt → 400 exact message, no writes ─
const before = await costs();
const p1 = await fetch(`${API}/driver/me/trips/${tripId}/incidental-costs/batch`, {
  method: 'POST', headers: { ...H, 'Idempotency-Key': uuid() },
  body: JSON.stringify({ items: [{ costType: 'DROP_FEE', costGroup: 'DRIVER_SHIPMENT', feeName: 'QA-W4B-CP700-BE-NORECEIPT', amount: 7000, occurredAt: today }] }),
});
const p1body = await p1.json().catch(() => ({}));
log(`P1 lot-no-receipt batch -> ${p1.status} ${JSON.stringify(p1body).slice(0, 220)}`);
const afterP1 = await costs();
log(`P1 rows before=${before.length} after=${afterP1.length} (unchanged=${afterP1.length === before.length})`);

// ── Probe 2 — ROAD_ALLOWANCE driver-sent → 400 'Khoản này do hệ thống tự ghi nhận.' ─
const p2 = await fetch(`${API}/driver/me/trips/${tripId}/incidental-costs/batch`, {
  method: 'POST', headers: { ...H, 'Idempotency-Key': uuid() },
  body: JSON.stringify({ items: [{ costType: 'ROAD_ALLOWANCE', costGroup: 'DRIVER_ROAD', feeName: 'QA-W4B-CP700-BE-RA', amount: 6000, occurredAt: today }] }),
});
const p2body = await p2.json().catch(() => ({}));
log(`P2 ROAD_ALLOWANCE batch -> ${p2.status} ${JSON.stringify(p2body).slice(0, 220)}`);

// ── Probe 3 — DRIVER_ROAD exemption: TOLL without photo → 201 ───────────────
const p3 = await fetch(`${API}/driver/me/trips/${tripId}/incidental-costs`, {
  method: 'POST', headers: { ...H, 'Idempotency-Key': uuid() },
  body: JSON.stringify({ costType: 'TOLL', costGroup: 'DRIVER_ROAD', feeName: 'QA-W4B-CP700-BE-ROAD', amount: 3000, occurredAt: today, note: 'QA-W4B CP700-03 road exemption' }),
});
const p3body = await p3.json().catch(() => ({}));
log(`P3 road-no-receipt single -> ${p3.status} id=${p3body?.id} receipt=${JSON.stringify(p3body?.receiptStorageKey)} evidenceKind=${JSON.stringify(p3body?.evidenceKind)}`);

// ── Probe 4 — CP700-04: FEE_CLEANING (requires_invoice) + photo, NO number → 201, invoiceNumber null ─
const p4 = await fetch(`${API}/driver/me/trips/${tripId}/incidental-costs`, {
  method: 'POST', headers: { ...H, 'Idempotency-Key': uuid() },
  body: JSON.stringify({ costType: 'CONTAINER_WASH', costGroup: 'DRIVER_SHIPMENT', expenseTypeCode: 'FEE_CLEANING', feeName: 'QA-W4B-CP700-BE-FC', amount: 9000, occurredAt: today, receiptStorageKey: RECEIPT_KEY }),
});
const p4body = await p4.json().catch(() => ({}));
log(`P4 FEE_CLEANING+photo-no-number -> ${p4.status} invoiceNumber=${JSON.stringify(p4body?.invoiceNumber)} evidenceKind=${JSON.stringify(p4body?.evidenceKind)} id=${p4body?.id}`);

// ── Probe 5 — CP700-04 legacy caller: FEE_CLEANING + photo + typed number → stored ─
const p5 = await fetch(`${API}/driver/me/trips/${tripId}/incidental-costs`, {
  method: 'POST', headers: { ...H, 'Idempotency-Key': uuid() },
  body: JSON.stringify({ costType: 'CONTAINER_WASH', costGroup: 'DRIVER_SHIPMENT', expenseTypeCode: 'FEE_CLEANING', feeName: 'QA-W4B-CP700-BE-FC-LEGACY', amount: 9500, occurredAt: today, receiptStorageKey: RECEIPT_KEY, invoiceNumber: 'QA-W4B-HD-001', invoiceDate: today }),
});
const p5body = await p5.json().catch(() => ({}));
log(`P5 FEE_CLEANING+photo+typed-number -> ${p5.status} invoiceNumber=${JSON.stringify(p5body?.invoiceNumber)} invoiceDate=${JSON.stringify(p5body?.invoiceDate)} id=${p5body?.id}`);

// ── Probe 6 — evidence-kind RECEIPT without photo on a road row → 400 ───────
const p6 = await fetch(`${API}/driver/me/trips/${tripId}/incidental-costs`, {
  method: 'POST', headers: { ...H, 'Idempotency-Key': uuid() },
  body: JSON.stringify({ costType: 'OTHER', costGroup: 'DRIVER_ROAD', feeName: 'QA-W4B-CP700-BE-RECEIPTKIND', amount: 2000, occurredAt: today, evidenceKind: 'RECEIPT' }),
});
const p6body = await p6.json().catch(() => ({}));
log(`P6 road+RECEIPT-kind-no-photo -> ${p6.status} ${JSON.stringify(p6body).slice(0, 200)}`);

// Final census on the trip.
const final = await costs();
log(`FINAL trip=${tripId} rows=${final.length} qaMarked=${final.filter((c) => (c.note || '').startsWith('QA-W4B') || (c.feeName || '').startsWith('QA-W4B')).map((c) => c.id).join(',')}`);
log('DONE');
