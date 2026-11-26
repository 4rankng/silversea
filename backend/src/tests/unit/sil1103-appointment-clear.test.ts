// SIL-1103 (K2.128) — "Không thể xóa lịch hẹn cuối cùng của container khi lô
// đã sẵn sàng điều xe" fired on a lot that was NEVER dispatched (no trip
// commands issued): QA lot 1314 saved 28/11 10:00 fine, then clearing the
// date/time segments 409'd on the direct API call. The guard's law is
// dispatched DEPENDENCE, not the READY status label — the same law card
// 091026091510 already pinned for the lot-level date clear in
// shipment-update.service (409 only while a live trip rides the lot;
// otherwise the save reverts the lot to PENDING_DATE).
//
// Pinned at the allowed unit boundary (no live DB, following the SIL-177
// guard-pin precedent): the pure clear/409 boundary helper is exercised
// behaviorally, and both service wirings (batch reconcile "Sửa thông tin lô"
// + CUS container-line command) are source-pinned for the trip gate, the
// preserved 409, and the PENDING_DATE demotion.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { containersLosingAppointment } from '../../services/shipment-containers.service';

const here = dirname(fileURLToPath(import.meta.url));
const containersService = readFileSync(join(here, '../../services/shipment-containers.service.ts'), 'utf8');
const writesService = readFileSync(join(here, '../../services/cus-shipment-workspace-writes.service.ts'), 'utf8');

const reconcileFlow = () => containersService.slice(
  containersService.indexOf('export async function reconcileShipmentContainersInTx'),
  containersService.indexOf('export async function reconcileShipmentContainersWithFulfillmentGuard'),
);

const lineUpdateFlow = () => writesService.slice(
  writesService.indexOf('export async function updateCusShipmentContainer'),
  writesService.indexOf('async function findActiveTripForContainer'),
);

// ─── Behavioral: which rows lose their appointment (the clear boundary) ──────

describe('containersLosingAppointment — SIL-1103 clear boundary', () => {
  const current = [
    { id: 11, customerAppointmentAt: new Date('2026-11-28T03:00:00.000Z') },
    { id: 12, customerAppointmentAt: null },
  ];

  it('clear-succeeds lane: an explicit empty appointment over a stored one is detected as lost', () => {
    assert.deepEqual(
      containersLosingAppointment(current, [
        { id: 11, customerAppointmentAt: null },
      ]),
      [11],
    );
  });

  it('clear-succeeds lane: omitting the row from the batch (delete-by-reconcile) loses its appointment', () => {
    assert.deepEqual(
      containersLosingAppointment(current, [{ id: 12, customerAppointmentAt: null }]),
      [11],
    );
  });

  it('an untouched payload keeps every stored appointment — the guard stays unreachable', () => {
    assert.deepEqual(
      containersLosingAppointment(current, [
        { id: 11, customerAppointmentAt: '2026-11-28T10:00:00+07:00' },
        { id: 12 },
      ]),
      [],
    );
  });

  it('a re-dated write is not a loss; new id-less rows never lose anything', () => {
    assert.deepEqual(
      containersLosingAppointment(current, [
        { id: 11, customerAppointmentAt: '2026-11-29T10:00:00+07:00' },
        { customerAppointmentAt: '2026-11-30T08:00:00+07:00' },
      ]),
      [],
    );
  });
});

// ─── Wiring: batch reconcile ("Sửa thông tin lô" → PUT /shipments/:id/containers) ──

describe('SIL-1103 reconcile guard — 409 only on dispatched dependence', () => {
  it('the lost-appointment set is computed BEFORE the live-trip gate', () => {
    const flow = reconcileFlow();
    const computedAt = flow.indexOf('containersLosingAppointment(current, synchronizedContainers)');
    const tripGateAt = flow.indexOf("from(s.trips)\n      .leftJoin(s.shipmentFulfillments");
    assert.ok(computedAt > -1, 'thiếu tập lịch hẹn bị xóa (containersLosingAppointment)');
    assert.ok(tripGateAt > -1, 'thiếu truy vấn chuyến xe đang chạy');
    assert.ok(tripGateAt > computedAt, 'live-trip gate phải chạy SAU khi tính tập xóa lịch');
  });

  it('clear-still-409-with-active-trip: the 409 fires ONLY inside the live-trip branch, message intact', () => {
    const flow = reconcileFlow();
    const guardAt = flow.indexOf('Không thể xóa lịch hẹn cuối cùng của container khi lô đã sẵn sàng điều xe.');
    assert.ok(guardAt > -1, 'mất message guard 409');
    const liveTripBranchAt = flow.indexOf('if (liveTrip)');
    assert.ok(liveTripBranchAt > -1, 'thiếu nhánh liveTrip');
    assert.ok(flow.indexOf('if (liveTrip) {', liveTripBranchAt + 1) === -1,
      'chỉ MỘT nhánh liveTrip trong reconcile');
    assert.ok(guardAt > liveTripBranchAt && guardAt < liveTripBranchAt + 200,
      '409 phải nằm trong nhánh liveTrip duy nhất');
    assert.match(flow, /isNull\(s\.trips\.deletedAt\),[\s\S]*?ne\(s\.trips\.status, 'CANCELED'\)/,
      'live trip = non-deleted, non-CANCELED (chuẩn card 091026091510)');
  });

  it('clear-succeeds-without-trips: the trip-free clear demotes the lot to PENDING_DATE', () => {
    const flow = reconcileFlow();
    const demoteAt = flow.lastIndexOf('if (clearsLastAppointment) {');
    const tail = flow.slice(demoteAt);
    assert.ok(demoteAt > flow.indexOf("if (liveTrip)"), 'demotion phải nằm sau gate 409');
    assert.match(tail, /status: 'PENDING_DATE' as const/);
    assert.match(tail, /expectedDeliveryDate: null/);
    assert.match(tail, /Đã xóa lịch hẹn đóng\/trả cuối cùng — lô quay lại chờ chốt lịch\./);
    assert.match(tail, /cancellationReason: 'Shipment schedule cleared'/,
      'revert phải hủy fulfillments như lot-level revert (card 091026091510)');
  });
});

// ─── Wiring: CUS container-line command (workspace editor) ──────────────────

describe('SIL-1103 workspace line guard — 409 only with a live trip on the row', () => {
  it('clear-still-409-with-active-trip: the guard conditions the 409 on the row\'s live trip', () => {
    const flow = lineUpdateFlow();
    const guardAt = flow.indexOf('Không thể xóa lịch hẹn cuối cùng của container khi lô đã sẵn sàng điều xe.');
    assert.ok(guardAt > -1, 'mất message guard 409');
    const clearsAt = flow.indexOf('const clearsLastAppointment = shipment.cargoMode === CARGO_MODE.FCL');
    const throwAt = flow.indexOf('if (clearsLastAppointment && trip != null)');
    assert.ok(clearsAt > -1 && throwAt > -1, 'thiếu điều kiện clearsLastAppointment/trip');
    // `trip` here is the value-aware trip select (non-deleted, non-CANCELED).
    assert.match(flow.slice(0, clearsAt), /isNull\(s\.trips\.deletedAt\),[\s\S]*?ne\(s\.trips\.status, 'CANCELED'\)/);
    assert.match(flow.slice(throwAt, guardAt + 120), /throw new ApiError\(409/);
  });

  it('clear-succeeds-without-trips: the trip-free clear reverts READY → PENDING_DATE with history', () => {
    const flow = lineUpdateFlow();
    const demoteAt = flow.indexOf('if (becomesUnscheduled) {');
    assert.ok(demoteAt > flow.indexOf("if (clearsLastAppointment && trip != null)"),
      'demotion phải nằm sau guard 409');
    const tail = flow.slice(demoteAt);
    assert.match(tail, /toStatus: ShipmentStatus\.PENDING_DATE/);
    assert.match(tail, /fromStatus: ShipmentStatus\.READY_FOR_DISPATCH/);
    assert.match(tail, /Đã xóa lịch hẹn đóng\/trả cuối cùng — lô quay lại chờ chốt lịch\./);
    assert.match(tail, /cancellationReason: 'Shipment schedule cleared'/);
    assert.match(flow, /\.\.\.\(becomesUnscheduled \? \{ status: ShipmentStatus\.PENDING_DATE \} : \{\}\)/,
      'update shipments phải ghi status PENDING_DATE khi clear hợp lệ');
  });
});
