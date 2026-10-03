import { describe, expect, it } from 'vitest';
import { LCL_PICKUP_SHELL_TASK_TAG, parseDriverTaskNote } from '@tingting/shared';
import {
  classificationHint,
  classificationOptionsForRow,
  isLclPickup,
  withLclPickupShellTag,
} from './DispatchPlanCellValues';

const POOL = ['HẾT HẠN', 'ĐẢO VỎ', 'ĐẶT ĐẦU', 'GỬI VỎ BÃI ĐĂNG KHOA'];

describe('classificationOptionsForRow', () => {
  it('offers the cont models plus Lấy Lẻ on an FCL row, and never plain Lẻ', () => {
    expect(classificationOptionsForRow('FCL').map((option) => option.value))
      .toEqual(['SINGLE', 'DOUBLE', 'COMBINED', 'LCL_PICKUP']);
  });

  it('offers exactly Lẻ and Lấy Lẻ on an LCL row — cargo mode outranks the stored value', () => {
    // The option set keys on cargoMode, not on the row's current
    // classification: a row already set to LCL_PICKUP must still be offered
    // Lẻ, or a dispatcher could never take the row back to a plain LCL run.
    expect(classificationOptionsForRow('LCL').map((option) => option.value))
      .toEqual(['LCL', 'LCL_PICKUP']);
    expect(classificationOptionsForRow('LCL').map((option) => option.label))
      .toEqual(['Lẻ', 'Lấy Lẻ']);
  });
});

describe('isLclPickup', () => {
  it('is true for the empty-shell run only', () => {
    expect(isLclPickup('LCL_PICKUP')).toBe(true);
    expect(isLclPickup('LCL')).toBe(false);
    expect(isLclPickup('SINGLE')).toBe(false);
    expect(isLclPickup(null)).toBe(false);
    expect(isLclPickup(undefined)).toBe(false);
  });
});

describe('classificationHint', () => {
  it('spells out the Lấy Lẻ run and its task-tag ending', () => {
    const hint = classificationHint('LCL', 'LCL_PICKUP');
    expect(hint).toContain('vỏ cont rỗng 40ft');
    expect(hint).toContain('thẻ tác vụ');
  });

  it('binds an LCL lot to the cargo-mode pair and says nothing on a cont row', () => {
    expect(classificationHint('LCL', 'LCL')).toContain('Lẻ hoặc Lấy Lẻ');
    expect(classificationHint('FCL', 'SINGLE')).toBeUndefined();
    expect(classificationHint('FCL', 'LCL_PICKUP')).toContain('thẻ tác vụ');
  });
});

describe('withLclPickupShellTag', () => {
  it('seeds the shell tag into an empty note', () => {
    expect(withLclPickupShellTag(null, POOL)).toBe(LCL_PICKUP_SHELL_TASK_TAG);
    expect(withLclPickupShellTag('', POOL)).toBe(LCL_PICKUP_SHELL_TASK_TAG);
  });

  it('appends the tag while keeping the dispatcher manual text on the second line', () => {
    const seeded = withLclPickupShellTag('gọi chị An trước 8h', POOL);
    expect(seeded).toBe(`${LCL_PICKUP_SHELL_TASK_TAG}\ngọi chị An trước 8h`);
    expect(parseDriverTaskNote(seeded, POOL)).toEqual({
      selectedLabels: [LCL_PICKUP_SHELL_TASK_TAG],
      manualText: 'gọi chị An trước 8h',
    });
  });

  it('keeps already-selected tags and never duplicates the seed', () => {
    const seeded = withLclPickupShellTag('ĐẶT ĐẦU; GỬI VỎ BÃI ĐĂNG KHOA', POOL);
    expect(parseDriverTaskNote(seeded, POOL).selectedLabels)
      .toEqual(['ĐẶT ĐẦU', 'GỬI VỎ BÃI ĐĂNG KHOA', LCL_PICKUP_SHELL_TASK_TAG]);
    // Idempotent: re-running the seed on an already-seeded note is a no-op,
    // so a reopen+save round-trip cannot grow a second copy.
    expect(withLclPickupShellTag(seeded, POOL)).toBe(seeded);
  });

  it('returns the note untouched when the pool is empty — an unloaded pool must not write free text', () => {
    expect(withLclPickupShellTag('ĐẢO VỎ', [])).toBe('ĐẢO VỎ');
  });
});
