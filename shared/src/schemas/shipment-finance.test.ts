import test from 'node:test';
import assert from 'node:assert/strict';
import { containerDepositSchema, shipmentInvoiceRecordSchema } from './shipment-finance';

const invoice = { expectedVersion: 0, supplierId: 1, invoiceNumber: 'VAT-16', invoiceDate: '2026-09-16', faceAmount: 1_000_000, supplierFeeAmount: 50_000 };
const deposit = { expectedVersion: 0, billNumber: 'BL-16', shippingLineName: 'MSC', amount: 2_000_000, depositDate: '2026-09-16', recoveredAmount: 0 };

test('KT-16: invoice value and supplier fee remain distinct facts', () => {
  const value = shipmentInvoiceRecordSchema.parse(invoice);
  assert.equal(value.faceAmount, 1_000_000);
  assert.equal(value.supplierFeeAmount, 50_000);
});
test('KT-19: reject fractional, negative, non-finite and oversized money', () => {
  for (const value of [-1, 0, 0.5, Infinity, NaN, 1_000_000_000_000_000]) {
    assert.equal(shipmentInvoiceRecordSchema.safeParse({ ...invoice, supplierFeeAmount: value }).success, false);
    assert.equal(containerDepositSchema.safeParse({ ...deposit, amount: value }).success, false);
  }
});
test('KT-17: actual dates are valid calendar dates without an invented ordering rule', () => {
  for (const value of ['2026-02-29', '2026-13-16', '2026-00-01', '16/09/2026']) {
    assert.equal(containerDepositSchema.safeParse({ ...deposit, depositDate: value }).success, false);
  }
  assert.equal(containerDepositSchema.safeParse({ ...deposit, documentsSubmittedDate: '2026-09-15' }).success, true);
  assert.equal(containerDepositSchema.safeParse({ ...deposit, depositDate: '2028-02-29' }).success, true);
});
test('KT-18: partial refunds require received amount/date and cannot exceed deposit', () => {
  assert.equal(containerDepositSchema.safeParse({ ...deposit, recoveredAmount: 500_000, refundReceivedDate: '2026-09-20' }).success, true);
  assert.equal(containerDepositSchema.safeParse({ ...deposit, recoveredAmount: 2_000_001, refundReceivedDate: '2026-09-20' }).success, false);
  assert.equal(containerDepositSchema.safeParse({ ...deposit, recoveredAmount: 500_000 }).success, false);
  assert.equal(containerDepositSchema.safeParse({ ...deposit, refundReceivedDate: '2026-09-20' }).success, false);
});
test('KT-20: creating and editing records require distinct version contracts', () => {
  for (const schema of [shipmentInvoiceRecordSchema, containerDepositSchema]) {
    const data = schema === shipmentInvoiceRecordSchema ? invoice : deposit;
    assert.equal(schema.safeParse({ ...data, expectedVersion: 1 }).success, false);
    assert.equal(schema.safeParse({ ...data, id: 2 }).success, false);
    assert.equal(schema.safeParse({ ...data, id: 2, expectedVersion: 1 }).success, true);
  }
});
