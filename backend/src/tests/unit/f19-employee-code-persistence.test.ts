// QA 28/11 F19 — the admin Users editor saves Mã nhân viên with HTTP 200 but
// users.employee_code stayed null (the FE wire body dropped the field — pinned
// in useUserMutations.employee-code.test.tsx) and the backend never mirrored
// the code onto the linked drivers row, so the HR roster (which reads
// coalesce(users.employee_code, drivers.code)) kept its dash.
//
// Per the BE unit-only ruling (da4d2f0b) the SQL behavior itself is DB
// territory owned by qa/scripts; this file pins the write wiring that the
// ruling's source-scan convention covers (precedent: sil812).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const service = readFileSync(
  path.resolve(process.cwd(), 'src/services/user.service.ts'),
  'utf8',
);
const sliceFn = (name: string) => {
  const start = service.indexOf(name);
  assert.ok(start > -1, `${name} exists`);
  return service.slice(start);
};

test('F19 — updateUserWithTx persists employeeCode onto users', () => {
  const fn = sliceFn('export async function updateUserWithTx');
  assert.match(
    fn,
    /if \(data\.employeeCode !== undefined\) updates\.employeeCode = data\.employeeCode \|\| null;/,
    'the users-side write must fire whenever the editor sends the field',
  );
});

test('F19 — a live drivers row mirrors the code; the backfill insert carries it too', () => {
  const fn = sliceFn('function buildDriverUpdateSet');
  assert.match(
    fn,
    /if \(data\.employeeCode !== undefined\) set\.code = data\.employeeCode\?\.trim\(\) \|\| null;/,
    'the HR roster reads drivers.code — the live profile row must mirror the authored Mã NV',
  );
  const fn2 = sliceFn('export async function updateUserWithTx');
  assert.match(
    fn2,
    /code: data\.employeeCode\?\.trim\(\) \|\| null,\n\s*status: 'ACTIVE',/,
    'the self-heal profile insert (unbound DRIVER account) provisions the code with the row',
  );
});

test('F19 — create-time DRIVER provisioning carries the code from day one', () => {
  const start = service.indexOf('export async function createUserWithTx');
  const end = service.indexOf('export async function updateUserWithTx');
  assert.ok(start > -1 && end > start, 'both functions exist, create precedes update');
  const fn = service.slice(start, end);
  assert.match(
    fn,
    /employeeCode: data\.employeeCode\?\.trim\(\) \|\| null,/,
    'the users insert reads the field',
  );
  assert.match(
    fn,
    /code: data\.employeeCode\?\.trim\(\) \|\| null,/,
    'the provisioned drivers row mirrors it at creation',
  );
});
