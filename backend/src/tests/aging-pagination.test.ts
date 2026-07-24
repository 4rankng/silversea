import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paginateAgingRows } from '../services/aging.service';

describe('paginateAgingRows', () => {
  it('returns bounded pagination metadata and slices customer rows', () => {
    const rows = [
      { customerId: 1 },
      { customerId: 2 },
      { customerId: 3 },
      { customerId: 4 },
      { customerId: 5 },
    ];

    const page = paginateAgingRows(rows, { page: 2, limit: 2 });

    assert.deepEqual(page.rows, [{ customerId: 3 }, { customerId: 4 }]);
    assert.equal(page.page, 2);
    assert.equal(page.limit, 2);
    assert.equal(page.total, 5);
    assert.equal(page.totalPages, 3);
  });

  it('clamps invalid and excessive limits to a safe range', () => {
    const rows = Array.from({ length: 600 }, (_, index) => ({ customerId: index + 1 }));

    const page = paginateAgingRows(rows, { page: -3, limit: 10_000 });

    assert.equal(page.page, 1);
    assert.equal(page.limit, 500);
    assert.equal(page.rows.length, 500);
    assert.equal(page.total, 600);
    assert.equal(page.totalPages, 2);
  });
});
