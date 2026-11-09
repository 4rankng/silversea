/**
 * SIL-765 (Phần VI Epic 5.2) — the pure half of the additional "Kho lấy hàng"
 * writer: normalizeExtraPickupWarehouses. DB behavior (the WAREHOUSE-active
 * 409 guard + the replace-all write) is exercised by the QA UI drive against
 * the local stack; this lane pins the no-DB contract:
 *   - a catalog row carries NO typed name ("id set → raw null", MasterDataNhaMay)
 *   - a typed row keeps its trimmed text with siteId null
 *   - site ids dedupe for the active-warehouse probe, order-stable
 *   - undefined/empty normalize to empty (create: no rows; update: clear)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExtraPickupWarehouses } from '../../services/shipment-lifecycle-shared.service';

describe('normalizeExtraPickupWarehouses (SIL-765)', () => {
  test('site row normalizes to name null; typed row trims with siteId null', () => {
    const { rows } = normalizeExtraPickupWarehouses([
      { siteId: 12, name: ' stale text ' },
      { siteId: null, name: '  Kho gõ tay Q7  ' },
    ]);
    assert.deepEqual(rows, [
      { siteId: 12, name: null },
      { siteId: null, name: 'Kho gõ tay Q7' },
    ]);
  });

  test('site ids dedupe in first-seen order for the warehouse probe', () => {
    const { siteIds } = normalizeExtraPickupWarehouses([
      { siteId: 12 },
      { siteId: null, name: 'Kho A' },
      { siteId: 12 },
      { siteId: 13 },
    ]);
    assert.deepEqual(siteIds, [12, 13]);
  });

  test('undefined normalizes to empty — update(undefined) keeps stored rows', () => {
    assert.deepEqual(normalizeExtraPickupWarehouses(undefined), { rows: [], siteIds: [] });
    assert.deepEqual(normalizeExtraPickupWarehouses(null), { rows: [], siteIds: [] });
    assert.deepEqual(normalizeExtraPickupWarehouses([]), { rows: [], siteIds: [] });
  });

  test('a typed-only blank stays null (schema refine owns the empty-row 400)', () => {
    const { rows } = normalizeExtraPickupWarehouses([{ name: '   ' }]);
    assert.deepEqual(rows, [{ siteId: null, name: null }]);
  });
});
