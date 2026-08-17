import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerSchema, customerUpdateSchema } from './index';

const validBase = {
  name: 'Khách hàng thử nghiệm',
};

test('customerSchema accepts WEEKLY debit-note mode', () => {
  const result = customerSchema.safeParse({
    ...validBase,
    debitNoteMode: 'WEEKLY',
  });
  assert.equal(result.success, true);
});

test('customerSchema rejects legacy PER_BATCH for new writes', () => {
  const result = customerSchema.safeParse({
    ...validBase,
    debitNoteMode: 'PER_BATCH',
  });
  assert.equal(result.success, false);
});

test('customerUpdateSchema accepts legacy PER_BATCH for unchanged-row compatibility', () => {
  const result = customerUpdateSchema.partial().safeParse({
    debitNoteMode: 'PER_BATCH',
  });
  assert.equal(result.success, true);
});

test('customerSchema rejects unknown debit-note modes', () => {
  const result = customerSchema.safeParse({
    ...validBase,
    debitNoteMode: 'DAILY',
  });
  assert.equal(result.success, false);
});

test('customerSchema accepts distinct full and short names', () => {
  const result = customerSchema.safeParse({
    name: 'Công ty Cổ phần Sản xuất và Thương mại Biển Bạc Việt Nam',
    shortName: 'Biển Bạc',
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.name, 'Công ty Cổ phần Sản xuất và Thương mại Biển Bạc Việt Nam');
    assert.equal(result.data.shortName, 'Biển Bạc');
  }
});

test('customerSchema rejects an explicitly blank short name', () => {
  const result = customerSchema.safeParse({
    name: 'Công ty Biển Bạc',
    shortName: '   ',
  });
  assert.equal(result.success, false);
});
