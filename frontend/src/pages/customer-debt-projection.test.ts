import { describe, expect, it } from 'vitest';
import { TxnType, type LedgerEntry } from '@tingting/shared';
import { buildCustomerDebtMap } from './CustomersPage';
import {
  customerDebtSummaryQuery,
  customerFreightMap,
  type CustomerDebtSummaryResponse,
} from '../features/customers/customer-debt-projection';

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

// Card 20260928_177 — "Bỏ xe công ty". The tick must reach the server, and the
// rendered figures must be the server's own numbers: a client-side subtraction
// over data that never carried the own-vs-external dimension is exactly the
// silent-wrong-number defect the card exists to prevent.

function summaryFixture(
  excludeOwnFleet: boolean,
  totals: { tripCount: number; freightRevenue: number; freightPayable: number },
): CustomerDebtSummaryResponse {
  return {
    filter: { from: null, to: null, excludeOwnFleet, customerIds: [1, 2] },
    items: [
      {
        customerId: 1,
        customerName: 'Khách A',
        customerShortName: 'A',
        tripCount: totals.tripCount,
        freightRevenue: totals.freightRevenue,
        freightPayable: totals.freightPayable,
        ownFleetTripCount: 1,
        ownFleetFreightRevenue: 2_000_000,
        ownFleetFreightPayable: 0,
        lines: [
          { shipmentId: 11, tripId: 101, shipmentCode: 'S11', ownership: 'OWN', carrierKey: 'OWN', freightRevenue: 2_000_000, freightPayable: 0 },
          { shipmentId: 12, tripId: 102, shipmentCode: 'S12', ownership: 'EXTERNAL', carrierKey: 'CUST:9', freightRevenue: 3_000_000, freightPayable: 1_200_000 },
        ],
      },
      {
        customerId: 2,
        customerName: 'Khách B',
        customerShortName: 'B',
        tripCount: 1,
        freightRevenue: 5_000_000,
        freightPayable: 2_500_000,
        ownFleetTripCount: 0,
        ownFleetFreightRevenue: 0,
        ownFleetFreightPayable: 0,
        lines: [
          { shipmentId: 13, tripId: 103, shipmentCode: 'S13', ownership: 'EXTERNAL', carrierKey: 'PLATE:AB-12-X9', freightRevenue: 5_000_000, freightPayable: 2_500_000 },
        ],
      },
    ],
    totals: { ...totals, ownFleetTripCount: 1, ownFleetFreightRevenue: 2_000_000, ownFleetFreightPayable: 0 },
  };
}

describe('customerDebtSummaryQuery', () => {
  it('maps the tick ON to the server filter and OFF to its absence', () => {
    const on = new URLSearchParams(customerDebtSummaryQuery([3, 7], true));
    expect(on.get('customerIds')).toBe('3,7');
    expect(on.get('excludeOwnFleet')).toBe('true');

    const off = new URLSearchParams(customerDebtSummaryQuery([3, 7], false));
    expect(off.get('customerIds')).toBe('3,7');
    expect(off.has('excludeOwnFleet')).toBe(false);
  });
});

describe('customerFreightMap', () => {
  it('renders the server figures unchanged: ON = OFF minus the own-vehicle portion', () => {
    const off = customerFreightMap(summaryFixture(false, { tripCount: 2, freightRevenue: 5_000_000, freightPayable: 1_200_000 }));
    const on = customerFreightMap(summaryFixture(true, { tripCount: 1, freightRevenue: 3_000_000, freightPayable: 1_200_000 }));

    expect(off.get(1)!.freightRevenue).toBe(5_000_000);
    expect(on.get(1)!.freightRevenue).toBe(3_000_000);
    expect(on.get(1)!.freightRevenue).toBe(off.get(1)!.freightRevenue - off.get(1)!.ownFleetFreightRevenue);
    expect(on.get(1)!.tripCount).toBe(off.get(1)!.tripCount - off.get(1)!.ownFleetTripCount);
    // The own-vehicle portion stays reported under the filter — the tick's
    // effect is auditable, and the key never contradicts `ownership`.
    expect(on.get(1)!.ownFleetFreightRevenue).toBe(2_000_000);
    for (const line of off.get(1)!.lines) {
      expect(line.carrierKey === 'OWN').toBe(line.ownership === 'OWN');
    }
  });

  it('leaves a customer with no own-vehicle shipment unchanged by both states', () => {
    const off = customerFreightMap(summaryFixture(false, { tripCount: 2, freightRevenue: 5_000_000, freightPayable: 1_200_000 }));
    const on = customerFreightMap(summaryFixture(true, { tripCount: 1, freightRevenue: 3_000_000, freightPayable: 1_200_000 }));

    expect(on.get(2)).toEqual(off.get(2));
  });

  it('is empty before the projection arrives', () => {
    expect(customerFreightMap(undefined).size).toBe(0);
  });
});
