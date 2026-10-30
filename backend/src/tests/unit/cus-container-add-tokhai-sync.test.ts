// SIL-173 (FB-148): "Thêm container" phải kéo số tờ khai CẤP LÔ xuống MỌI dòng
// container trống của lô (kể cả dòng thêm sau) — cùng luật fan-out CUS-05 mà
// SIL-166 (da2eb512) gắn vào upsertShipmentDeclaration. Pin ở hai ranh giới
// unit cho phép (không db): wire schema của kết quả add, và wiring nguồn vào
// addCusShipmentContainer.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shipmentCusContainerAddResultSchema } from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const writes = readFileSync(join(here, '../../services/cus-shipment-workspace-writes.service.ts'), 'utf8');

const addFlow = () => writes.slice(
  writes.indexOf('export async function addCusShipmentContainer'),
  writes.indexOf('export async function removeCusShipmentContainer'),
);

const baseLine = {
  id: 11, ordinal: 3, operationalSiteId: null, containerNumber: 'MSKU4120016',
  declarationNumber: 'R41B2TK01', containerTypeId: null, containerTypeLabel: null,
  routeId: null, routeName: null, dispatchStatus: 'AWAITING_VEHICLE', tripId: null,
  tripStatus: null, tripDepartureDate: null, carrierType: null, externalCarrierId: null, externalCarrierVehicleId: null,
  carrierName: null, plateNumber: null, liftSiteId: null, liftSite: null,
  dropoffSiteId: null, dropoffSite: null, customerAppointmentAt: null,
  raw: { containerNumber: 'MSKU4120016', containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null, routeId: null },
  fieldAccess: Object.fromEntries([
    'operationalSiteId', 'containerNumber', 'containerTypeId', 'cargoWeightKg', 'cargoVolumeCbm', 'routeId',
    'carrierType', 'externalCarrierId', 'externalCarrierVehicleId', 'plateNumber', 'liftSiteId', 'dropoffSiteId', 'customerAppointmentAt',
  ].map((key) => [key, { mode: 'DIRECT', reason: 'trường kiểm thử' }])),
  permissions: {
    carrierEditable: true, plateEditable: true, containerTypeEditable: true,
    routeEditable: true, liftSiteEditable: true, dropoffSiteEditable: true,
    customerAppointmentEditable: true,
  },
  shipmentVersion: 4, relatedTripVersion: null,
};

// ─── SIL173-R6: wire schema khai báo fan-out ─────────────────────────────────

test('add-result chấp nhận declarationSync (cùng shape line-update) và vẫn hợp lệ khi thiếu', () => {
  const withSync = shipmentCusContainerAddResultSchema.parse({
    line: baseLine,
    declarationSync: { updatedContainerIds: [11, 250] },
  });
  assert.deepEqual(withSync.declarationSync?.updatedContainerIds, [11, 250]);
  const withoutSync = shipmentCusContainerAddResultSchema.parse({ line: baseLine });
  assert.equal(withoutSync.declarationSync, undefined);
});

test('add-result strict: trường lạ vẫn bị từ chối', () => {
  assert.equal(shipmentCusContainerAddResultSchema.safeParse({
    line: baseLine, bogusFanout: true,
  }).success, false);
});

// ─── Wiring: fan-out cấp lô chạy trong tx của add ────────────────────────────

test('add pulls lot-level declaration và chạy syncDeclarationOntoEmptyContainers (FB-109 helper SIL-166)', () => {
  const flow = addFlow();
  assert.match(flow, /listShipmentDeclarations\(args\.shipmentId, tx\)/);
  assert.match(flow, /syncDeclarationOntoEmptyContainers\(tx, args\.shipmentId, lotDeclarationNumber\)/);
});

test('fan-out lấy số tờ khai ĐẦU TIÊN không trống của lô (newest-first như listShipmentDeclarations)', () => {
  assert.match(addFlow(), /lotDeclarations\.find\(\(row\) => row\.declarationNumber\?\.trim\(\)\)\?\.declarationNumber \?\? null/);
});

test('fan-out nằm TRƯỚC projectShipmentScheduleAndVersion — 1 lần bump cho cả add (SIL173-R7)', () => {
  const flow = addFlow();
  const syncAt = flow.indexOf('await syncDeclarationOntoEmptyContainers');
  const projectAt = flow.indexOf('await projectShipmentScheduleAndVersion');
  assert.ok(syncAt > -1 && projectAt > syncAt, 'fan-out phải chạy trước version projection');
  // Không bump riêng cho fan-out trong add flow (bump duy nhất nằm trong projection).
  const bumpCount = (flow.match(/version: shipment!?\.\w*version \+ 1/g) ?? []).length;
  assert.ok(bumpCount <= 1, `add flow phải bump đúng 1 lần, thấy ${bumpCount}`);
});

test('response khai báo declarationSync khi fan-out ghi ≥ 1 dòng', () => {
  assert.match(addFlow(), /declarationSynced\.length > 0[\s\S]*?updatedContainerIds: declarationSynced\.map/);
});

// ─── Không hồi quy: sibling-inherit per-cont giữ nguyên (card 181026185900) ──

test('insert vẫn inherit tờ khai per-cont từ sibling (SIL173-R4)', () => {
  assert.match(addFlow(), /declarationNumber: inheritLotDefault\(\(row\) => row\.declarationNumber\)/);
});
