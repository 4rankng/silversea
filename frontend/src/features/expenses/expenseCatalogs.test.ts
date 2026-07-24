import { describe, expect, it } from 'vitest';
import { resolveExpenseCatalogs } from './expenseCatalogs';
import type { ExpenseCategory, Supplier } from '@tingting/shared';

describe('resolveExpenseCatalogs', () => {
  it('uses cached query data directly for dropdown options', () => {
    const supplier = { id: 1, name: 'NCC A' } as Supplier;
    const category = { id: 2, name: 'Sửa chữa' } as ExpenseCategory;

    expect(resolveExpenseCatalogs({ suppliers: [supplier], categories: [category] })).toEqual({
      suppliers: [supplier],
      categories: [category],
    });
  });

  it('returns empty dropdown lists only when query data is actually absent', () => {
    expect(resolveExpenseCatalogs(undefined)).toEqual({ suppliers: [], categories: [] });
  });
});
