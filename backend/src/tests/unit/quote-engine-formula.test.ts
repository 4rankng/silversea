import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFreightRate } from '@tingting/shared';

// QA R32 — công thức engine theo CuocPhiPhuPhiDau.md (Long Minh NEWEB),
// từng bước phép tính với số liệu ví dụ NEWEB CONT 40. Mapping code → công
// thức (freight-pricing-engine.service.ts header):
//   E (lít/chuyến) = C (km khứ hồi) × D (định mức lít/km từ
//   fuel_consumption_norms — KHÔNG nhập tay);
//   H = max(0, (G − F) × E);  J = I × (1 + %chia sẻ);  K = J + H.
// Số liệu chuẩn NEWEB (§3, §4, §5, §6.1): C = 260 km (130 × 2), D = 0,35
// → E = 91 lít; I = 4.100.000; %chia sẻ = 2; F = 19.270/1,08 = 17.842,5926;
// kỳ 18/7/2026 G = 27.620; kỳ 11/7/2026 G = 21.740.

const NEWEB_CONT40 = {
  basePrice: 4_100_000,          // I — GIÁ GỐC
  sharePct: 2,                   // % chia sẻ của tuyến NEWEB
  baseFuelPrice: 19_270 / 1.08,  // F — giá dầu mốc chưa VAT
  liters: 260 * 0.35,            // E = C × D = 91 lít/chuyến
} as const;

test('E (lít/chuyến) = C (km khứ hồi) × D (định mức) — NEWEB CONT40 = 91 lít', () => {
  const billingKmOneWay = 130;      // B — km một chiều
  const multiplier = 2;             // luôn tính 2 chiều (§2.1)
  const litersPerKm = 0.35;         // D — định mức CONT 40 (§4)
  assert.equal(billingKmOneWay * multiplier, 260);            // C = 260
  assert.equal(billingKmOneWay * multiplier * litersPerKm, 91); // E = 91
});

test('J = I × (1 + %chia sẻ) = 4.100.000 × 1,02 = 4.182.000', () => {
  const { freight } = computeFreightRate({ ...NEWEB_CONT40, fuelPrice: 17_842.5926 });
  assert.equal(freight, 4_182_000);
});

test('G > F: kỳ 18/7/2026 (G=27.620) → H = 889.744, K = 5.071.744 (bảng §6.1)', () => {
  const result = computeFreightRate({ ...NEWEB_CONT40, fuelPrice: 27_620 });
  // G − F = 27.620 − 17.842,5926 = 9.777,4074 đ/lít
  assert.ok(Math.abs(result.fuelDelta - 9_777.4074) < 0.001);
  // H = max(0, 9.777,4074 × 91) = 889.744,07 → làm tròn 889.744
  assert.equal(result.surcharge, 889_744);
  // K = J + H = 4.182.000 + 889.744
  assert.equal(result.freight, 4_182_000);
  assert.equal(result.total, 5_071_744);
});

test('G > F: kỳ 11/7/2026 (G=21.740) → H = 354.664, K = 4.536.664 (bảng §6.2)', () => {
  const result = computeFreightRate({ ...NEWEB_CONT40, fuelPrice: 21_740 });
  assert.ok(Math.abs(result.fuelDelta - 3_897.4074) < 0.001);
  assert.equal(result.surcharge, 354_664);
  assert.equal(result.total, 4_536_664);
});

test('G ≤ F: giá dầu 16.000 → H = 0, K = J = 4.182.000 — dầu rẻ không giảm cước (§2.5)', () => {
  const result = computeFreightRate({ ...NEWEB_CONT40, fuelPrice: 16_000 });
  assert.ok(result.fuelDelta < 0, 'G − F âm phải giữ nguyên dấu ở fuelDelta');
  assert.equal(result.surcharge, 0, 'phép tính mục tiêu phải kẹp phụ phí về 0');
  assert.equal(result.freight, 4_182_000);
  assert.equal(result.total, 4_182_000);
});

test('hai kỳ chênh nhau đúng ΔG × E: 27.620 − 21.740 = 5.880 × 91 = 535.080 (§6.2)', () => {
  const late = computeFreightRate({ ...NEWEB_CONT40, fuelPrice: 27_620 });
  const early = computeFreightRate({ ...NEWEB_CONT40, fuelPrice: 21_740 });
  assert.equal(late.surcharge - early.surcharge, 5_880 * 91);
  assert.equal(late.surcharge - early.surcharge, 535_080);
});
