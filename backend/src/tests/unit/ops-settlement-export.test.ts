import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportOpsSettlementXlsx } from '../../services/ops-settlement-export.service';
import { groupOpsExpensesForSettlement } from '../../services/ops-expenses.service';

test('OPS export distinguishes recorded, draft and historical states without an approval workflow', async () => {
  const statuses = ['RECORDED', 'APPROVED', 'DRAFT', 'VOIDED', 'PENDING', 'REJECTED'];
  const grouping = groupOpsExpensesForSettlement(statuses.map((approvalStatus, index) => ({
    shipmentId: 1, shipmentCode: 'QA-EXPORT', customerName: 'Khách', billRef: 'BILL',
    containerNumber: `CONT-${index}`, expenseTypeName: 'Phí', requiresInvoice: false,
    amount: '1000', approvalStatus,
  })));
  const { buffer } = await exportOpsSettlementXlsx(1, {
    settlement: { id: 1, code: 'OS-TEST', status: 'RECORDED', totalAmount: '6000',
      note: null, createdAt: '2026-09-17T00:00:00.000Z', approvedAt: null,
      opsUserId: 1, opsUserName: 'OPS' }, grouping,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
  const sheet = workbook.worksheets[0];
  const labels: string[] = [];
  const text: string[] = [];
  sheet.eachRow(row => {
    row.eachCell(cell => text.push(String(cell.value ?? '')));
    if (String(row.getCell(1).value).startsWith('CONT-')) {
      labels.push(String(row.getCell(4).value));
      assert.equal(row.getCell(3).value, 1000);
    }
  });
  assert.deepEqual(labels, ['Đã ghi nhận', 'Đã ghi nhận', 'Nháp', 'Đã hủy',
    'Chưa ghi nhận (dữ liệu cũ)', 'Đã từ chối (dữ liệu cũ)']);
  assert.ok(text.includes('Kế toán'));
  assert.equal(text.some(value => /duyệt/i.test(value)), false);
  assert.ok(text.includes('6000'), 'source total remains unchanged');
});
