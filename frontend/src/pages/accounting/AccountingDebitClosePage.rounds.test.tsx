/**
 * Card 201026095604a — the TỔNG HỢP CÔNG NỢ rounds table rides the shared
 * NameCell like the chốt-debit board above it: the wire carries the
 * operational (short) name, the cell keeps the displayed name reachable via
 * the tooltip law, and the same customer renders consistently on both tables.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DebitSettlementRoundRow } from '../../api/accountingDebitClient';
import { DebitRoundBoard } from './AccountingDebitClosePage.rounds';

const round = (over: Partial<DebitSettlementRoundRow> = {}): DebitSettlementRoundRow => ({
  id: 1,
  customerId: 7,
  customerName: 'LONG MINH',
  direction: 'THU',
  carrierKey: 'CUST:12',
  carrierLabel: 'Duyên Hải',
  periodKey: '2026-10',
  roundNo: 1,
  dateFrom: '2026-10-01',
  dateTo: '2026-10-31',
  amount: '1000000',
  vatRate: 8,
  vatAmount: 80000,
  totalAmount: 1080000,
  lotCount: 3,
  ghiChu: null,
  createdAt: '2026-10-20T00:00:00.000Z',
  ...over,
});

describe('card 201026095604a — rounds table names ride the shared NameCell', () => {
  it('customer + carrier cells render through NameCell (title = displayed name)', () => {
    const { container } = render(<DebitRoundBoard rounds={[round()]} />);
    const names = container.querySelectorAll('.name-cell');
    expect(names).toHaveLength(2);
    expect(names[0].textContent).toBe('LONG MINH');
    expect(names[0].getAttribute('title')).toBe('LONG MINH');
    expect(names[1].textContent).toBe('Duyên Hải');
    expect(names[1].getAttribute('title')).toBe('Duyên Hải');
  });

  it('missing names degrade to — outside NameCell, never an empty cell', () => {
    const { container } = render(<DebitRoundBoard rounds={[round({ customerName: null, carrierLabel: null })]} />);
    expect(container.querySelectorAll('.name-cell')).toHaveLength(0);
    expect(container.textContent).toContain('—');
  });
});
