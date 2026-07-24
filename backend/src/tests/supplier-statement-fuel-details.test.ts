import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TxnType } from '@tingting/shared';
import {
  attachFuelDetailsToLedgerRows,
  attachSupplierExpenseDetailsToLedgerRows,
  withPayableProjectionBalances,
  withReceivableProjectionBalances,
  type EnrichedLedgerRow,
  type FuelTripStatementRow,
  type SupplierExpenseStatementRow,
} from '../services/statement.service';

function ledgerRow(overrides: Partial<EnrichedLedgerRow>): EnrichedLedgerRow {
  return {
    id: 1,
    timestamp: new Date('2026-07-24T00:00:00.000Z'),
    txnType: TxnType.FUEL_EXPENSE,
    txnId: 61,
    receiptId: null,
    entityType: 'VENDOR',
    entityId: 3,
    credit: '4276160',
    debit: '0',
    balance: '390045086',
    note: 'Chi phí dầu chuyến TRP-202607-0061',
    createdAt: new Date('2026-07-24T00:00:00.000Z'),
    ...overrides,
  };
}

describe('attachFuelDetailsToLedgerRows', () => {
  test('uses the actual unit price and immutable trip fuel snapshot', () => {
    const trip: FuelTripStatementRow = {
      id: 61,
      tripCode: 'TRP-202607-0061',
      departureDate: '2026-07-24',
      truckPlate: '15C-136.31',
      routeName: 'Hải Phòng – Hà Nội',
      fuelLiters: '160',
      fuelActualUnitPrice: '26726',
      fuelPriceApplied: '26000',
      totalFuelCost: '4276160',
    };

    const [result] = attachFuelDetailsToLedgerRows([ledgerRow({})], [trip]);

    assert.equal(result.tripCode, trip.tripCode);
    assert.deepEqual(result.fuelDetails, {
      departureDate: '2026-07-24',
      truckPlate: '15C-136.31',
      routeName: 'Hải Phòng – Hà Nội',
      liters: '160',
      unitPrice: '26726',
      amount: '4276160',
    });
  });

  test('falls back to the applied price when no actual price was recorded', () => {
    const trip: FuelTripStatementRow = {
      id: 61,
      tripCode: 'TRP-202607-0061',
      departureDate: '2026-07-24',
      truckPlate: null,
      routeName: null,
      fuelLiters: '160',
      fuelActualUnitPrice: null,
      fuelPriceApplied: '26000',
      totalFuelCost: '4160000',
    };

    const [result] = attachFuelDetailsToLedgerRows([ledgerRow({ credit: '4160000' })], [trip]);
    assert.equal(result.fuelDetails?.unitPrice, '26000');
  });
});

describe('withPayableProjectionBalances', () => {
  test('keeps carrier payable costs separate from customer receivable balances', () => {
    const projected = withPayableProjectionBalances([
      ledgerRow({
        id: 3,
        txnType: TxnType.VENDOR_PAYMENT,
        entityType: 'CARRIER',
        entityId: 9,
        debit: '400000',
        credit: '0',
        balance: '999999',
      }),
      ledgerRow({
        id: 2,
        txnType: TxnType.EXTERNAL_CARRIER_COST,
        entityType: 'CUSTOMER',
        entityId: 9,
        debit: '0',
        credit: '1000000',
        balance: '-123456',
      }),
    ]);

    assert.equal(projected[0].balance, '600000');
    assert.equal(projected[1].balance, '1000000');
  });
});

describe('withReceivableProjectionBalances', () => {
  test('recomputes customer debt after carrier payable rows are excluded', () => {
    const projected = withReceivableProjectionBalances([
      ledgerRow({
        id: 1,
        txnType: TxnType.TRIP_REVENUE,
        entityType: 'CUSTOMER',
        entityId: 9,
        debit: '2500000',
        credit: '0',
        balance: '2500000',
      }),
      ledgerRow({
        id: 3,
        txnType: TxnType.PAYMENT_RECEIVED,
        entityType: 'CUSTOMER',
        entityId: 9,
        debit: '0',
        credit: '1000000',
        balance: '500000',
      }),
    ]);

    assert.equal(projected[0].balance, '1500000');
    assert.equal(projected[1].balance, '2500000');
  });
});

describe('attachSupplierExpenseDetailsToLedgerRows', () => {
  const expense: SupplierExpenseStatementRow = {
    id: 38,
    supplierId: 5,
    expenseDate: '2026-07-06',
    vehiclePlate: '15C-136.31',
    vehicleComponent: 'TRUCK',
    categoryName: 'Sửa chữa nhỏ',
    amount: '8586000',
    createdAt: new Date('2026-07-07T10:00:51.349Z'),
  };

  test('uses the linked expense to expose the repair vehicle plate', () => {
    const [result] = attachSupplierExpenseDetailsToLedgerRows([
      ledgerRow({
        txnType: TxnType.VENDOR_EXPENSE,
        txnId: 38,
        entityId: 5,
        credit: '8586000',
      }),
    ], [expense]);

    assert.deepEqual(result.expenseDetails, {
      expenseDate: '2026-07-06',
      vehiclePlate: '15C-136.31',
      vehicleComponent: 'TRUCK',
      categoryName: 'Sửa chữa nhỏ',
      amount: '8586000',
    });
  });

  test('resolves a legacy row only when its timestamp match is deterministic', () => {
    const [result] = attachSupplierExpenseDetailsToLedgerRows([
      ledgerRow({
        timestamp: new Date('2026-07-07T10:00:51.349Z'),
        txnType: TxnType.VENDOR_EXPENSE,
        txnId: null,
        entityId: 5,
        credit: '8586000',
      }),
    ], [
      expense,
      { ...expense, id: 39, vehiclePlate: '15H-168.73', createdAt: new Date('2026-07-08T10:00:51.349Z') },
    ]);

    assert.equal(result.expenseDetails?.vehiclePlate, '15C-136.31');
  });
});
