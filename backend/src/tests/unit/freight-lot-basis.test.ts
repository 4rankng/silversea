import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLotPricingBasis,
  effectiveFuelLagDays,
  type LotPricingGrounds,
} from '../../services/freight-lot-basis';

// QA R32 — unit lane cho luật "đủ căn cứ → LOCK, thiếu căn cứ → SKIP (không
// bịa số)" của lockShipmentFreightRate, và lag precedence khung giá >
// freight_rate_terms. Pure module: không import db (ruling 2026-10-19).

const FULL_GROUNDS: LotPricingGrounds = {
  isAdHoc: false,
  customerId: 7,
  routeId: 3,
  rateKey: 'CONT40',
  containerTransportDate: '2026-07-20',
  expectedDeliveryDate: '2026-07-22',
  fallbackTransportDate: null,
  containerCargoWeightKg: 25_000,
};

test('đủ căn cứ (tuyến + khách + hạng + ngày + trọng tải) → LOCK với cột giá theo trọng tải', () => {
  const decision = classifyLotPricingBasis(FULL_GROUNDS);
  assert.deepEqual(decision, {
    action: 'LOCK',
    rateKey: 'CONT40',
    transportDate: '2026-07-20',
    priceVehicleSizeClassCode: 'CONT40.HEAVY',
  });
});

test('trọng tải đúng biên 20,0t = nặng; dưới 20t = nhẹ', () => {
  const heavy = classifyLotPricingBasis({ ...FULL_GROUNDS, containerCargoWeightKg: 20_000 });
  assert.deepEqual(heavy, { action: 'LOCK', rateKey: 'CONT40', transportDate: '2026-07-20', priceVehicleSizeClassCode: 'CONT40.HEAVY' });
  const light = classifyLotPricingBasis({ ...FULL_GROUNDS, containerCargoWeightKg: 19_999.9 });
  assert.deepEqual(light, { action: 'LOCK', rateKey: 'CONT40', transportDate: '2026-07-20', priceVehicleSizeClassCode: 'CONT40.LIGHT' });
});

test('CONT20/CONT40 thiếu trọng tải → SKIP MISSING_WEIGHT (không mặc định hạng nhẹ)', () => {
  for (const weight of [null, 0, -5] as const) {
    const decision = classifyLotPricingBasis({ ...FULL_GROUNDS, containerCargoWeightKg: weight });
    assert.deepEqual(decision, { action: 'SKIP', reason: 'MISSING_WEIGHT' }, `weight=${weight}`);
  }
});

test('thiếu từng căn cứ → SKIP đúng lý do, không bịa số', () => {
  assert.deepEqual(classifyLotPricingBasis({ ...FULL_GROUNDS, isAdHoc: true }), { action: 'SKIP', reason: 'AD_HOC' });
  assert.deepEqual(classifyLotPricingBasis({ ...FULL_GROUNDS, customerId: null }), { action: 'SKIP', reason: 'NO_CUSTOMER' });
  assert.deepEqual(classifyLotPricingBasis({ ...FULL_GROUNDS, routeId: null }), { action: 'SKIP', reason: 'NO_ROUTE' });
  assert.deepEqual(classifyLotPricingBasis({ ...FULL_GROUNDS, rateKey: null }), { action: 'SKIP', reason: 'NO_RATE_KEY' });
  assert.deepEqual(
    classifyLotPricingBasis({ ...FULL_GROUNDS, containerTransportDate: null, expectedDeliveryDate: null, fallbackTransportDate: null }),
    { action: 'SKIP', reason: 'NO_TRANSPORT_DATE' },
  );
});

test('LCL mới tạo chưa có rate key (điều vận chưa chọn hạng) → SKIP NO_RATE_KEY — lock chờ dispatch', () => {
  // LCL lot: route trên shipment, không container, không override — đúng
  // shape lockShipmentFreightRate bắt gặp ở intake (snapshot-lifecycle
  // header: LCL không lock ở intake, khóa khi phát lệnh với pricingRateKey).
  const decision = classifyLotPricingBasis({
    isAdHoc: false,
    customerId: 7,
    routeId: 3,
    rateKey: null,
    containerTransportDate: null,
    expectedDeliveryDate: '2026-07-22',
    fallbackTransportDate: null,
    containerCargoWeightKg: null,
  });
  assert.deepEqual(decision, { action: 'SKIP', reason: 'NO_RATE_KEY' });
});

test('ngày ưu tiên: hẹn cont > ngày giao dự kiến > ngày dự phòng của điều vận', () => {
  const withFallbackOnly = classifyLotPricingBasis({
    ...FULL_GROUNDS, containerTransportDate: null, expectedDeliveryDate: null, fallbackTransportDate: '2026-07-25',
  });
  assert.equal(withFallbackOnly.action, 'LOCK');
  if (withFallbackOnly.action === 'LOCK') assert.equal(withFallbackOnly.transportDate, '2026-07-25');

  const eddBeatsFallback = classifyLotPricingBasis({
    ...FULL_GROUNDS, containerTransportDate: null, expectedDeliveryDate: '2026-07-22', fallbackTransportDate: '2026-07-25',
  });
  if (eddBeatsFallback.action === 'LOCK') assert.equal(eddBeatsFallback.transportDate, '2026-07-22');
});

test('hạng xe tải (không phải cont) không cần trọng tải', () => {
  const decision = classifyLotPricingBasis({ ...FULL_GROUNDS, rateKey: '5T', containerCargoWeightKg: null });
  assert.deepEqual(decision, { action: 'LOCK', rateKey: '5T', transportDate: '2026-07-20' });
});

test('rate key điều vận 4-class (CONT40.HEAVY) được tôn trọng nguyên văn', () => {
  const decision = classifyLotPricingBasis({ ...FULL_GROUNDS, rateKey: 'CONT40.HEAVY', containerCargoWeightKg: null });
  assert.deepEqual(decision, { action: 'LOCK', rateKey: 'CONT40.HEAVY', transportDate: '2026-07-20' });
});

// ─── Lag precedence: khung giá (BaoGia.md §2) > terms > 0 ───────────────────

test('lag khung giá hiệu lực THẮNG terms (engine tra giá ngày giao − lag khung)', () => {
  assert.equal(effectiveFuelLagDays(2, 1), 2);
  assert.equal(effectiveFuelLagDays(0, 5), 0, 'khung nói lag 0 là dữ liệu khách — áp 0');
});

test('chưa có khung hiệu lực → fallback lag của freight_rate_terms (seed NEWEB 1)', () => {
  assert.equal(effectiveFuelLagDays(null, 1), 1);
  assert.equal(effectiveFuelLagDays(undefined, 0), 0);
});

test('thiếu cả hai nguồn → 0', () => {
  assert.equal(effectiveFuelLagDays(null, null), 0);
});

test('giá rác (âm/thập phân) bị bác, không bịa số lạ', () => {
  assert.equal(effectiveFuelLagDays(-1, 3), 3, 'lag khung âm là dữ liệu sai → dùng terms');
  assert.equal(effectiveFuelLagDays(Number.NaN, 3), 3);
});
