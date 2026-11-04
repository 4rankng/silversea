/**
 * SIL-677 — copyTrip trên trip live thuộc lô phải THÀNH CÔNG (detach khỏi lô)
 * thay vì 500 vì đè unique index, và mọi 23505 sót lại trong nhánh copy phải
 * thành 409 có message nghiệp vụ.
 *
 * Ba nhánh unique index (schema trips.ts):
 * - trips_active_trip_pair_order_uniq   — không lọc status ⇒ pair columns
 *   luôn bị loại khỏi bản copy.
 * - trips_fulfillment_id_live_uniq      — loại trừ row CANCELED ⇒ copy của
 *   source CANCELED kế thừa fulfillment hợp lệ (chiếm lại slot live của lô,
 *   law SIL-655 arm SourceCanceled — pin p2.copy-stays-lot-linked).
 * - trips_shipment_without_fulfillment_live_uniq — như trên cho shipment.
 *
 * Unit-only tree (2026-10-19 owner ruling): builder + mapper là hàm thuần;
 * luồng HTTP thật được b chứng minh bằng qa/scripts/2026-11-04-sil677-driver.mjs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TripStatus } from '@tingting/shared';
import * as schema from '../../db/schema';
import { ApiError } from '../../errors';
import {
  buildCopiedTripValues,
  mapCopyTripUniqueViolation,
} from '../../services/trip-mutations.service';

type TripRow = typeof schema.tripsComposite.$inferSelect;

// Fixture gốc: trip live IN_TRANSIT thuộc lô #5, đang trong cặp #7 slot 1 —
// đủ cả ba cột quan hệ để mỗi nhánh chỉ cần zero hóa phần không dùng.
const fixture = (overrides: Partial<Record<string, unknown>>): TripRow => ({
  id: 52,
  tripCode: 'TRP-202611-0052',
  version: 4,
  status: TripStatus.IN_TRANSIT,
  completedAt: null,
  createdBy: 3,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-03T00:00:00Z'),
  deletedAt: null,
  customerId: 11,
  routeId: 12,
  departureDate: '2026-11-04',
  shipmentId: 5,
  fulfillmentId: null,
  sourceShipmentVersion: 2,
  activeTripPairId: 7,
  activeTripPairOrder: 1,
  revenue: '9200000',
  revenueOriginal: '9200000',
  ...overrides,
} as unknown as TripRow);

describe('SIL-677 — copy trip live thuộc lô detach khỏi quan hệ lô', () => {
  it('nhánh pair-active: pair columns + lot link đều không kế thừa', () => {
    const copied = buildCopiedTripValues(fixture({}), 'TRP-202611-0502', 99);

    assert.equal(copied.status, TripStatus.CREATED);
    assert.ok(!('activeTripPairId' in copied), 'pair slot phải detach (index không lọc status)');
    assert.ok(!('activeTripPairOrder' in copied));
    assert.ok(!('shipmentId' in copied), 'lô phải detach khi source còn live');
    assert.ok(!('fulfillmentId' in copied));
    assert.ok(!('sourceShipmentVersion' in copied));
    assert.ok(!('id' in copied));
    assert.equal(copied.tripCode, 'TRP-202611-0502');
  });

  it('nhánh có-fulfillment: shipment/fulfillment/version lot-link không kế thừa', () => {
    const copied = buildCopiedTripValues(
      fixture({ fulfillmentId: 9, status: TripStatus.CREATED }),
      'TRP-202611-0503',
      99,
    );

    assert.ok(!('shipmentId' in copied));
    assert.ok(!('fulfillmentId' in copied), 'fulfillment live đã bị source chiếm — copy phải detach');
    assert.ok(!('sourceShipmentVersion' in copied));
  });

  it('nhánh lot-linked-thường: shipment không kế thừa dù fulfillment null', () => {
    const copied = buildCopiedTripValues(fixture({ activeTripPairId: null, activeTripPairOrder: null }), 'TRP-202611-0504', 99);

    assert.ok(!('shipmentId' in copied), 'đè trips_shipment_without_fulfillment_live_uniq nếu kế thừa');
    assert.equal(copied.customerId, 11);
    assert.equal(copied.revenue, '9200000');
  });

  it('source CANCELED giữ lot link (law SIL-655 arm SourceCanceled) nhưng vẫn không nhận pair', () => {
    const copied = buildCopiedTripValues(
      fixture({ status: TripStatus.CANCELED, fulfillmentId: 9 }),
      'TRP-202611-0505',
      99,
    );

    assert.equal(copied.shipmentId, 5, 'p2.copy-stays-lot-linked: copy chiếm lại slot live của lô');
    assert.equal(copied.fulfillmentId, 9, 'governed replacement: fulfillment đã rảnh vì source CANCELED');
    assert.equal(copied.sourceShipmentVersion, 2);
    assert.ok(!('activeTripPairId' in copied));
    assert.ok(!('activeTripPairOrder' in copied));
    assert.equal(copied.status, TripStatus.CREATED);
  });
});

describe('SIL-677 — mọi 23505 sót trong nhánh copy thành 409 có message', () => {
  const cases: Array<{ constraint: string; fragment: string }> = [
    { constraint: 'trips_fulfillment_id_live_uniq', fragment: 'fulfillment' },
    { constraint: 'trips_shipment_without_fulfillment_live_uniq', fragment: 'lô hàng' },
    { constraint: 'trips_active_trip_pair_order_uniq', fragment: 'cặp chuyến' },
    { constraint: 'trip_code_key', fragment: 'mã chuyến' },
  ];

  for (const { constraint, fragment } of cases) {
    it(`map ${constraint} → ApiError 409`, () => {
      // Cả hai hình dạng lỗi: driver trực tiếp và Drizzle-wrapped (cause).
      const direct = mapCopyTripUniqueViolation({ code: '23505', constraint_name: constraint });
      const wrapped = mapCopyTripUniqueViolation({ cause: { code: '23505', constraint_name: constraint } });

      for (const mapped of [direct, wrapped]) {
        assert.ok(mapped instanceof ApiError, `${constraint} phải thành ApiError`);
        assert.equal((mapped as ApiError).statusCode, 409);
        assert.match((mapped as ApiError).message, new RegExp(fragment, 'i'));
      }
    });
  }

  it('40001 (race repeatable-read) → ApiError 409 retryable', () => {
    const wrapped = { cause: { code: '40001' } };
    const mapped = mapCopyTripUniqueViolation(wrapped);
    assert.ok(mapped instanceof ApiError);
    assert.equal((mapped as ApiError).statusCode, 409);
    assert.match((mapped as ApiError).message, /thay đổi bởi người khác/i);
  });

  it('lỗi không phải 23505 đi thẳng qua, không bị nuốt', () => {
    const boom = new Error('boom');
    assert.equal(mapCopyTripUniqueViolation(boom), boom);
    const notUnique = { code: '23503', constraint_name: 'trips_fulfillment_id_live_uniq' };
    assert.equal(mapCopyTripUniqueViolation(notUnique), notUnique);
  });
});
