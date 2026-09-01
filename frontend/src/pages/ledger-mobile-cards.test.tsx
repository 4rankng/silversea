import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TxnType } from '@tingting/shared';
import type { LedgerEntry } from '@tingting/shared';
import { ReceivableLedgerCard } from '../features/accounting/receivable-ledger';
import {
  ExpenseLedgerCard,
  ExpenseLedgerRow,
  FuelLedgerCard,
  FuelLedgerRow,
  PayableLedgerCard,
} from '../features/accounting/ledger-rows';

function ledgerRow(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: 1,
    timestamp: '2026-07-19T08:30:00.000Z',
    txnType: TxnType.ADJUSTMENT,
    txnId: null,
    receiptId: null,
    entityType: 'CLIENT',
    entityId: 1,
    credit: '0',
    debit: '0',
    balance: '0',
    note: null,
    createdAt: '2026-07-19T08:30:00.000Z',
    ...overrides,
  };
}

describe('mobile ledger cards', () => {
  it('preserves the receivable route and its distinct accounting note', () => {
    const row = ledgerRow({
      txnType: TxnType.TRIP_REVENUE,
      txnId: 98,
      tripId: 98,
      tripCode: 'TRP-202606-0098',
      routeName: 'Hải Phòng – Yên Sơn, Tuyên Quang',
      note: 'Đối chiếu cước theo phụ lục tháng 7',
      containerNumbers: ['REC-1784430033599'],
      debit: '4500000',
      balance: '515279259',
    });

    render(<ul><ReceivableLedgerCard row={row} /></ul>);

    expect(screen.getByRole('listitem')).toBeTruthy();
    expect(screen.getByText('Hải Phòng – Yên Sơn, Tuyên Quang')).toBeTruthy();
    expect(screen.getByText('Đối chiếu cước theo phụ lục tháng 7')).toBeTruthy();
    expect(screen.getByText('TRP-202606-0098')).toBeTruthy();
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe(row.timestamp);
  });

  it('shows payable credit, payment, and running balance fields', () => {
    const row = ledgerRow({
      txnType: TxnType.VENDOR_PAYMENT,
      entityType: 'VENDOR',
      receiptId: 'PC-20260719-01',
      credit: '3200000',
      debit: '1200000',
      balance: '2000000',
      note: 'Thanh toán một phần',
    });

    render(<ul><PayableLedgerCard row={row} /></ul>);

    expect(screen.getByText('Phải trả')).toBeTruthy();
    expect(screen.getByText('Đã trả')).toBeTruthy();
    expect(screen.getByText('Số dư')).toBeTruthy();
    expect(screen.getByText('PC-20260719-01')).toBeTruthy();
    expect(screen.getByText('Thanh toán một phần')).toBeTruthy();
  });

  it.each([
    {
      layout: 'desktop',
      component: (
        <table><tbody><FuelLedgerRow row={ledgerRow({
          txnType: TxnType.FUEL_EXPENSE,
          entityType: 'VENDOR',
          tripCode: 'TRP-202607-0061',
          credit: '4276160',
          balance: '390045086',
          fuelDetails: {
            departureDate: '2026-07-24',
            truckPlate: '15C-136.31',
            routeName: 'Hải Phòng – Hà Nội',
            liters: '160',
            unitPrice: '26726',
            amount: '4276160',
          },
        })} /></tbody></table>
      ),
    },
    {
      layout: 'mobile',
      component: (
        <ul><FuelLedgerCard row={ledgerRow({
          txnType: TxnType.FUEL_EXPENSE,
          entityType: 'VENDOR',
          tripCode: 'TRP-202607-0061',
          credit: '4276160',
          balance: '390045086',
          fuelDetails: {
            departureDate: '2026-07-24',
            truckPlate: '15C-136.31',
            routeName: 'Hải Phòng – Hà Nội',
            liters: '160',
            unitPrice: '26726',
            amount: '4276160',
          },
        })} /></ul>
      ),
    },
  ])('shows the complete fuel purchase detail on $layout', ({ component }) => {
    render(component);

    expect(screen.getByText('24/7/2026')).toBeTruthy();
    expect(screen.getByText('15C-136.31')).toBeTruthy();
    expect(screen.getByText('Hải Phòng – Hà Nội')).toBeTruthy();
    expect(screen.getByText('160 lít')).toBeTruthy();
    expect(screen.getByText(/26\.726/)).toBeTruthy();
    expect(screen.getByText(/4\.276\.160/)).toBeTruthy();
    expect(screen.getByText('TRP-202607-0061')).toBeTruthy();
  });

  it.each([
    {
      layout: 'desktop',
      component: (
        <table><tbody><ExpenseLedgerRow row={ledgerRow({
          txnType: TxnType.VENDOR_EXPENSE,
          entityType: 'VENDOR',
          credit: '8586000',
          balance: '8586000',
          note: 'Chi phí Sửa chữa nhỏ',
          expenseDetails: {
            expenseDate: '2026-07-06',
            vehiclePlate: '15C-136.31',
            vehicleComponent: 'TRUCK',
            categoryName: 'Sửa chữa nhỏ',
            amount: '8586000',
          },
        })} /></tbody></table>
      ),
    },
    {
      layout: 'mobile',
      component: (
        <ul><ExpenseLedgerCard row={ledgerRow({
          txnType: TxnType.VENDOR_EXPENSE,
          entityType: 'VENDOR',
          credit: '8586000',
          balance: '8586000',
          note: 'Chi phí Sửa chữa nhỏ',
          expenseDetails: {
            expenseDate: '2026-07-06',
            vehiclePlate: '15C-136.31',
            vehicleComponent: 'TRUCK',
            categoryName: 'Sửa chữa nhỏ',
            amount: '8586000',
          },
        })} /></ul>
      ),
    },
  ])('shows the repair vehicle plate on $layout', ({ component }) => {
    render(component);

    expect(screen.getByText('6/7/2026')).toBeTruthy();
    expect(screen.getByText('15C-136.31')).toBeTruthy();
    expect(screen.getByText('Sửa chữa nhỏ')).toBeTruthy();
    expect(screen.getAllByText(/8\.586\.000/).length).toBeGreaterThan(0);
  });
});
