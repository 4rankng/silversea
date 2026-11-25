import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { projectTreasurySourceBreakdown, sortTreasuryPositions, type TreasuryPosition } from '../services/treasury.service';

// Pure comparator coverage — the local database has no seeded treasury
// accounts, so the endpoint-level sort is proven on the computed position
// shape the route actually sorts (sortTreasuryPositions).
function position(overrides: Partial<TreasuryPosition> & Pick<TreasuryPosition, 'accountId' | 'name'>): TreasuryPosition {
  return {
    code: `ACC-${overrides.accountId}`,
    type: 'BANK',
    fundCode: null,
    version: 1,
    currency: 'VND',
    bankName: null,
    bankAccountNumber: null,
    openingBalance: 0,
    totalIn: 0,
    totalOut: 0,
    bookBalance: 0,
    completeness: 'COMPLETE',
    cutoverAt: null,
    ...overrides,
  };
}

const rows: TreasuryPosition[] = [
  position({ accountId: 3, name: 'VCB chính', bookBalance: 500, totalIn: 700, completeness: 'PARTIAL' }),
  position({ accountId: 1, name: 'Tiền mặt quỹ', bookBalance: 900, totalIn: 100, completeness: 'COMPLETE' }),
  position({ accountId: 2, name: 'ACB chi nhánh', bookBalance: 100, totalIn: 300, completeness: 'COMPLETE' }),
];

describe('treasury position sort', () => {
  test('absent sort params keep the input (account-query) order untouched', () => {
    assert.deepEqual(sortTreasuryPositions(rows), rows);
    assert.deepEqual(sortTreasuryPositions(rows, undefined, 'desc'), rows);
  });

  test('bookBalance sorts numerically asc and desc with accountId tiebreaker', () => {
    assert.deepEqual(
      sortTreasuryPositions(rows, 'bookBalance', 'asc').map((row) => row.accountId),
      [2, 3, 1],
    );
    assert.deepEqual(
      sortTreasuryPositions(rows, 'bookBalance', 'desc').map((row) => row.accountId),
      [1, 3, 2],
    );

    const tied = [
      position({ accountId: 7, name: 'B', bookBalance: 500 }),
      position({ accountId: 6, name: 'A', bookBalance: 500 }),
    ];
    assert.deepEqual(
      sortTreasuryPositions(tied, 'bookBalance', 'asc').map((row) => row.accountId),
      [6, 7],
      'equal values fall back to the stable accountId tiebreaker',
    );
  });

  test('totalIn sorts asc/desc and completeness ranks COMPLETE before PARTIAL', () => {
    assert.deepEqual(
      sortTreasuryPositions(rows, 'totalIn', 'asc').map((row) => row.accountId),
      [1, 2, 3],
    );
    assert.deepEqual(
      sortTreasuryPositions(rows, 'totalIn', 'desc').map((row) => row.accountId),
      [3, 2, 1],
    );
    assert.deepEqual(
      sortTreasuryPositions(rows, 'completeness', 'asc').map((row) => row.accountId),
      [1, 2, 3],
      'COMPLETE accounts first; PARTIAL last regardless of id order',
    );
  });

  test('name sorts lexically asc and desc', () => {
    assert.deepEqual(
      sortTreasuryPositions(rows, 'name', 'asc').map((row) => row.name),
      ['ACB chi nhánh', 'Tiền mặt quỹ', 'VCB chính'],
    );
    assert.deepEqual(
      sortTreasuryPositions(rows, 'name', 'desc').map((row) => row.name),
      ['VCB chính', 'Tiền mặt quỹ', 'ACB chi nhánh'],
    );
  });

  test('sorting never mutates the caller’s array', () => {
    const original = [...rows];
    sortTreasuryPositions(rows, 'bookBalance', 'desc');
    assert.deepEqual(rows, original);
  });
});

// Sổ quỹ đối soát (ticket 18/11 Task 3.5a) — the fund-axis projection the
// position route appends as `fundBreakdown`. K6.17 (KB §6.5 "Quỹ"): Sổ quỹ có
// BỐN nguồn tiền — quỹ tiền mặt, quỹ công ty, quỹ tài khoản ngân hàng ACB
// chuyên hoàn cược và quỹ tạm ứng của giao nhận.
describe('projectTreasurySourceBreakdown', () => {
  test('sums per nguồn tiền and splits the ACB hoàn-cược account out of quỹ công ty', () => {
    const breakdown = projectTreasurySourceBreakdown([
      position({ accountId: 1, name: 'Tiền mặt quỹ', type: 'CASH', fundCode: 'TM', openingBalance: 100, totalIn: 700, totalOut: 200, bookBalance: 600 }),
      position({ accountId: 2, name: 'TM phụ', type: 'CASH', fundCode: 'TM', openingBalance: 50, totalIn: 100, totalOut: 0, bookBalance: 150 }),
      position({ accountId: 3, name: 'VCB chính', type: 'BANK', fundCode: 'COMPANY', bankName: 'Vietcombank', openingBalance: 1000, totalIn: 400, totalOut: 900, bookBalance: 500 }),
      position({ accountId: 6, name: 'ACB - Tài khoản công ty', type: 'BANK', fundCode: 'COMPANY', bankName: 'ACB', openingBalance: 200, totalIn: 50, totalOut: 30, bookBalance: 220 }),
    ], 750);

    assert.deepEqual(breakdown.sources, [
      { source: 'TM', openingBalance: 150, totalIn: 800, totalOut: 200, bookBalance: 750 },
      { source: 'COMPANY', openingBalance: 1000, totalIn: 400, totalOut: 900, bookBalance: 500 },
      { source: 'ACB_REFUND', openingBalance: 200, totalIn: 50, totalOut: 30, bookBalance: 220 },
      { source: 'OPS_ADVANCE', openingBalance: null, totalIn: null, totalOut: null, bookBalance: 750 },
    ]);
    // Đối soát: quỹ tiền mặt − phía ngân hàng (quỹ công ty + ACB hoàn cược).
    assert.equal(breakdown.inDelta, 800 - 450);      // 350
    assert.equal(breakdown.outDelta, 200 - 930);    // -730
    assert.equal(breakdown.balanceDelta, 750 - 720); // 30
  });

  test('an account without a fundCode sits in no nguồn tiền (the page counts it separately)', () => {
    const breakdown = projectTreasurySourceBreakdown([
      position({ accountId: 9, name: 'Chưa phân nguồn', type: 'BANK', fundCode: null, openingBalance: 1000, totalIn: 400, totalOut: 900, bookBalance: 500 }),
    ], 0);

    for (const row of breakdown.sources) {
      if (row.source === 'OPS_ADVANCE') continue;
      assert.deepEqual(row, { source: row.source, openingBalance: 0, totalIn: 0, totalOut: 0, bookBalance: 0 });
    }
    assert.equal(breakdown.inDelta, 0);
    assert.equal(breakdown.outDelta, 0);
    assert.equal(breakdown.balanceDelta, 0);
  });

  test('empty ledger projects four zeroed sources; the advance row keeps the outstanding balance', () => {
    assert.deepEqual(projectTreasurySourceBreakdown([], 23_210_000), {
      sources: [
        { source: 'TM', openingBalance: 0, totalIn: 0, totalOut: 0, bookBalance: 0 },
        { source: 'COMPANY', openingBalance: 0, totalIn: 0, totalOut: 0, bookBalance: 0 },
        { source: 'ACB_REFUND', openingBalance: 0, totalIn: 0, totalOut: 0, bookBalance: 0 },
        { source: 'OPS_ADVANCE', openingBalance: null, totalIn: null, totalOut: null, bookBalance: 23_210_000 },
      ],
      inDelta: 0,
      outDelta: 0,
      balanceDelta: 0,
    });
  });
});
