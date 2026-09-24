// Card _64 Phase B — Bảng 2.2 dedicated routing columns + bảng kê note.
// Headers are the customer's own fee names (verbatim data); a lot fee joins
// its column by name match; the ghi chú aggregation is deterministic.
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ShipmentDebitDetail } from '../../../api/shipmentDebit';
import type { QuotationFeeRow } from '../../../api/quotationClient';
import { ChiHoTable, PayablesTable, DRAFT_EMPTY } from './ShipmentDebitTables';
import { dedicatedColumns, matchDedicatedColumn, buildDebitNote } from './ShipmentDebitTables.routing';

const catalog: QuotationFeeRow[] = [
  { id: 1, feeName: 'Phí mở tờ khai', subType: 'Hàng thông thường', defaultAmount: 500000, routing: 'OTHER_COSTS', note: null, sortOrder: 0 },
  { id: 2, feeName: 'Hải quan giám sát', subType: 'Luồng xanh/vàng', defaultAmount: 150000, routing: 'DEDICATED_CUSTOMS', note: null, sortOrder: 1 },
  { id: 3, feeName: 'Hải quan giám sát', subType: 'Luồng đỏ', defaultAmount: 250000, routing: 'DEDICATED_CUSTOMS', note: null, sortOrder: 2 },
  { id: 4, feeName: 'Nâng/Hạ Lạch Huyện', subType: null, defaultAmount: 500000, routing: 'DEDICATED_DEPOT', note: null, sortOrder: 3 },
  { id: 5, feeName: 'Kiểm hóa', subType: null, defaultAmount: null, routing: 'OTHER_COSTS', note: null, sortOrder: 4 },
];

const detail = (): ShipmentDebitDetail => ({
  freightRows: [{
    containerNumber: 'QATU1234569', containerTypeLabel: "20'DC", tripId: 601, rateKey: null,
    freightCharge: 4500000, fuelSurcharge: null, customsCustomerCharge: null,
    psActual: null, psActualNote: null,
    liftSiteLabel: null, dropSiteLabel: null, payableFreight: null, customsFee: null, phatSinhFee: null,
  }],
  chiHoRows: [{
    tripId: 601, containerNumber: 'QATU1234569', containerTypeLabel: "20'DC",
    items: [],
    otherFees: [
      { id: 11, name: 'Phí mở tờ khai', amount: '500000', thuKhach: null, readOnly: false },
      { id: 12, name: 'Hải quan giám sát', amount: '150000', thuKhach: null, readOnly: false },
      { id: 13, name: 'Nâng/Hạ Lạch Huyện', amount: '500000', thuKhach: null, readOnly: false },
      { id: 14, name: 'Kẹp chì hải quan', amount: '100000', thuKhach: null, readOnly: false },
    ],
    carrierDetention: null, repairAdvance: null, opsDocsStatus: 'READY',
  }],
  customsChannel: null,
  zoneSurcharge: null,
  payables: { chiHoTotal: null },
  thuKhachTotal: null,
} as unknown as ShipmentDebitDetail);

function renderTables(catalogRows: QuotationFeeRow[] = catalog) {
  return render(
    <>
      <ChiHoTable detail={detail()} draft={DRAFT_EMPTY} frozen={false} feeCatalog={catalogRows} setFeeAmount={() => {}} addFee={() => {}} removeFee={() => {}} setAddedFee={() => {}} />
      <PayablesTable detail={detail()} />
    </>,
  );
}

describe('Bảng 2.2 dedicated routing columns (card _64 Phase B)', () => {
  it('renders one column per dedicated catalog fee name and lands matching fees inside', () => {
    renderTables();
    const customsHeader = screen.getByRole('columnheader', { name: 'Hải quan giám sát' });
    const depotHeader = screen.getByRole('columnheader', { name: 'Nâng/Hạ Lạch Huyện' });
    expect(customsHeader && depotHeader).toBeTruthy();

    const chiHoTable = document.querySelector('.csc-debit-table--chiho') as HTMLElement;
    const row = within(chiHoTable).getByRole('row', { name: /QATU1234569/ });
    const customsCell = row.children[4] as HTMLElement;
    const depotCell = row.children[5] as HTMLElement;
    const otherCell = row.children[6] as HTMLElement;

    expect(within(customsCell!).queryByText('Hải quan giám sát')).toBeTruthy();
    expect(within(depotCell).getByText('Nâng/Hạ Lạch Huyện')).toBeTruthy();
    expect(within(otherCell).getByText('Phí mở tờ khai')).toBeTruthy();
    expect(within(otherCell).getByText('Kẹp chì hải quan')).toBeTruthy();
    expect(within(otherCell).getByRole('button', { name: '+ Thêm chi phí' })).toBeTruthy();
  });

  it('keeps everything in Phí khác when the customer has no dedicated catalog', () => {
    renderTables([]);
    expect(screen.queryByRole('columnheader', { name: 'Hải quan giám sát' })).toBeNull();
    const chiHoTable = document.querySelector('.csc-debit-table--chiho') as HTMLElement;
    const row = within(chiHoTable).getByRole('row', { name: /QATU1234569/ });
    const otherCell = row.children[4] as HTMLElement;
    expect(within(otherCell).getByText('Hải quan giám sát')).toBeTruthy();
    expect(within(otherCell).getByText('Nâng/Hạ Lạch Huyện')).toBeTruthy();
  });

  it('aggregates other-costs fee names into the bảng kê note in stored order (đồng-law verbatim)', () => {
    renderTables();
    const payablesTable = document.querySelector('.csc-debit-table--payables') as HTMLElement;
    const payablesRow = within(payablesTable).getByRole('row', { name: /QATU1234569/ });
    const noteCell = within(payablesRow).getAllByRole('cell')[5];
    expect(noteCell.textContent).toBe('Phí khác: Phí mở tờ khai, Kẹp chì hải quan');
  });

  it('keeps the user note authoritative and prefixes the fee-name segment', () => {
    const d = detail();
    d.freightRows[0].psActualNote = 'Chưa có hóa đơn';
    render(
      <>
        <ChiHoTable detail={d} draft={DRAFT_EMPTY} frozen={false} feeCatalog={catalog} setFeeAmount={() => {}} addFee={() => {}} removeFee={() => {}} setAddedFee={() => {}} />
        <PayablesTable detail={d} />
      </>,
    );
    const payablesTable = document.querySelector('.csc-debit-table--payables') as HTMLElement;
    const payablesRow = within(payablesTable).getByRole('row', { name: /QATU1234569/ });
    const noteCell = within(payablesRow).getAllByRole('cell')[5];
    expect(noteCell.textContent).toBe('Chưa có hóa đơn · Phí khác: Phí mở tờ khai, Kẹp chì hải quan');
  });

  it('matches names: exact beats containment beats routing fallback, else null', () => {
    const cols = dedicatedColumns(catalog);
    expect(cols.map((col) => col.label)).toEqual(['Hải quan giám sát', 'Nâng/Hạ Lạch Huyện']);
    expect(cols).toHaveLength(2); // sub-type rows of one fee share ONE column
    expect(matchDedicatedColumn('Hải quan giám sát', cols)?.label).toBe('Hải quan giám sát');
    expect(matchDedicatedColumn('Nâng/Hạ Lạch Huyện 16/08', cols)?.label).toBe('Nâng/Hạ Lạch Huyện');
    expect(matchDedicatedColumn('Kiểm hóa', cols)).toBeNull();
    expect(matchDedicatedColumn('Lưu ca xe', cols)).toBeNull();
  });

  it('buildDebitNote: deterministic join, honest dash when nothing to say', () => {
    expect(buildDebitNote(null, [])).toBe('—');
    expect(buildDebitNote('Ghi tay', [])).toBe('Ghi tay');
    expect(buildDebitNote(null, ['A', 'B'])).toBe('Phí khác: A, B');
  });
});
