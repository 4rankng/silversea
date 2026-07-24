import { describe, expect, it } from 'vitest';
import { TxnType, type LedgerEntry } from '@tingting/shared';
import { buildCustomerDebtMap } from './CustomersPage';

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: 1,
    timestamp: '2026-07-24T00:00:00.000Z',
    txnType: TxnType.TRIP_REVENUE,
    txnId: null,
    receiptId: null,
    entityType: 'CUSTOMER',
    entityId: 18,
    credit: '0',
    debit: '0',
    balance: '0',
    note: null,
    createdAt: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildCustomerDebtMap', () => {
  it('excludes historical carrier AP and recomputes customer AR from activity', () => {
    const debt = buildCustomerDebtMap([
      entry({ id: 1, debit: '2500000', balance: '2500000' }),
      entry({
        id: 2,
        txnType: TxnType.EXTERNAL_CARRIER_COST,
        debit: '0',
        credit: '1000000',
        balance: '1500000',
      }),
      entry({
        id: 3,
        txnType: TxnType.VENDOR_PAYMENT,
        debit: '400000',
        credit: '0',
        balance: '1900000',
      }),
      entry({
        id: 4,
        txnType: TxnType.PAYMENT_RECEIVED,
        debit: '0',
        credit: '500000',
        balance: '1400000',
      }),
    ]);

    expect(debt.get(18)).toBe(2000000);
  });
});
