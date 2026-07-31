import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildProfitabilityAttributionSnapshot,
  PROFITABILITY_DIMENSIONS,
} from '../services/profitability.service';

describe('profitability attribution snapshot', () => {
  it('always emits exactly eight dimensions and preserves explicit missing attribution', () => {
    const dimensions = buildProfitabilityAttributionSnapshot({
      completedBusinessDate: '2026-07-31',
      customer: { id: 11, name: 'Khách A' },
      route: { id: 22, name: 'Cát Lái - Bình Dương' },
      truck: { id: 33, name: '51C-123.45' },
      dispatcher: null,
      salesperson: null,
      container: null,
    });

    assert.deepEqual(dimensions.map(item => item.dimension), PROFITABILITY_DIMENSIONS);
    assert.equal(dimensions.length, 8);
    for (const name of ['DISPATCHER', 'SALESPERSON', 'CONTAINER']) {
      const item = dimensions.find(candidate => candidate.dimension === name);
      assert.equal(item?.key, 'MISSING_ATTRIBUTION');
      assert.equal(item?.attributionStatus, 'MISSING');
    }
    assert.equal(dimensions.find(item => item.dimension === 'MONTH')?.key, '2026-07');
    assert.equal(dimensions.find(item => item.dimension === 'YEAR')?.key, '2026');
  });

  it('never substitutes creator or handler identity for dispatcher or salesperson', () => {
    const dimensions = buildProfitabilityAttributionSnapshot({
      completedBusinessDate: '2026-01-01',
      customer: { id: 1, name: 'Khách' },
      route: { id: 2, name: 'Tuyến' },
      truck: null,
      dispatcher: null,
      salesperson: null,
      container: null,
    });
    assert.equal(dimensions.find(item => item.dimension === 'DISPATCHER')?.label, 'Thiếu phân bổ');
    assert.equal(dimensions.find(item => item.dimension === 'SALESPERSON')?.label, 'Thiếu phân bổ');
  });
});
