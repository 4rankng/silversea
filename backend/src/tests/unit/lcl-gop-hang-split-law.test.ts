// Spec 23/10 (261023110000) — the pure laws of the cost/rev group split
// (LCL2310-01..03 + wire contract). Unit-only tree: no db, no app boot —
// these exercise the real decision helpers the services write through
// (lcl-grouping-law.ts, shared effectiveBillingPlate) and the Zod wire
// contracts, not source text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignLclCostGroupSchema,
  updateLclCostGroupSchema,
  mergeLclRevGroupSchema,
  setLclLotRevClassSchema,
  updateLclTruckSchema,
  effectiveBillingPlate,
  LCL_REV_MERGE_TAG,
} from '@tingting/shared';
import {
  assertSameRevCustomer,
  costGroupMemberPatch,
  findRevCustomerConflict,
  revGroupMemberPatch,
} from '../../services/lcl-grouping-law';

const now = new Date('2026-10-23T00:00:00Z');

// ─── LCL2310-01 — 2 nhóm độc lập: the two dimensions write disjoint columns ─

test('cost-group patch carries ONLY cost-side columns (gộp ĐV không kéo CUS)', () => {
  const patch = costGroupMemberPatch({
    groupId: 'g1',
    order: 1,
    actualTruckNo: '29H-12345',
    costVehicleClassId: 7,
    costGroupFreightManual: '1500000',
    version: 3,
    updatedBy: 9,
    now,
  });
  assert.deepEqual(Object.keys(patch).sort(), [
    'actualTruckNo',
    'costGroupFreightManual',
    'costGroupId',
    'costGroupOrder',
    'costVehicleClassId',
    'updatedAt',
    'updatedBy',
    'version',
  ]);
  assert.equal(patch.costGroupId, 'g1');
  assert.equal(patch.costGroupOrder, 1);
  assert.equal(patch.costGroupFreightManual, '1500000');
});

test('rev-group patch carries ONLY rev-side columns + BKS báo khách (không đụng ĐV)', () => {
  const patch = revGroupMemberPatch({
    groupId: 'r1',
    order: 2,
    revVehicleClassId: 5,
    billingTruckNo: '51C-99999',
    version: 4,
    updatedBy: 9,
    now,
  });
  assert.deepEqual(Object.keys(patch).sort(), [
    'billingTruckNo',
    'revGroupId',
    'revGroupOrder',
    'revVehicleClassId',
    'updatedAt',
    'updatedBy',
    'version',
  ]);
  assert.equal(patch.revGroupOrder, 2);
  // BKS thực (the ĐV-assigned truck identity) is NOT a CUS write.
  assert.equal('actualTruckNo' in patch, false);
  assert.equal('costGroupFreightManual' in patch, false);
});

test('patches never leak the other dimension even with full args', () => {
  const cost = costGroupMemberPatch({
    groupId: 'g1', order: 2, actualTruckNo: '29H-1', costVehicleClassId: 1,
    version: 1, updatedBy: 1, now,
  });
  for (const key of ['revGroupId', 'revGroupOrder', 'revVehicleClassId', 'billingTruckNo']) {
    assert.equal(key in cost, false, `cost patch leaked ${key}`);
  }
  const rev = revGroupMemberPatch({
    groupId: 'r1', order: 1, revVehicleClassId: 1,
    version: 1, updatedBy: 1, now,
  });
  for (const key of ['costGroupId', 'costGroupOrder', 'costVehicleClassId', 'costGroupFreightManual', 'actualTruckNo']) {
    assert.equal(key in rev, false, `rev patch leaked ${key}`);
  }
  // Omitted optional ⇒ the column is untouched (never silently nulled).
  assert.equal('costGroupFreightManual' in costGroupMemberPatch({
    groupId: 'g1', order: 1, actualTruckNo: '29H-1', costVehicleClassId: 1,
    version: 1, updatedBy: 1, now,
  }), false);
  assert.equal('billingTruckNo' in rev, false);
});

// ─── LCL2310-02 — Gộp CUS chỉ cùng 1 khách hàng ─────────────────────────────

test('same-customer selection passes (hợp lệ ⇒ không conflict)', () => {
  assert.equal(findRevCustomerConflict([
    { id: 1, customerId: 42, reference: 'BILL-1' },
    { id: 2, customerId: 42, reference: 'BILL-2' },
    { id: 3, customerId: 42, reference: 'BILL-3' },
  ]), null);
  assert.doesNotThrow(() => assertSameRevCustomer([
    { id: 1, customerId: 42, reference: 'BILL-1' },
    { id: 2, customerId: 42, reference: 'BILL-2' },
  ]));
});

test('khác khách hàng ⇒ 400 with a per-lot breakdown of both customers', () => {
  const rows = [
    { id: 1, customerId: 42, reference: 'BILL-1' },
    { id: 2, customerId: 77, reference: 'BILL-2' },
    { id: 3, customerId: 42, reference: 'BILL-3' },
  ];
  const conflict = findRevCustomerConflict(rows);
  assert.ok(conflict);
  assert.throws(
    () => assertSameRevCustomer(rows, new Map([[42, 'LONG MINH'], [77, 'HAI PHONG']])),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Chỉ cho phép ghép các lô của cùng một khách hàng/);
      // The 400 names EVERY conflicting lot + its customer (Số Bill, not id).
      assert.match(err.message, /BILL-1 \(Khách hàng: LONG MINH\)/);
      assert.match(err.message, /BILL-2 \(Khách hàng: HAI PHONG\)/);
      assert.match(err.message, /BILL-3 \(Khách hàng: LONG MINH\)/);
      return true;
    },
  );
});

test('lô thiếu khách hàng cũng bị chặn (không gộp được với lô có KH)', () => {
  const rows = [
    { id: 1, customerId: 42, reference: 'BILL-1' },
    { id: 2, customerId: null, reference: 'BILL-2' },
  ];
  assert.ok(findRevCustomerConflict(rows));
  assert.throws(
    () => assertSameRevCustomer(rows),
    /Chưa có khách hàng/,
  );
});

// ─── LCL2310-03 — BKS fallback: BLANK ⇒ BKS thực của lô do ĐV gán (LCL) ────

test('LCL blank BKS báo khách reports the ĐV-assigned BKS thực', () => {
  assert.equal(effectiveBillingPlate({
    billingTruckNo: null, actualTruckNo: '29H-12345', cargoMode: 'LCL',
  }), '29H-12345');
  assert.equal(effectiveBillingPlate({
    billingTruckNo: '   ', actualTruckNo: '29H-12345', cargoMode: 'LCL',
  }), '29H-12345');
});

test('BKS báo khách CUS nhập luôn thắng BKS thực', () => {
  assert.equal(effectiveBillingPlate({
    billingTruckNo: '51C-99999', actualTruckNo: '29H-12345', cargoMode: 'LCL',
  }), '51C-99999');
});

test('LCL chưa gán BKS thực ⇒ blank (không bịa biển số)', () => {
  assert.equal(effectiveBillingPlate({
    billingTruckNo: null, actualTruckNo: null, cargoMode: 'LCL',
  }), null);
});

test('non-LCL giữ luật GAP-3: blank ⇒ không in BKS thực', () => {
  assert.equal(effectiveBillingPlate({
    billingTruckNo: null, actualTruckNo: '29H-12345', cargoMode: 'FCL',
  }), null);
  assert.equal(effectiveBillingPlate({
    billingTruckNo: '51C-99999', actualTruckNo: '29H-12345', cargoMode: 'FCL',
  }), '51C-99999');
});

// ─── Wire contract (spec 23/10: ĐV popup = 4 trường, tag "Ghép thu cước…") ──

test('assignLclCostGroupSchema = đúng 4 trường ĐV — BKS-báo-khách-ảo bị xóa', () => {
  assert.deepEqual(Object.keys(assignLclCostGroupSchema.shape).sort(), [
    'actualTruckNo',
    'carrierId',
    'carrierType',
    'freightCost',
    'shipmentIds',
    'vehicleSizeClassId',
  ]);
  // Unknown keys (the old billing fields) are stripped — the ĐV flow can
  // never write them even if an old client still sends them.
  const parsed = assignLclCostGroupSchema.parse({
    shipmentIds: [11, 12],
    vehicleSizeClassId: 3,
    actualTruckNo: '29H-12345',
    billingTruckNo: 'FAKE-1',
    billingTruckNos: [{ shipmentId: 11, billingTruckNo: 'FAKE-2' }],
  });
  assert.equal('billingTruckNo' in parsed, false);
  assert.equal('billingTruckNos' in parsed, false);
});

test('updateLclCostGroupSchema (SỬA 4 trường): PARTIAL — cần groupId + ≥1 trường', () => {
  const uuid = '8b2f3f3a-8f9e-4a2b-9c1d-0a1b2c3d4e5f';
  // Empty payload (valid uuid) trips the ≥1-field refine — not a uuid error.
  assert.throws(
    () => updateLclCostGroupSchema.parse({ groupId: uuid }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Không có gì để sửa/);
      return true;
    },
  );
  // 3-state freight: number = manual, null = auto (BLANK), omitted = keep.
  assert.equal(updateLclCostGroupSchema.parse({ groupId: uuid, freightCost: 0 }).freightCost, 0);
  assert.equal(updateLclCostGroupSchema.parse({ groupId: uuid, freightCost: null }).freightCost, null);
  assert.equal('freightCost' in updateLclCostGroupSchema.parse({ groupId: uuid, actualTruckNo: '29H-1' }), false);
});

test('mergeLclRevGroupSchema nhận Cước thu Lô 1 (blank=auto, nhập tay=override)', () => {
  const auto = mergeLclRevGroupSchema.parse({
    shipmentIds: [1, 2],
    vehicleSizeClassId: 3,
  });
  assert.equal(auto.freightRevenue, undefined);
  assert.equal(mergeLclRevGroupSchema.parse({
    shipmentIds: [1, 2],
    vehicleSizeClassId: 3,
    freightRevenue: 4_500_000,
  }).freightRevenue, 4_500_000);
  assert.throws(() => mergeLclRevGroupSchema.parse({
    shipmentIds: [1, 2],
    vehicleSizeClassId: 3,
    freightRevenue: -1,
  }));
});

test('setLclLotRevClassSchema (per-lot CUS outputs): ≥1 trong Loại xe / Giá cước', () => {
  assert.throws(() => setLclLotRevClassSchema.parse({ shipmentId: 1 }), /Cần ít nhất/);
  assert.equal(setLclLotRevClassSchema.parse({ shipmentId: 1, freightRevenue: 2_000_000 }).freightRevenue, 2_000_000);
  assert.equal(setLclLotRevClassSchema.parse({ shipmentId: 1, vehicleSizeClassId: 4 }).vehicleSizeClassId, 4);
});

test('updateLclTruckSchema: billingTruckNo null = xóa (BLANK ⇒ BKS thực fallback)', () => {
  assert.equal(updateLclTruckSchema.parse({ shipmentId: 1, billingTruckNo: null }).billingTruckNo, null);
  assert.equal(updateLclTruckSchema.parse({ shipmentId: 1, billingTruckNo: '51C-1' }).billingTruckNo, '51C-1');
  assert.equal('billingTruckNo' in updateLclTruckSchema.parse({ shipmentId: 1, actualTruckNo: '29H-1' }), false);
  // FB-141 (card 231026163927, QA R39 — supersedes the old min(1) law): a
  // BLANK/whitespace billing value passes the wire (the service normalizes
  // `trim() || null` into the clear) — the old 400 "BKS không được để trống"
  // made the clear-to-default undoable, which is exactly what QA reported.
  assert.equal(updateLclTruckSchema.parse({ shipmentId: 1, billingTruckNo: '   ' }).billingTruckNo, '');
  // BKS THỰC keeps the strict law.
  assert.throws(() => updateLclTruckSchema.parse({ shipmentId: 1, actualTruckNo: '   ' }));
});

test('tag của Lô 2..N trong nhóm CUS gộp là "Ghép thu cước cùng Lô 1"', () => {
  assert.equal(LCL_REV_MERGE_TAG, 'Ghép thu cước cùng Lô 1');
});
