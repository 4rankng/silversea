import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { freightRateTermSchema, partialUpdateSchema, tripExpensePatchSchema } from './index';
import { invoiceTrackingPatchSchema } from './invoice-tracking';

/** Regression pins for the zod v4 default-in-.partial() change (partial
 *  updates must never ride create-time defaults into a DB write). */
test('partialUpdateSchema keeps omitted keys out of the parsed update across wrapper orderings', () => {
  const schema = z.object({
    plain: z.string().min(1),
    defaulted: z.coerce.number().int().default(7),
    // default OUTSIDE the optional wrapper
    optionalDefault: z.string().optional().default('fall'),
    // default INSIDE the nullable wrapper — v4 still applies it on undefined
    nullableDefault: z.string().default('D').nullable(),
  });

  const update = partialUpdateSchema(schema);
  assert.deepEqual(update.parse({}), {});
  assert.deepEqual(update.parse({ defaulted: '5' }), { defaulted: 5 });
  assert.deepEqual(update.parse({ optionalDefault: 'x' }), { optionalDefault: 'x' });
  assert.deepEqual(update.parse({ nullableDefault: null }), { nullableDefault: null });
  // Non-numeric text still rejects on the stripped coercing field (v3 parity:
  // null would coerce to 0 there, so it is not a rejection case).
  assert.equal(update.safeParse({ defaulted: 'abc' }).success, false);
});

test('partialUpdateSchema mirrors the unknown-keys policy of the source schema', () => {
  const strictUpdate = partialUpdateSchema(z.object({ name: z.string() }).strict());
  assert.equal(strictUpdate.safeParse({ name: 'x', rogue: 1 }).success, false);

  const looseUpdate = partialUpdateSchema(z.object({ name: z.string() }).passthrough());
  const looseParsed = looseUpdate.safeParse({ name: 'x', rogue: 1 });
  assert.equal(looseParsed.success, true);
  if (looseParsed.success) assert.ok('rogue' in looseParsed.data);

  const stripUpdate = partialUpdateSchema(z.object({ name: z.string() }));
  const stripParsed = stripUpdate.safeParse({ name: 'x', rogue: 1 });
  assert.equal(stripParsed.success, true);
  if (stripParsed.success) assert.ok(!('rogue' in stripParsed.data));
});

/** Regression pins for the two composed patch schemas the first sibling sweep
 *  missed (`.omit().partial()` / `.omit().partial().extend()` compositions —
 *  v4 would inject `progress: 'CHUA_GUI'`, `sellAmount: 0` and
 *  `settlementMethod` into every PATCH that omits them). */
test('invoiceTrackingPatchSchema leaves progress out of an omitted-key PATCH', () => {
  assert.deepEqual(invoiceTrackingPatchSchema.parse({ invoiceNumber: 'X1' }), { invoiceNumber: 'X1' });
  assert.equal(invoiceTrackingPatchSchema.safeParse({ invoiceNumber: 'X1', rogue: 1 }).success, false);
});

test('tripExpensePatchSchema keeps money/status fields out of a buyAmount-only PATCH', () => {
  assert.deepEqual(tripExpensePatchSchema.parse({ buyAmount: 1000 }), { buyAmount: 1000 });
  const explicit = tripExpensePatchSchema.parse({ buyAmount: 1000, sellAmount: 500, settlementMethod: 'COMPANY_DIRECT' });
  assert.equal(explicit.sellAmount, 500);
  assert.equal(explicit.settlementMethod, 'COMPANY_DIRECT');
});
