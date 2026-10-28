import { describe, expect, it } from 'vitest';
import {
  buildCustomerDebitNoteModeOptions,
  describeCustomerDebitNoteMode,
} from './customerDebitNoteMode';

describe('customerDebitNoteMode', () => {
  it('exposes the approved weekly contract mode for editable customers', () => {
    expect(buildCustomerDebitNoteModeOptions('MONTHLY')).toEqual([
      { value: 'MONTHLY', label: 'Theo tháng' },
      { value: 'WEEKLY', label: 'Theo tuần theo hợp đồng' },
    ]);
  });

  it('keeps the per-batch mode visible without silently converting it', () => {
    expect(buildCustomerDebitNoteModeOptions('PER_BATCH')).toEqual([
      { value: 'MONTHLY', label: 'Theo tháng' },
      { value: 'WEEKLY', label: 'Theo tuần theo hợp đồng' },
      {
        value: 'PER_BATCH',
        label: 'Theo lô (chế độ cũ — không tự động chuyển)',
        disabled: true,
      },
    ]);
    expect(describeCustomerDebitNoteMode('PER_BATCH')).toMatch(/không tự động chuyển sang Theo tuần/i);
    // Product copy must never read as an internal review note.
    expect(describeCustomerDebitNoteMode('PER_BATCH')).not.toMatch(/legacy|rà soát/i);
    expect(buildCustomerDebitNoteModeOptions('PER_BATCH')[2]?.label).not.toMatch(/legacy|rà soát/i);
  });

  it('describes weekly contract mode explicitly', () => {
    expect(describeCustomerDebitNoteMode('WEEKLY')).toMatch(/hợp đồng/i);
  });
});

