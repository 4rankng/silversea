import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportOpsSettlementXlsx } from '../services/ops-settlement-export.service';

after(async () => { /* no DB use: the generator is pure on `preloaded` */ });

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

// Internal DB ids never render in the exported file: the lot header falls back
// code → Số Bill/Booking → em-dash, the preparer line never falls back to the
// ops user id.
describe('ops settlement XLSX export display keys', () => {
  test('codeless lot rows carry a business key or an em-dash, never the DB id', async () => {
    const { buffer } = await exportOpsSettlementXlsx(0, {
      settlement: {
        id: 1, code: 'OS-2609-0001', status: 'RECORDED', totalAmount: '0',
        note: null, createdAt: new Date('2026-09-21T00:00:00.000Z'), approvedAt: null,
        opsUserId: 77, opsUserName: null,
      },
      grouping: {
        groups: [
          group(10, { shipmentCode: 'SHP-2609-00010', billRef: 'BILL-CODED' }),
          group(11, { billRef: 'BILL-ONLY' }),
          group(12),
        ],
        totals: { withInvoice: '0', withoutInvoice: '0', grand: '0' },
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

    assert.match(joined, /Lô SHP-2609-00010/);
    assert.match(joined, /Lô BILL-ONLY/);
    assert.match(joined, /Lô —/);
    assert.doesNotMatch(joined, /Lô 10\b/);
    assert.doesNotMatch(joined, /Lô 11\b/);
    assert.doesNotMatch(joined, /Lô 12\b/);
    assert.doesNotMatch(joined, /77\b/, 'the preparer id must never print');
    assert.match(joined, /Người lập: —/);
  });
});
