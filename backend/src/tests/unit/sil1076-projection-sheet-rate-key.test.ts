/**
 * SIL-1076 — the shipment pricing projection must read the customer's price
 * sheet through the SAME lane law the AUTO rate engine uses: pricing_tables
 * rows key on the rate key (20DC→CONT20 via containerTypeCodeToRateKey),
 * never on the truck-side containerTypeId (SIL-676 r2 sheet law, trip-create
 * precedent). Asking the container bucket made the projection report
 * MISSING_AUTHORITY ("Chưa có bảng giá cước cho loại container đã chọn trên
 * tuyến này.") while the same response's freightRate.latest priced AUTO
 * 4.458.714₫ from the keyed row — two contradictory sources in one response.
 *
 * Unit-only tree: no db, no app boot — source-scan pins (sil676 wiring
 * precedent); the bucket partition/selection behavior itself is pinned in
 * pricing-table-selection.test.ts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const pricingService = readFileSync(join(here, '../../services/pricing.service.ts'), 'utf8');

describe('SIL-1076 wiring — projection reads the sheet rate key', () => {
  const projectionLoop = pricingService.match(
    /for \(const \{ routeId, containerTypeId, date, quantity \} of groupedCounts\.values\(\)\)[\s\S]*?\n    \}/,
  )![0];

  test('the FCL projection loop derives the sheet rate key from the container type code', () => {
    assert.match(pricingService, /import \{ containerTypeCodeToRateKey \} from '\.\/freight-rate-snapshot-lifecycle\.service'/);
    assert.match(projectionLoop, /containerTypeCodeToRateKey\(containerType\.code\)/);
    assert.match(projectionLoop, /pricingRateKey: sheetRateKey/);
  });

  test('the projection table lookup never asks the containerTypeId bucket', () => {
    const resolveCall = projectionLoop.match(/resolveTableFreightPrice\(\{[\s\S]*?\}\);/)![0];
    assert.match(resolveCall, /resolveTableFreightPrice/);
    assert.doesNotMatch(resolveCall, /containerTypeId,/);
    assert.doesNotMatch(resolveCall, /containerTypeId:/);
  });

  test('the MANUAL projection message keeps naming the unpriced container ask', () => {
    // A lane with NO keyed row stays MANUAL → MISSING_AUTHORITY — the
    // message still tells the operator the container ask is unpriced (KB
    // K10.34: the message names where the input is missing).
    assert.match(projectionLoop, /'Chưa có bảng giá cước cho loại container đã chọn trên tuyến này\.'/);
  });
});
