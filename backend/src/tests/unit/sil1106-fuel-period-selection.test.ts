/**
 * SIL-1106 (K2.165, KB §2.4.5–§2.4.6) — the pricing engine must select the
 * fuel price period purely by effective date (latest period with hiệu lực ≤
 * ngày vận chuyển − lag) and clamp the subcharge to 0 when that period's
 * price is below the contract chuẩn (baseFuelPrice). The quotation-fuel
 * approval rows (card 20260922_61 → K5.24 quotation-version workflow) must
 * never select, block, or replace the fuel price: a PENDING row is the
 * default state every new period spawns, so gating selection on it froze
 * pricing on the old period forever — the QA repro saw every December 2026
 * day priced from period 1 (25.760, hiệu lực 02/10/2026) with phụ phí
 * 506.714₫ while the December periods (15.000 từ 01/12, 26.500 từ 15/12)
 * sat "Sắp áp dụng" and the 15.000-below-norm → 0 case never occurred.
 *
 * DB-free unit test (repo convention: source-scan pins like the sibling
 * sil1076/quote-engine-wiring tests) + the repro's exact numbers pinned on
 * the shared computeFreightRate the engine flows through:
 *   05/12/2026 → kỳ 15.000 (< chuẩn 17.842,5926) → phụ phí 0
 *   20/12/2026 → kỳ 26.500 → 506.714-class math (554.074 với 64 lít/chuyến)
 *   05/11/2026 → kỳ 25.760 → phụ phí 506.714
 * (route 6 ASKEY: 100 km × 2 × 0,32 l/km = 64 lít/chuyến, F = 17.842,5926).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeFreightRate } from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const engine = readFileSync(join(here, '../../services/freight-pricing-engine.service.ts'), 'utf8');

const LITERS = 100 * 2 * 0.32; // 64 l/chuyến — lot-1221 lane (route 6, CONT20)
const CHUAN = 17_842.5926; // freight_rate_terms 1: baseFuelPrice (giá chuẩn)

describe('SIL-1106 — fuel period selection is purely by effective date (K2.165)', () => {
  test('the engine reads no quotation-fuel approval row while selecting the period', () => {
    assert.doesNotMatch(engine, /quotationFuelApprovals/,
      'period selection must not consult the quotation-fuel approval workflow');
    assert.doesNotMatch(engine, /notInArray/,
      'no blocked-period exclusion may narrow the effective-date selection');
  });

  test('selection is latest hiệu lực ≤ ngày vận chuyển − lag (same engine source the preview rides)', () => {
    assert.match(engine, /const targetDate = subtractDays\(transportDate, lagDays\)/);
    assert.match(engine, /lte\(s\.fuelPricePeriods\.effectiveFrom, targetDate\)/);
    assert.match(engine, /orderBy\(desc\(s\.fuelPricePeriods\.effectiveFrom\)\)[\s\S]*?\.limit\(1\)/);
    assert.match(engine, /isNull\(s\.fuelPricePeriods\.deletedAt\)/);
  });

  test('05/12/2026 → kỳ 15.000 dưới giá chuẩn → phụ phí dầu bằng 0 (KB §2.4.6)', () => {
    const rate = computeFreightRate({ basePrice: 3_800_000, sharePct: 4, fuelPrice: 15_000, baseFuelPrice: CHUAN, liters: LITERS });
    assert.equal(rate.surcharge, 0, 'giá dầu dưới chuẩn ⇒ phụ phí 0, không âm, không dùng kỳ cũ');
    assert.equal(rate.fuelDelta, 15_000 - CHUAN);
    assert.equal(rate.freight, 3_952_000);
    assert.equal(rate.total, 3_952_000);
  });

  test('GET /api/fuel-price-periods list must exclude soft-deleted periods (companion bug agy r34)', () => {
    const routes = readFileSync(join(here, '../../routes/config/catalog-crud.routes.ts'), 'utf8');
    const listBlock = routes.match(/router\.get\('\/fuel-price-periods'[\s\S]*?\}\)\);/)?.[0]
      ?? assert.fail('GET /fuel-price-periods list handler not found');
    assert.match(listBlock, /isNull\(s\.fuelPricePeriods\.deletedAt\)/,
      'the audit list must apply the same deletedAt filter the engine selection uses — soft-deleted periods must not render as Sắp áp dụng');
  });

  test('20/12/2026 → kỳ 26.500 → phụ phí tính đúng trên kỳ mới (554.074₫)', () => {
    const rate = computeFreightRate({ basePrice: 3_800_000, sharePct: 4, fuelPrice: 26_500, baseFuelPrice: CHUAN, liters: LITERS });
    assert.equal(rate.surcharge, 554_074);
    assert.equal(rate.total, rate.freight + rate.surcharge);
  });

  test('05/11/2026 → kỳ 25.760 (hiệu lực 02/10) giữ nguyên phụ phí 506.714₫ — QA anchor không hồi tố', () => {
    const rate = computeFreightRate({ basePrice: 3_800_000, sharePct: 4, fuelPrice: 25_760, baseFuelPrice: CHUAN, liters: LITERS });
    assert.equal(rate.surcharge, 506_714);
    assert.equal(rate.total, 4_458_714);
  });
});
