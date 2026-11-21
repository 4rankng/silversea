// SIL-876 (hotfix CR-009.1) — the shared view law of the Ghép bộ Debit grid:
// newest-first default on BOTH surfaces, and one search/date-range semantics.
import { describe, expect, it } from 'vitest';
import type { DebitMergeItem } from '@tingting/shared';
import { filterDebitMergeRows, sortDebitMergeRowsDesc } from './debit-merge-view';

const row = (over: Partial<DebitMergeItem> & Pick<DebitMergeItem, 'shipmentId'>): DebitMergeItem => ({
  code: null,
  customerId: null,
  customerName: null,
  factoryName: null,
  routeName: null,
  deliveryDate: null,
  billOrBookNumber: null,
  creatorName: null,
  creatorCode: null,
  containers: [],
  revenue: { cuoc: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: null },
  chiHo: { csht: [], lift: [], drop: [], other: [] },
  noInvoice: { gnFee: null, gnPaid: null, psFee: null, psPaid: null, fees: [] },
  control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null },
  ...over,
});

describe('sortDebitMergeRowsDesc — mặc định mới nhất lên đầu', () => {
  it('orders by deliveryDate DESC; dateless lots sit OLDEST, id breaks ties', () => {
    const sorted = sortDebitMergeRowsDesc([
      row({ shipmentId: 1, deliveryDate: '2026-09-01' }),
      row({ shipmentId: 2, deliveryDate: '2026-11-18' }),
      row({ shipmentId: 3, deliveryDate: '2026-11-18' }),
      row({ shipmentId: 4, deliveryDate: null }),
      row({ shipmentId: 5, deliveryDate: '2026-10-02' }),
    ]);
    expect(sorted.map((item) => item.shipmentId)).toEqual([3, 2, 5, 1, 4]);
  });

  it('does not mutate the caller array', () => {
    const source = [row({ shipmentId: 1, deliveryDate: '2026-09-01' }), row({ shipmentId: 2, deliveryDate: '2026-11-18' })];
    sortDebitMergeRowsDesc(source);
    expect(source.map((item) => item.shipmentId)).toEqual([1, 2]);
  });
});

describe('filterDebitMergeRows — tìm kiếm Bill/Cont/KH + lọc Tu ngày–Den ngày', () => {
  const rows = [
    row({ shipmentId: 1, billOrBookNumber: 'JJCTCHPDY260305', customerName: 'Long Minh', deliveryDate: '2026-11-02', containers: [{ id: 1, containerNumber: 'TWCU8170772', containerType: null }] }),
    row({ shipmentId: 2, billOrBookNumber: 'EBKG18535623', customerName: 'VĂN LAN', deliveryDate: '2026-11-15', containers: [{ id: 2, containerNumber: 'MSMU7208543', containerType: null }] }),
    row({ shipmentId: 3, billOrBookNumber: null, customerName: 'Long Minh', deliveryDate: null, containers: [{ id: 3, containerNumber: 'ABCZ1234567', containerType: null }] }),
  ];

  it('search matches bill, container and customer, case-insensitively', () => {
    expect(filterDebitMergeRows(rows, { search: 'jjctchpdy', dateFrom: '', dateTo: '' }).map((item) => item.shipmentId)).toEqual([1]);
    expect(filterDebitMergeRows(rows, { search: 'msmu7208543', dateFrom: '', dateTo: '' }).map((item) => item.shipmentId)).toEqual([2]);
    expect(filterDebitMergeRows(rows, { search: 'long minh', dateFrom: '', dateTo: '' }).map((item) => item.shipmentId)).toEqual([1, 3]);
  });

  it('date range bounds deliveryDate; a dateless lot sits outside ANY bounded range', () => {
    expect(filterDebitMergeRows(rows, { search: '', dateFrom: '2026-11-01', dateTo: '2026-11-30' }).map((item) => item.shipmentId)).toEqual([1, 2]);
    expect(filterDebitMergeRows(rows, { search: '', dateFrom: '2026-11-10', dateTo: '' }).map((item) => item.shipmentId)).toEqual([2]);
    expect(filterDebitMergeRows(rows, { search: '', dateFrom: '', dateTo: '2026-10-31' }).map((item) => item.shipmentId)).toEqual([]);
    // Open filter keeps everything, dateless included.
    expect(filterDebitMergeRows(rows, { search: '', dateFrom: '', dateTo: '' })).toHaveLength(3);
  });

  it('search and range compose', () => {
    expect(filterDebitMergeRows(rows, { search: 'long minh', dateFrom: '2026-11-01', dateTo: '' }).map((item) => item.shipmentId)).toEqual([1]);
  });
});
