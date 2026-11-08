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

// SIL-751 — a phiếu with a negative row prints lines that do not add up to
// TỔNG CỘNG (card 20260928_197 excludes negatives); the export must say so.
test('OPS export prints the excluded-negative reconciliation for the OS-2610-0001 shape', async () => {
  const grouping = groupOpsExpensesForSettlement([
    { shipmentId: 1, shipmentCode: 'SS-1', customerName: 'Khách', billRef: 'BL-1',
      containerNumber: null, expenseTypeName: 'Nhân công kho', requiresInvoice: false,
      amount: '-50000', approvalStatus: 'RECORDED' },
    { shipmentId: 1, shipmentCode: 'SS-1', customerName: 'Khách', billRef: 'BL-1',
      containerNumber: null, expenseTypeName: 'Đổi cont', requiresInvoice: false,
      amount: '200000', approvalStatus: 'RECORDED' },
    { shipmentId: 1, shipmentCode: 'SS-1', customerName: 'Khách', billRef: 'BL-1',
      containerNumber: null, expenseTypeName: 'Nhân công kho', requiresInvoice: false,
      amount: '120000', approvalStatus: 'RECORDED' },
  ]);
  const { buffer } = await exportOpsSettlementXlsx(1, {
    settlement: { id: 1, code: 'OS-TEST-NEG', status: 'RECORDED', totalAmount: '320000',
      note: null, createdAt: '2026-11-08T00:00:00.000Z', approvedAt: null,
      opsUserId: 1, opsUserName: 'OPS' }, grouping,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
  const text: string[] = [];
  workbook.worksheets[0].eachRow(row => row.eachCell(cell => text.push(String(cell.value ?? ''))));
  assert.ok(text.some(value => value.includes('Dòng âm đã loại trừ')), 'exclusion label present');
  assert.ok(text.includes('-50000'), 'excluded amount printed');
  assert.ok(text.some(value => value.includes('Tổng nếu cộng cả dòng âm: 270.000')), 'raw line sum printed');
});
