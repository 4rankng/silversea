import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { ApiError } from '../../errors';
import { throwValidation } from '../../lib/validation';

/** The lesson from the five-container banner (2026-09-18): the `error` string is
 *  user-facing, so it must not carry a Zod field path; the machine-readable
 *  locations stay in `details`, verbatim. */
const batchSchema = z.object({
  expectedVersion: z.number(),
  containers: z.array(z.object({
    containerNumber: z.string(),
    containerTypeId: z.number().int().positive('Loại container là bắt buộc'),
  })),
});

function rejection(containers: Array<Record<string, unknown>>): ApiError {
  const parsed = batchSchema.safeParse({ expectedVersion: 1, containers });
  assert.equal(parsed.success, false);
  let caught: unknown;
  try {
    throwValidation(parsed.error);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ApiError);
  return caught;
}

const PATH_TOKEN = /\(?[a-zA-Z]+\.[a-zA-Z0-9_.]+\)?/;

test('the rejection message carries no internal field path', () => {
  const missingField = rejection([{ containerNumber: 'ABCD-1234567' }, { containerNumber: 'ABCD-1234568' }]);
  assert.equal(missingField.statusCode, 400);
  assert.equal(missingField.message, 'Required');
  assert.equal(PATH_TOKEN.test(missingField.message), false);

  // The Vietnamese schema message the banner showed five times must stand alone
  // too — no "(containers.0.containerTypeId)" tail.
  const zeroType = rejection([{ containerNumber: 'ABCD-1234567', containerTypeId: 0 }]);
  assert.equal(zeroType.message, 'Loại container là bắt buộc');
  assert.equal(PATH_TOKEN.test(zeroType.message), false);
});

test('details keep every issue path so clients can still locate the rows', () => {
  const error = rejection([{ containerNumber: 'ABCD-1234567' }, { containerNumber: 'ABCD-1234568' }]);
  const details = error.details as Array<{ path: Array<string | number>; message: string }>;
  assert.equal(details.length, 2);
  assert.deepEqual(details.map((issue) => issue.path), [
    ['containers', 0, 'containerTypeId'],
    ['containers', 1, 'containerTypeId'],
  ]);
});
