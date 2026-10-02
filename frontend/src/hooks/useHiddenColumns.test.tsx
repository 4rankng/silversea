import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useHiddenColumns } from './useHiddenColumns';
import type { LedgerColumn } from '../lib/column-visibility';

const KEY = 'test-hidden-cols';
const COLUMNS: readonly LedgerColumn[] = [
  { key: 'customer', label: 'Khách hàng', pinned: true },
  { key: 'documents', label: 'Chứng từ' },
  { key: 'notes', label: 'Ghi chú', autoHideWhenEmpty: true },
];

const setup = (hasNotes: boolean) => renderHook(() => useHiddenColumns({
  storageKey: KEY,
  columns: COLUMNS,
  hasData: (column) => column.key !== 'notes' || hasNotes,
}));

describe('useHiddenColumns — the choice survives a reload (card 20260928_193)', () => {
  beforeEach(() => localStorage.clear());

  it('starts from the default and stores nothing until the operator chooses', () => {
    const { result } = setup(false);
    expect(result.current.hidden).toEqual(['notes']);
    expect(result.current.customized).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('restores a stored choice on mount — the reload path', () => {
    localStorage.setItem(KEY, JSON.stringify(['notes', 'documents']));
    const { result } = setup(false);
    expect(result.current.hidden).toEqual(['notes', 'documents']);
    expect(result.current.customized).toBe(true);
  });

  it('writes the whole effective set on a toggle, so the auto column stays hidden', () => {
    const { result } = setup(false);
    act(() => result.current.toggle('documents'));
    expect(result.current.hidden).toEqual(['documents', 'notes']);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['documents', 'notes']);
  });

  it('keeps a column the operator hid even after it gains data — the override wins', () => {
    localStorage.setItem(KEY, JSON.stringify(['notes']));
    const { result } = setup(true);
    expect(result.current.hidden).toEqual(['notes']);
  });

  it('keeps a column the operator showed after it gains data too', () => {
    const { result } = setup(false);
    act(() => result.current.toggle('notes'));
    expect(result.current.hidden).toEqual([]);
    expect(result.current.customized).toBe(true);
    // A fresh mount reading the stored choice with notes present: still shown.
    const { result: after } = setup(true);
    expect(after.current.hidden).toEqual([]);
  });

  it('resets to the default and clears the stored choice', () => {
    localStorage.setItem(KEY, JSON.stringify(['documents']));
    const { result } = setup(false);
    act(() => result.current.reset());
    expect(result.current.hidden).toEqual(['notes']);
    expect(result.current.customized).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('falls back to the default on a corrupt payload instead of throwing', () => {
    localStorage.setItem(KEY, '{not json');
    const { result } = setup(false);
    expect(result.current.hidden).toEqual(['notes']);
    expect(result.current.customized).toBe(false);
  });

  it('ignores a pinned key that a hand-edited payload put in storage', () => {
    localStorage.setItem(KEY, JSON.stringify(['customer']));
    const { result } = setup(false);
    expect(result.current.hidden).toEqual([]);
    expect(result.current.isHidden('customer')).toBe(false);
  });
});
