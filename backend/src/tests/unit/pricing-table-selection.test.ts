/**
 * SIL-676 — the pricing TABLE selection law, db-free (S676-R1/R2/R5).
 *
 * Regression: since 6cee01b1f the selector-less lane lookup demanded a
 * both-axes-null general row; lanes whose rows are ALL rate-keyed (the
 * seeded norm) resolved 0 for GET /api/pricing and the trip revenue seed.
 * The law now: explicit selector = exact bucket only (a miss stays MANUAL,
 * never a cross-class guess); selector-less caller = general row, else the
 * lane's HEAD row (latest effectiveDate, lowest id on that date).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  partitionTablePricingLane,
  pickTablePricingRow,
  type TablePricingRowShape,
} from '../../services/pricing-table-selection';

type Row = TablePricingRowShape & { price: number };

const row = (id: number, effectiveDate: string, rateKey: string | null, containerTypeId: number | null = null, price = 1_000): Row =>
  ({ id, effectiveDate, rateKey, containerTypeId, price });

// The SIL-676 staging shape: 8 keyed rows for customer 1 × route 6, all
// effective 2026-10-02 (CONT20 id 33 first-entered), no general row.
const KEYED_LANE: Row[] = [
  row(33, '2026-10-02', 'CONT20', null, 3_800_000),
  row(34, '2026-10-02', 'CONT40', null, 4_000_000),
  row(35, '2026-10-02', '1.25T', null, 1_200_000),
  row(36, '2026-10-02', '10T', null, 3_000_000),
];


describe('pickTablePricingRow — S676-R1 selector-less caller resolves the lane head row', () => {
  test('keyed-only lane, no selector → head row (CONT20, lowest id of the latest date)', () => {
    const picked = pickTablePricingRow(partitionTablePricingLane(KEYED_LANE, null, null), { containerTypeId: null, pricingRateKey: null });
    assert.equal(picked.source, 'LANE_HEAD');
    assert.equal(picked.row?.id, 33);
    assert.equal(picked.row?.price, 3_800_000);
  });

  test('general row still wins over the head row (legacy both-null row intact)', () => {
    const rows = [...KEYED_LANE, row(20, '2026-10-02', null, null, 2_500_000)];
    const picked = pickTablePricingRow(partitionTablePricingLane(rows, null, null), { containerTypeId: null, pricingRateKey: null });
    assert.equal(picked.source, 'GENERAL');
    assert.equal(picked.row?.id, 20);
  });

  test('newer effective date moves the head row even with a higher id entered first', () => {
    const rows = [...KEYED_LANE, row(50, '2026-11-01', 'CONT40', null, 4_200_000)];
    const picked = pickTablePricingRow(partitionTablePricingLane(rows, null, null), { containerTypeId: null, pricingRateKey: null });
    assert.equal(picked.source, 'LANE_HEAD');
    assert.equal(picked.row?.id, 50);
  });

  test('empty lane → null (manual entry, S676-R5 unchanged)', () => {
    const picked = pickTablePricingRow(partitionTablePricingLane([], null, null), { containerTypeId: null, pricingRateKey: null });
    assert.equal(picked.row, null);
    assert.equal(picked.source, null);
  });
});

describe('pickTablePricingRow — S676-R2 explicit selector stays exact-match-or-manual', () => {
  test('rate key hit resolves its own row', () => {
    const picked = pickTablePricingRow(partitionTablePricingLane(KEYED_LANE, null, 'CONT40'), { containerTypeId: null, pricingRateKey: 'CONT40' });
    assert.equal(picked.source, 'RATE_KEY');
    assert.equal(picked.row?.id, 34);
  });

  test('rate key miss on a keyed lane stays MANUAL — never falls back to another class', () => {
    const picked = pickTablePricingRow(partitionTablePricingLane(KEYED_LANE, null, '15T'), { containerTypeId: null, pricingRateKey: '15T' });
    assert.equal(picked.row, null);
    assert.equal(picked.source, null);
  });

  test('containerTypeId miss stays MANUAL even though lane rows exist', () => {
    const picked = pickTablePricingRow(partitionTablePricingLane(KEYED_LANE, 7, null), { containerTypeId: 7, pricingRateKey: null });
    assert.equal(picked.row, null);
    assert.equal(picked.source, null);
  });
});

describe('partitionTablePricingLane — bucket hygiene', () => {
  test('class buckets keep latest-revision order (highest id wins a date tie)', () => {
    const rows: Row[] = [
      row(80, '2026-10-02', 'CONT20', null, 3_800_000),
      row(99, '2026-10-02', 'CONT20', null, 3_900_000),
    ];
    const picked = pickTablePricingRow(partitionTablePricingLane(rows, null, 'CONT20'), { containerTypeId: null, pricingRateKey: 'CONT20' });
    assert.equal(picked.row?.id, 99);
  });

  test('container-typed rows never leak into rate-key or general buckets', () => {
    const rows: Row[] = [
      row(10, '2026-10-02', null, 5, 900_000),
      row(11, '2026-10-02', 'CONT20', null, 3_800_000),
    ];
    const b = partitionTablePricingLane(rows, 5, 'CONT20');
    assert.deepEqual(b.container.map((r) => r.id), [10]);
    assert.deepEqual(b.rateKey.map((r) => r.id), [11]);
    assert.deepEqual(b.general, []);
  });

  test('head order is id-ascending within the latest effective date', () => {
    const b = partitionTablePricingLane(KEYED_LANE, null, null);
    assert.deepEqual(b.laneHeadOrder.map((r) => r.id), [33, 34, 35, 36]);
  });
});
