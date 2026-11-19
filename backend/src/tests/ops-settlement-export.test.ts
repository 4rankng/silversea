import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportOpsSettlementXlsx } from '../services/ops-settlement-export.service';

after(async () => { /* no DB use: the generator is pure on `preloaded` */ });

function item(overrides: Record<string, unknown> = {}) {
  return {
    shipmentId: 10,
    shipmentCode: null as string | null,
    customerName: 'Khách 10' as string | null,
    billRef: null as string | null,
    containerNumber: null as string | null,
    containerLabel: 'Phí chung lô',
    declarationNumber: null as string | null,
    lotContainerNumbers: null as string[] | null,
    lotDeclarationNumbers: null as string[] | null,
    expenseTypeName: 'Cân lốp',
    requiresInvoice: false,
    amount: '1000',
    approvalStatus: 'RECORDED',
    ...overrides,
  };
}

function group(shipmentId: number, overrides: Record<string, unknown> = {}) {
  return {
    shipmentId,
    shipmentCode: null as string | null,
    customerName: `Khách ${shipmentId}` as string | null,
    billRef: null as string | null,
    withInvoice: { items: [], total: '0' },
    withoutInvoice: { items: [], total: '0' },
    total: '0',
    ...overrides,
  };
}

// Internal DB ids never render in the exported file: the flat SIL-845 rows
// carry business keys only (Tên công ty / Số Bill/Book) and a missing key
// names itself; the preparer line never falls back to the ops user id.
describe('ops settlement XLSX export display keys', () => {
  test('every row carries its business key or names the missing key, never an internal code', async () => {
    const { buffer } = await exportOpsSettlementXlsx(0, {
      settlement: {
        id: 1, code: 'OS-2609-0001', status: 'RECORDED', totalAmount: '0',
        note: null, createdAt: new Date('2026-09-21T00:00:00.000Z'), approvedAt: null,
        opsUserId: 77, opsUserName: null,
      },
      grouping: {
        groups: [
          group(10, {
            shipmentCode: 'SHP-2609-00010', billRef: 'BILL-CODED',
            withoutInvoice: { items: [item({ customerName: 'Khách 10', billRef: 'BILL-CODED' })], total: '1000' },
          }),
          group(11, {
            billRef: 'BILL-ONLY',
            withoutInvoice: { items: [item({ customerName: 'Khách 11', billRef: 'BILL-ONLY' })], total: '1000' },
          }),
          group(12, {
            withoutInvoice: { items: [item({ customerName: 'Khách 12' })], total: '1000' },
          }),
        ],
        totals: { withInvoice: '0', withoutInvoice: '3000', grand: '3000', rawGrand: '3000', excludedNegative: '0' },
      },
    } as unknown as Parameters<typeof exportOpsSettlementXlsx>[1]);

    const workbook = new ExcelJS.Workbook();
    const sheet = (await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)).worksheets[0]!;
    const texts: string[] = [];
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.text) texts.push(cell.text);
      });
    });
    const joined = texts.join('\n');

    assert.match(joined, /BILL-CODED/);
    assert.doesNotMatch(joined, /SHP-2609-00010/);
    assert.match(joined, /BILL-ONLY/);
    assert.match(joined, /Chưa có số Bill\/Booking/);
    assert.doesNotMatch(joined, /Lô \d/);
    assert.doesNotMatch(joined, /77\b/, 'the preparer id must never print');
    assert.match(joined, /Người lập: —/);
    assert.match(joined, /Tổng cộng/);

    // The three totals close the sheet, in order, in the money column
    // (ticket 18/11 Task 4.2b literals — same labels OpsSettlementsPanel
    // renders).
    const totalLabels = ['Tổng chi phí có hóa đơn', 'Tổng chi phí không hóa đơn', 'Tổng cộng'];
    const totalCells: Array<[string, string]> = [];
    sheet.eachRow((row) => {
      const label = String(row.getCell(5).value ?? '');
      if (totalLabels.includes(label)) totalCells.push([label, String(row.getCell(6).value ?? '')]);
    });
    assert.deepEqual(totalCells.map(([label]) => label), totalLabels);
    assert.deepEqual(totalCells.map(([, value]) => value), ['0', '3000', '3000']);
  });
});
