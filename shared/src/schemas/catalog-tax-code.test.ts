import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customerSchema, customerUpdateSchema, supplierSchema } from './index';

for (const [name, schema] of [
  ['customer create', customerSchema],
  ['customer update', customerUpdateSchema.partial()],
  ['supplier create', supplierSchema],
  ['supplier update', supplierSchema.partial()],
] as const) {
  test(`${name}: tax code honors existing 20-character storage boundary`, () => {
    const invalid = schema.safeParse({ name: 'Catalog test', taxCode: '1'.repeat(21) });
    assert.equal(invalid.success, false);
    if (!invalid.success) {
      assert.deepEqual(invalid.error.issues[0].path, ['taxCode']);
      assert.match(invalid.error.issues[0].message, /20/);
    }
    const valid = schema.parse({ name: 'Catalog test', taxCode: `  ${'1'.repeat(20)}  ` });
    assert.equal(valid.taxCode, '1'.repeat(20));
    assert.equal(schema.parse({ name: 'Catalog test', taxCode: '  ' }).taxCode, '');
    assert.equal(schema.safeParse({ name: 'Catalog test' }).success, true);
  });
}
