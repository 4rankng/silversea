import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportOpsSettlementXlsx } from '../../services/ops-settlement-export.service';
import { groupOpsExpensesForSettlement } from '../../services/ops-expenses.service';

// SIL-845 — the phiếu prints exactly 6 columns; approval status is NOT one of
// them. Every recorded/draft/historical row prints its money line; the
// approval workflow never leaks into the export vocabulary.
test('OPS export prints every state row as a flat money line without approval-workflow vocabulary', async () => {
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
  const text: string[] = [];
  let moneyRows = 0;
  sheet.eachRow(row => {
    row.eachCell(cell => text.push(String(cell.value ?? '')));
    if (String(row.getCell(4).value).startsWith('CONT-')) {
      moneyRows += 1;
      assert.equal(row.getCell(6).value, 1000, 'Số tiền sits in column 6');
    }
  });
  assert.equal(moneyRows, 6, 'all six state rows print');
  for (const vocab of ['Đã ghi nhận', 'Nháp', 'Đã hủy', 'Chưa ghi nhận', 'Đã từ chối']) {
    assert.ok(!text.includes(vocab), `status vocab "${vocab}" left the 6-column contract`);
  }
  assert.ok(text.includes('Kế toán'));
  assert.equal(text.some(value => /duyệt/i.test(value)), false);
  assert.ok(text.includes('6000'), 'TỔNG CỘNG QUYẾT TOÁN row carries the source total');
});

// SIL-751 — a phiếu with a negative row prints lines that do not add up to
// TỔNG CỘNG QUYẾT TOÁN (card 20260928_197 excludes negatives); the export
// must say so.
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
  assert.ok(text.some(value => value.includes('Tổng nếu cộng cả dòng âm')), 'raw line sum labelled');
  assert.ok(text.includes('270000'), 'raw line sum printed');
});
