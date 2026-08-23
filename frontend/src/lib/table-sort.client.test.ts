import { describe, expect, it } from 'vitest';
import { sortClientSide } from './table-sort';

interface Row {
  id: number;
  name: string | null;
  amount: number | null;
}

const rows: Row[] = [
  { id: 1, name: 'Zeta Logistics', amount: 30 },
  { id: 2, name: 'Ánh Minh', amount: null },
  { id: 3, name: null, amount: 10 },
  { id: 4, name: 'Công ty An Phát', amount: 20 },
];

const accessors = {
  name: (row: Row) => row.name,
  amount: (row: Row) => row.amount,
} as const;

const tiebreaker = (a: Row, b: Row) => a.id - b.id;

describe('sortClientSide', () => {
  it('returns the default order (copied, input never mutated) when no sort is active', () => {
    expect(sortClientSide(rows, null, accessors, tiebreaker).map(r => r.id)).toEqual([1, 2, 3, 4]);
    sortClientSide(rows, { by: 'amount', dir: 'asc' }, accessors, tiebreaker);
    expect(rows.map(r => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('falls back to the default order for an accessor key the table does not define', () => {
    expect(sortClientSide(rows, { by: 'nonsense', dir: 'asc' }, accessors, tiebreaker).map(r => r.id))
      .toEqual([1, 2, 3, 4]);
  });

  it('sorts numbers numerically asc and desc with nulls last in both directions', () => {
    expect(sortClientSide(rows, { by: 'amount', dir: 'asc' }, accessors, tiebreaker).map(r => r.amount))
      .toEqual([10, 20, 30, null]);
    expect(sortClientSide(rows, { by: 'amount', dir: 'desc' }, accessors, tiebreaker).map(r => r.amount))
      .toEqual([30, 20, 10, null]);
  });

  it('sorts strings with Vietnamese collation, not by codepoint', () => {
    expect(sortClientSide(rows, { by: 'name', dir: 'asc' }, accessors, tiebreaker).map(r => r.name))
      .toEqual(['Ánh Minh', 'Công ty An Phát', 'Zeta Logistics', null]);
    expect(sortClientSide(rows, { by: 'name', dir: 'desc' }, accessors, tiebreaker).map(r => r.name))
      .toEqual(['Zeta Logistics', 'Công ty An Phát', 'Ánh Minh', null]);
  });

  it('breaks equal-key ties with the caller tiebreaker in both directions', () => {
    const tied: Row[] = [
      { id: 9, name: 'Trùng tên', amount: 5 },
      { id: 2, name: 'Trùng tên', amount: 5 },
      { id: 6, name: 'Trùng tên', amount: 5 },
    ];
    expect(sortClientSide(tied, { by: 'amount', dir: 'desc' }, accessors, tiebreaker).map(r => r.id))
      .toEqual([2, 6, 9]);
    expect(sortClientSide(tied, { by: 'name', dir: 'asc' }, accessors, tiebreaker).map(r => r.id))
      .toEqual([2, 6, 9]);
  });
});
