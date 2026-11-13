// SIL-812 (id 940) — Danh sách nhân sự read '—' on all four identity columns
// (MÃ NV, BỘ PHẬN, EMAIL, ĐIỆN THOẠI): driver accounts are created with
// username + họ tên only, so users.employee_code/email/phone are nearly all
// null — the driver profile (code, phone) lives on the `drivers` table.
// listHrRoster() now LEFT-JOINs drivers and COALESCEs users → drivers.
//
// Per the BE unit-only ruling (da4d2f0b) the SQL behavior itself is DB
// territory owned by qa/scripts; this file pins the query wiring that the
// ruling's source-scan convention covers (precedent: sil751).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const service = readFileSync(
  path.resolve(process.cwd(), 'src/services/user.service.ts'),
  'utf8',
);
const fn = service.slice(service.indexOf('export async function listHrRoster'));

test('SIL-812 — the roster join reads the live driver profile only', () => {
  assert.match(fn, /\.leftJoin\(drivers, /, 'identity fields come from the drivers table');
  assert.match(
    fn,
    /eq\(drivers\.userId, users\.id\), isNull\(drivers\.deletedAt\)/,
    'soft-deleted driver profiles must never duplicate a roster row or leak a retired code/phone',
  );
});

test('SIL-812 — Mã NV and Điện thoại COALESCE users → drivers, Email stays users-only', () => {
  assert.match(
    fn,
    /coalesce\(\$\{users\.employeeCode\}, \$\{drivers\.code\}\)/,
    'Mã NV falls back to the driver master-data code',
  );
  assert.match(
    fn,
    /coalesce\(\$\{users\.phone\}, \$\{drivers\.phone\}\)/,
    'Điện thoại falls back to the driver master-data phone',
  );
  assert.match(fn, /email: users\.email/, 'drivers has no email column — Email must not be fabricated');
});

test('SIL-812 — the roster stays the driver roster (2026-10-09 ruling untouched)', () => {
  assert.match(fn, /eq\(users\.role, Role\.DRIVER\)/, 'office roles stay on /users');
  assert.match(fn, /isNull\(users\.deletedAt\)/, 'live users only');
});
