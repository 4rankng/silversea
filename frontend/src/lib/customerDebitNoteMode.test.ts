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

  it('keeps legacy PER_BATCH visible without silently converting it', () => {
    expect(buildCustomerDebitNoteModeOptions('PER_BATCH')).toEqual([
      { value: 'MONTHLY', label: 'Theo tháng' },
      { value: 'WEEKLY', label: 'Theo tuần theo hợp đồng' },
      {
        value: 'PER_BATCH',
        label: 'Theo lô (legacy, cần rà soát riêng)',
        disabled: true,
      },
    ]);
    expect(describeCustomerDebitNoteMode('PER_BATCH')).toMatch(/legacy/i);
  });

  it('describes weekly contract mode explicitly', () => {
    expect(describeCustomerDebitNoteMode('WEEKLY')).toMatch(/hợp đồng/i);
  });
});

