// SIL-751 (id 871) — 'Hủy phân xe' left the lot's stored status DISPATCHED
// while the plan grid already read "Chưa phân xe": only the COMPLETED branch
// of the trip status machine recomputed the shipment. This file pins the
// rewind boundary (pure predicate) and the wiring (source scans — the DB
// path itself is integration territory owned by qa/scripts per the BE
// unit-only ruling).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRewindShipmentToReady } from '../../services/shipment-status-transitions.service';

const servicesDir = path.resolve(process.cwd(), 'src/services');
const read = (file: string) => readFileSync(path.join(servicesDir, file), 'utf8');

test('rewind fires only for a DISPATCHED lot with no live and no completed trip', () => {
  assert.equal(shouldRewindShipmentToReady('DISPATCHED', 0, 0), true, 'last live trip canceled → back to ready');
  assert.equal(shouldRewindShipmentToReady('DISPATCHED', 1, 0), false, 'another live trip keeps the lot dispatched');
  assert.equal(shouldRewindShipmentToReady('DISPATCHED', 0, 1), false, 'a completed leg stays on the completion recompute');
  assert.equal(shouldRewindShipmentToReady('IN_TRANSIT', 0, 0), false, 'IN_TRANSIT lifecycle is not this rewind');
  assert.equal(shouldRewindShipmentToReady('READY_FOR_DISPATCH', 0, 0), false, 'already ready — no-op');
  assert.equal(shouldRewindShipmentToReady('COMPLETED', 0, 0), false, 'terminal');
  assert.equal(shouldRewindShipmentToReady('CANCELED', 0, 0), false, 'terminal');
  assert.equal(shouldRewindShipmentToReady(null, 0, 0), false, 'unknown status never rewinds');
});

test('the trip status machine rewinds the shipment inside the canceled branch', () => {
  const machine = read('trip-status-machine.service.ts');
  assert.match(
    machine,
    /rewindShipmentAfterLastLiveTripCancel/,
    'CANCELED branch must call the shipment rewind',
  );
  const canceledBranch = machine.slice(machine.indexOf("targetStatus === TripStatus.CANCELED"));
  assert.match(canceledBranch, /shipmentFulfillments\.shipmentId/, 'resolves the lot through the fulfillment when the trip carries none');
});

test('the shipment machine legalizes DISPATCHED → READY_FOR_DISPATCH for the rewind', () => {
  const transitions = read('shipment-status-transitions.service.ts');
  const dispatchedList = transitions.match(/DISPATCHED: \[([^\]]+)\]/)?.[1] ?? '';
  assert.match(dispatchedList, /'READY_FOR_DISPATCH'/, 'rewind edge must be legal');
});

test('rewind skips instead of throwing when the lot cannot legally hold READY_FOR_DISPATCH', () => {
  const transitions = read('shipment-status-transitions.service.ts');
  const rewindBody = transitions.slice(
    transitions.indexOf('rewindShipmentAfterLastLiveTripCancel'),
    transitions.indexOf('export async function recomputeShipmentCompletion'),
  );
  assert.match(rewindBody, /hasDispatchDate\(shipment\)/, 'missing dispatch dates → skip, not 409 inside the cancel tx');
  assert.match(rewindBody, /shouldRewindShipmentToReady\(/, 'decision rides the pinned pure predicate');
});

test('SIL-751 — reopen zeroed the ghost total of a released draft batch', () => {
  const settlements = read('ops-settlements.service.ts');
  const reopenBody = settlements.slice(settlements.indexOf('reopenOpsSettlementDraft'));
  assert.match(
    reopenBody,
    /status: 'VOIDED', totalAmount: '0'/,
    'a VOIDED phiếu keeps zero lines, so its header must read 0 — the audit payload keeps the original',
  );
});
