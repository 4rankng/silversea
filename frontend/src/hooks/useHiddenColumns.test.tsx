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

// FB-093 (lan 3) — the chốt-debit shape: required columns (pinned, essential,
// essentialWhenHasData) an old payload may still name, plus ordinary fillers.
const REQUIRED: readonly LedgerColumn[] = [
  { key: 'customer', label: 'Khách hàng', pinned: true },
  { key: 'action', label: 'Hành động', essentialWhenHasData: true },
  { key: 'money', label: 'Tổng tiền', essential: true },
  { key: 'documents', label: 'Chứng từ' },
  { key: 'notes', label: 'Ghi chú', autoHideWhenEmpty: true },
];

const setupRequired = () => renderHook(() => useHiddenColumns({
  storageKey: KEY,
  columns: REQUIRED,
  hasData: (column) => column.key === 'action',
  defaultVisible: 'essential',
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

  it('repairs a stale payload on load — old localStorage can no longer bury a required column (FB-093 lan 3)', () => {
    // The QA-workstation shape: a choice written before the action column
    // became essentialWhenHasData still names it. The load drops the required
    // keys, keeps the operator's ordinary choices, and writes the sanitized
    // list back to storage.
    localStorage.setItem(KEY, JSON.stringify(['action', 'money', 'documents']));
    const { result } = setupRequired();
    expect(result.current.isHidden('action')).toBe(false);
    expect(result.current.isHidden('money')).toBe(false);
    expect(result.current.isHidden('documents')).toBe(true);
    // the payload on disk is repaired, not merely interpreted
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['documents']);
    // and the repair is idempotent — a reload reads a clean payload
    const { result: after } = setupRequired();
    expect(after.current.hidden).toEqual(['documents']);
  });
});
