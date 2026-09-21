import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OpsSettlementSheet } from './OpsSettlementsPanel';

const grouping = (over: Record<string, unknown> = {}): Parameters<typeof OpsSettlementSheet>[0]['grouping'] => ({
  groups: [{
    shipmentId: 123,
    shipmentCode: null,
    customerName: 'Khách QA',
    billRef: 'QA-BILL-1',
    withInvoice: { items: [], total: '0' },
    withoutInvoice: { items: [], total: '0' },
    total: '0',
    ...over,
  }],
  totals: { withInvoice: '0', withoutInvoice: '0', grand: '0' },
});

const meta = {
  code: 'OS-TEST-0001',
  createdAt: '2026-09-21T00:00:00.000Z',
  opsName: 'Ops QA',
  note: null,
};

describe('OpsSettlementSheet display keys (internal ids never render)', () => {
  it('falls back to the bill/booking ref when the lot code is missing', () => {
    render(<OpsSettlementSheet grouping={grouping()} meta={meta} />);
    const sheet = document.querySelector('.ops-settlement-sheet')!;
    expect(sheet.textContent).toContain('QA-BILL-1');
    expect(sheet.textContent).not.toContain('123');
  });

  it('renders a dash when neither code nor bill exists', () => {
    render(<OpsSettlementSheet
      grouping={grouping({ billRef: null })}
      meta={meta}
    />);
    const sheet = document.querySelector('.ops-settlement-sheet')!;
    expect(sheet.textContent).toContain('Lô —');
    expect(sheet.textContent).not.toContain('123');
  });
});
