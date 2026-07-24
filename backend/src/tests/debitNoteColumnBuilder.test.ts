import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  debitNoteColumnSchema,
  defaultDebitNoteColumns,
  defaultPaymentStatementColumns,
} from '@tingting/shared';

test('debitNoteColumnSchema — accepts width:0 (hidden column)', () => {
  const parsed = debitNoteColumnSchema.parse({
    id: 'ghi_chu', label: 'Ghi chú', variable: 'note', width: 0,
    align: 'left', format: 'text', total: false,
  });
  assert.equal(parsed.width, 0);
});

test('debitNoteColumnSchema — defaults width to 14 when omitted', () => {
  const parsed = debitNoteColumnSchema.parse({
    id: 'ghi_chu', label: 'Ghi chú', variable: 'note',
  });
  assert.equal(parsed.width, 14);
});

test('debitNoteColumnSchema — rejects negative width', () => {
  assert.throws(() => debitNoteColumnSchema.parse({
    id: 'x', label: 'X', variable: 'note', width: -1,
  }));
});

test('debitNoteColumnSchema — rejects width > 80', () => {
  assert.throws(() => debitNoteColumnSchema.parse({
    id: 'x', label: 'X', variable: 'note', width: 200,
  }));
});

test('defaultDebitNoteColumns — exported as vertical debt-note columns', () => {
  assert.ok(Array.isArray(defaultDebitNoteColumns));
  assert.equal(defaultDebitNoteColumns.length, 7);
  assert.equal(defaultDebitNoteColumns[0].variable, 'departureDate');
  assert.equal(defaultDebitNoteColumns[1].variable, 'documentCode');
  assert.equal(defaultDebitNoteColumns[2].variable, 'description');
  const amountCol = defaultDebitNoteColumns.find(c => c.id === 'thanh_tien');
  assert.ok(amountCol, 'amount column should exist');
  assert.equal(amountCol.total, true);
});

test('defaultDebitNoteColumns — every column validates against debitNoteColumnSchema', () => {
  for (const c of defaultDebitNoteColumns) {
    const parsed = debitNoteColumnSchema.parse(c);
    assert.equal(parsed.id, c.id);
  }
});

test('defaultPaymentStatementColumns — exported as horizontal VIETSUN-style columns', () => {
  assert.ok(Array.isArray(defaultPaymentStatementColumns));
  assert.equal(defaultPaymentStatementColumns.length, 13);
  assert.equal(defaultPaymentStatementColumns[0].variable, 'rowIndex');
  const freightCol = defaultPaymentStatementColumns.find(c => c.variable === 'amount');
  assert.ok(freightCol, 'freight/amount column should exist');
  assert.equal(freightCol.total, true);
  const serviceFeeCol = defaultPaymentStatementColumns.find(c => c.variable === 'serviceFeeAmount');
  assert.ok(serviceFeeCol, 'horizontal statement should expose service fee amount');
  assert.equal(serviceFeeCol.total, true);
  const actionCol = defaultPaymentStatementColumns.find(c => c.variable === 'actionType');
  assert.ok(actionCol, 'actionType column should exist');
});

test('defaultPaymentStatementColumns — every column validates against debitNoteColumnSchema', () => {
  for (const c of defaultPaymentStatementColumns) {
    const parsed = debitNoteColumnSchema.parse(c);
    assert.equal(parsed.id, c.id);
  }
});
