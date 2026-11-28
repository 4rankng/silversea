import { describe, expect, it } from 'vitest';
import { DRIVER_EXPENSE_OPTIONS } from './driver-expense-options';
import { DRIVER_RECEIPT_REQUIRED_EXPENSE_TYPE_CODES } from '@tingting/shared';

/**
 * QA 28/11 finding 08 — the driver's Thêm chi phí picker must expose
 * container demurrage (Phí lưu cont (DEM/DET)) as a fee DISTINCT from yard
 * storage: demurrage is charged by the shipping line, storage by the yard.
 * Before the fix the option simply did not exist, so searching "lưu cont" or
 * "DEM" returned nothing and the driver could not follow the prescribed
 * fee+receipt rule. The row must also stay receipt-mandatory.
 */
describe('DRIVER_EXPENSE_OPTIONS — container demurrage (QA 28/11 finding 08)', () => {
  it('exposes a distinct demurrage option keyed to the CONTAINER_DEMURRAGE catalog code', () => {
    const demurrage = DRIVER_EXPENSE_OPTIONS.find((option) => option.expenseTypeCode === 'CONTAINER_DEMURRAGE');
    expect(demurrage, 'the demurrage option exists').toBeTruthy();
    expect(demurrage!.label).toContain('Phí lưu cont');
    expect(demurrage!.label).toContain('DEM/DET');
    // A different row owns yard storage — the two must never share a code.
    const storage = DRIVER_EXPENSE_OPTIONS.find((option) => option.expenseTypeCode === 'YARD_STORAGE');
    expect(storage).toBeTruthy();
    expect(storage!.code).not.toBe(demurrage!.code);
  });

  it('keeps demurrage receipt-mandatory like lift/drop', () => {
    expect(DRIVER_RECEIPT_REQUIRED_EXPENSE_TYPE_CODES).toContain('CONTAINER_DEMURRAGE');
    expect(DRIVER_RECEIPT_REQUIRED_EXPENSE_TYPE_CODES).toContain('LIFTING');
    expect(DRIVER_RECEIPT_REQUIRED_EXPENSE_TYPE_CODES).toContain('LOWERING');
  });
});
