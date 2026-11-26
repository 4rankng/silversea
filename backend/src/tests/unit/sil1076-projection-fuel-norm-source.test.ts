/**
 * SIL-1076 — the FCL projection's fuel surcharge must come from the SAME
 * norm source the AUTO rate engine reads (fuel_consumption_norms +
 * fuel_price_periods, via resolveFreightRate), not the legacy fuel_norms /
 * fuel_config lookup. On staging both legacy tables were empty while the
 * engine priced the lane fine (lot 1221: table 33 + CONT20 norm 0.32 l/km +
 * period 25760 → 4.458.714₫), so the projection discarded the freight price
 * it had already resolved and returned MISSING_AUTHORITY inside the same
 * response whose freightRate.latest priced AUTO — two contradictory sources
 * in one response (KB Ch.5 §5.3.2 / K5.21, Ch.10 §10.6.6 / K10.34: đủ đầu
 * vào thì hiện số đã khóa; thiếu thì nêu rõ thiếu ở định mức / kỳ giá /
 * điều khoản, không hiện 0).
 *
 * Unit-only tree: no db, no app boot — source-scan pins (the sibling
 * sil1076-projection-sheet-rate-key.test.ts precedent). The engine numbers
 * themselves are pinned on the shared computeFreightRate the projection now
 * flows through — the lot-1221 anchor 3.952.000 + 506.714 = 4.458.714.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeFreightRate } from '@tingting/shared';

const here = dirname(fileURLToPath(import.meta.url));
const pricingService = readFileSync(join(here, '../../services/pricing.service.ts'), 'utf8');

describe('SIL-1076 wiring — projection fuel reads the engine norm source', () => {
  // The FCL fuel block runs after the breakdown loop and before the READY
  // return of the FCL branch.
  const fclFuelBlock = pricingService.match(
    /freightFormula = breakdown\.map\([\s\S]*?\n    return \{\n      readiness: 'READY'/,
  )![0];

  test('the lot-1221 anchor holds on the shared engine math the projection now flows through', () => {
    // Route 6 (ASKEY, 100 km × 2), CONT20 norm 0.32 l/km, base F=17842.5926,
    // period G=25760, table 33 @3.800.000, share 4% — freightRate.latest of
    // lot 1221 per container. The FCL projection multiplies this per-box
    // result by the container count (2×20DC → 1.013.428).
    const rate = computeFreightRate({
      basePrice: 3_800_000,
      sharePct: 4,
      fuelPrice: 25_760,
      baseFuelPrice: 17_842.5926,
      liters: 100 * 2 * 0.32,
    });
    assert.deepEqual(rate, { freight: 3_952_000, surcharge: 506_714, total: 4_458_714, fuelDelta: 7_917.4074 });
    assert.equal(rate.surcharge * 2, 1_013_428);
  });

  test('the FCL fuel loop resolves surcharge through resolveFreightRate keyed on the sheet rate key', () => {
    assert.match(fclFuelBlock, /resolveFreightRate\(\{/);
    assert.match(fclFuelBlock, /vehicleSizeClassCode: group\.rateKey/);
    assert.match(pricingService, /rateKey: sheetRateKey, date, count: quantity/);
  });

  test('an AUTO engine result feeds the projection money directly — freight price is never discarded for fuel', () => {
    assert.match(fclFuelBlock, /fuelLiters \+= rate\.liters \* group\.count/);
    assert.match(fclFuelBlock, /fuelAmount \+= rate\.surcharge \* group\.count/);
    assert.doesNotMatch(fclFuelBlock, /estimateShipmentFuelSurcharge/);
  });

  test('a genuinely missing norm keeps MISSING_AUTHORITY and names the định mức per class (K10.34)', () => {
    assert.match(fclFuelBlock, /rate\.fuelNormId === 0/);
    assert.match(fclFuelBlock, /Chưa có định mức dầu cho loại xe \$\{group\.rateKey\} để ước tính phụ phí nhiên liệu\./);
  });

  test('a genuinely missing fuel price period keeps MISSING_AUTHORITY and names the kỳ giá + date (K5.21)', () => {
    assert.match(fclFuelBlock, /rate\.fuelPricePeriodId === 0/);
    assert.match(fclFuelBlock, /Chưa có kỳ giá dầu hiệu lực tại ngày \$\{group\.date\} để ước tính phụ phí nhiên liệu\./);
  });

  test('missing freight_rate_terms surface the engine message naming khách hàng × tuyến', () => {
    assert.match(fclFuelBlock, /error instanceof ApiError/);
    assert.match(fclFuelBlock, /authorityProjection\(error\.message\)/);
  });

  test('the LCL projection keeps its legacy fuel estimate — unchanged scope', () => {
    assert.match(pricingService, /const fuelEstimate = await estimateShipmentFuelSurcharge\(/);
    assert.match(pricingService, /import \{ resolveFuelNorm \} from '\.\/fuel\.service';/);
  });
});
