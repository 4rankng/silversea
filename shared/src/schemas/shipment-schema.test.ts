import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createShipmentSchema, quickCreateShipmentSchema, updateShipmentSchema, QUICK_CREATE_SHIPMENT_KEYS } from './index';

test('shipment schemas accept canonical calendar dates', () => {
  assert.equal(createShipmentSchema.safeParse({
    customerId: 1,
    expectedDeliveryDate: '2026-08-04',
  }).success, true);
  assert.equal(updateShipmentSchema.safeParse({
    expectedVersion: 1,
    expectedDeliveryDate: '2026-08-04',
  }).success, true);
});

test('shipment schemas reject malformed and impossible delivery dates', () => {
  for (const expectedDeliveryDate of ['04/08/2026', '2026-8-4', '2026-02-30', '2026-13-01']) {
    assert.equal(createShipmentSchema.safeParse({
      customerId: 1,
      expectedDeliveryDate,
    }).success, false);
    assert.equal(updateShipmentSchema.safeParse({
      expectedVersion: 1,
      expectedDeliveryDate,
    }).success, false);
  }
});

test('shipment schemas preserve nullable delivery-date compatibility', () => {
  assert.equal(createShipmentSchema.safeParse({ customerId: 1, expectedDeliveryDate: null }).success, true);
  assert.equal(updateShipmentSchema.safeParse({ expectedVersion: 1, expectedDeliveryDate: null }).success, true);
});

test('shipment schemas carry the explicit consolidation flag', () => {
  const created = createShipmentSchema.parse({ customerId: 1, isCombined: true });
  assert.equal(created.isCombined, true);
  const updated = updateShipmentSchema.parse({ expectedVersion: 1, isCombined: false });
  assert.equal(updated.isCombined, false);
});

test('shipment write schemas accept recipient-specific driver notes', () => {
  const created = createShipmentSchema.parse({ customerId: 1, driverNotes: 'Gọi trước khi vào cổng' });
  const updated = updateShipmentSchema.parse({ expectedVersion: 1, driverNotes: null });

  assert.equal(created.driverNotes, 'Gọi trước khi vào cổng');
  assert.equal(updated.driverNotes, null);
});

test('shipment schemas reject a Bill and Booking on the same shipment', () => {
  assert.equal(createShipmentSchema.safeParse({
    customerId: 1,
    tradeDirection: 'IMPORT',
    blNumber: 'BL-IMPORT-01',
    bookingRef: 'BOOK-EXPORT-01',
  }).success, false);
  assert.equal(updateShipmentSchema.safeParse({
    expectedVersion: 1,
    tradeDirection: 'EXPORT',
    blNumber: 'BL-IMPORT-01',
    bookingRef: 'BOOK-EXPORT-01',
  }).success, false);
});

test('SIL-521: tờ khai hết nhập cấp lô — quick-create không còn nhận declarationNumber', () => {
  // Owner 26/10: số tờ khai chỉ nhập/sửa ở cấp cont (container line update).
  // Key phải rời khỏi quick-create contract để assertKnownShipmentKeys chặn
  // mọi đường tạo lô vẫn gửi input cấp lô.
  assert.equal(QUICK_CREATE_SHIPMENT_KEYS.includes('declarationNumber'), false);
  assert.equal(
    quickCreateShipmentSchema.safeParse({ customerId: 1, declarationNumber: 'TK-01' }).success,
    true,
    'zod non-strict: key lạ vẫn parse được — lệnh chặn là assertKnownShipmentKeys (pin ở key-guard test)',
  );
});

test('SIL-600: tờ khai nhập theo cont lúc tạo — containers[].declarationNumber', () => {
  // Owner ruling 30/10: form tạo nhập số tờ khai theo từng container ngay lúc
  // tạo. Mô hình SIL-521: trim giá trị, trùng số trong cùng lô KHÔNG lỗi.
  const parsed = quickCreateShipmentSchema.safeParse({
    customerId: 1,
    containers: [
      { containerTypeId: 31, containerNumber: 'MSCU6639870', declarationNumber: '  TK-0123456789  ' },
      { containerTypeId: 31, containerNumber: 'MSCU6639871', declarationNumber: 'TK-0123456789' },
    ],
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.containers?.[0]?.declarationNumber, 'TK-0123456789');
  assert.equal(parsed.success && parsed.data.containers?.[1]?.declarationNumber, 'TK-0123456789');

  // Rỗng → null (không ký tự rác trong DB).
  const emptied = quickCreateShipmentSchema.safeParse({
    customerId: 1,
    containers: [{ containerTypeId: 31, declarationNumber: '' }],
  });
  assert.equal(emptied.success, true);
  assert.equal(emptied.success && emptied.data.containers?.[0]?.declarationNumber, null);

  // >50 ký tự → lỗi, đúng trần cột declaration_number.
  assert.equal(
    quickCreateShipmentSchema.safeParse({
      customerId: 1,
      containers: [{ containerTypeId: 31, declarationNumber: 'T'.repeat(51) }],
    }).success,
    false,
  );
  // Key cấp lô vẫn KHÔNG vào contract (guard trên vẫn đứng).
  assert.equal(QUICK_CREATE_SHIPMENT_KEYS.includes('declarationNumber'), false);
});

// ─── zod v3 → v4 bump pins (case-2026-10-29-zod4-final-bump) ────────────────
// Behavior invariance: these payloads are what POST/PUT /api/shipments carry
// today; the bump must accept and return them byte-identically.

test('Z4-SHIP-1: create accepts a real export payload and returns the timestamps unchanged', () => {
  const parsed = createShipmentSchema.parse({
    customerId: 12,
    bookingRef: 'BOOK-EXPORT-2026-11',
    tradeDirection: 'EXPORT',
    cargoMode: 'FCL',
    routeId: 3,
    expectedDeliveryDate: '2026-11-08',
    customsCutoffAt: '2026-11-05T17:00:00+07:00',
    closingAt: '2026-11-06T08:00:00Z',
    cargoWeightKg: '12500.50',
    packageCount: '40',
    driverNotes: 'Giao ca sáng',
  });
  assert.equal(parsed.customsCutoffAt, '2026-11-05T17:00:00+07:00');
  assert.equal(parsed.closingAt, '2026-11-06T08:00:00Z');
  assert.equal(parsed.expectedDeliveryDate, '2026-11-08');
  assert.equal(parsed.bookingRef, 'BOOK-EXPORT-2026-11');
  assert.equal(parsed.customerId, 12);
});

test('Z4-SHIP-2: create-time defaults isAdHoc/isCombined/hasDeposit apply on create', () => {
  const parsed = createShipmentSchema.parse({ customerId: 1 });
  assert.equal(parsed.isAdHoc, false);
  assert.equal(parsed.isCombined, false);
  assert.equal(parsed.hasDeposit, false);
});

test('Z4-SHIP-3: create without customerId (non ad-hoc) keeps the Vietnamese guard', () => {
  const parsed = createShipmentSchema.safeParse({ rawCustomerName: 'Cuốc vãng lai' });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.equal(parsed.error.issues[0]?.message, 'Khách hàng là bắt buộc.');
  }
  assert.equal(createShipmentSchema.safeParse({ isAdHoc: true, rawCustomerName: 'Cuốc vãng lai' }).success, true);
});

test('Z4-SHIP-4: update patches a subset — omitted keys stay absent from the parsed output', () => {
  const parsed = updateShipmentSchema.parse({ expectedVersion: 3, driverNotes: 'Đổi giờ hẹn' });
  assert.equal(parsed.driverNotes, 'Đổi giờ hẹn');
  assert.equal(parsed.expectedVersion, 3);
  assert.equal('customsCutoffAt' in parsed, false, 'omitted timestamp must not ride into the UPDATE write');
  assert.equal('customerId' in parsed, false);
  assert.equal(updateShipmentSchema.safeParse({ driverNotes: 'thiếu version' }).success, false);
});

test('Z4-SHIP-5: update timestamps accept the +07:00 wire format and reject garbage', () => {
  assert.equal(updateShipmentSchema.safeParse({
    expectedVersion: 1,
    customsCutoffAt: '2026-11-05T17:00:00+07:00',
  }).success, true);
  assert.equal(updateShipmentSchema.safeParse({
    expectedVersion: 1,
    customsCutoffAt: '05/11/2026 17:00',
  }).success, false);
});
