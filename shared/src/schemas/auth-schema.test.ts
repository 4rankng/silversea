import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  updateProfileSchema,
  updateUserSchema,
} from './index';

/** Regression pins (zod v3 → v4 bump, case-2026-10-29-zod4-final-bump):
 *  auth wire payloads must accept/return identically across the bump —
 *  including create-time defaults (`status`, `customerAccountType`), which is
 *  exactly the semantics zod v4 changed inside `.partial()`/`.default()`. */

test('Z4-AUTH-1: loginSchema accepts a real credential pair and rejects an empty identifier', () => {
  const parsed = loginSchema.parse({ identifier: 'thanhdc', password: 'matkhau1' });
  assert.deepEqual(parsed, { identifier: 'thanhdc', password: 'matkhau1' });
  assert.equal(loginSchema.safeParse({ identifier: '', password: 'matkhau1' }).success, false);
  assert.equal(loginSchema.safeParse({ identifier: 'thanhdc' }).success, false);
});

test('Z4-AUTH-2: createUserSchema accepts a real admin payload and applies create-time defaults unchanged', () => {
  const parsed = createUserSchema.parse({
    username: 'thanhdc',
    email: 'thanhdc@silversea.vn',
    fullName: 'Đặng Thanh',
    password: 'matkhau1',
    role: 'ADMIN',
    businessUnitIds: [1, 2],
  });
  // Defaults ride on CREATE (both zod v3 and v4) — pinned so the bump cannot
  // flip them into `undefined` (or, via a partial-style regression, into
  // re-defaulting on update paths).
  assert.equal(parsed.status, 'ACTIVE');
  assert.equal(parsed.customerAccountType, 'SINGLE_ENTITY');
  assert.equal(parsed.username, 'thanhdc');
  assert.equal(parsed.role, 'ADMIN');
  assert.deepEqual(parsed.businessUnitIds, [1, 2]);
});

test('Z4-AUTH-3: createUserSchema requires at least one of username/email/phone with the Vietnamese message', () => {
  const missing = createUserSchema.safeParse({ fullName: 'Chỉ có tên', password: 'matkhau1', role: 'OPS' });
  assert.equal(missing.success, false);
  if (!missing.success) {
    assert.equal(
      missing.error.issues[0]?.message,
      'Phải cung cấp ít nhất một trong: username, email, hoặc số điện thoại',
    );
  }
  // phone alone satisfies the identity rule
  assert.equal(createUserSchema.safeParse({ phone: '0900000001', password: 'matkhau1', role: 'DRIVER' }).success, true);
});

test('Z4-AUTH-4: updateUserSchema email clears with blank, accepts valid, rejects malformed', () => {
  assert.deepEqual(updateUserSchema.parse({ email: '' }), { email: '' });
  assert.deepEqual(updateUserSchema.parse({ email: 'khach@congty.vn' }), { email: 'khach@congty.vn' });
  assert.equal(updateUserSchema.safeParse({ email: 'khong-phai-email' }).success, false);
  assert.equal(updateUserSchema.safeParse({ password: '12345' }).success, false);
});

test('Z4-AUTH-5: changePasswordSchema and updateProfileSchema keep their Vietnamese guard messages', () => {
  const short = changePasswordSchema.safeParse({ currentPassword: 'cu', newPassword: '12345' });
  assert.equal(short.success, false);
  if (!short.success) {
    assert.equal(short.error.issues[0]?.message, 'Mật khẩu mới phải có ít nhất 6 ký tự');
  }

  const emptyProfile = updateProfileSchema.safeParse({ fullName: undefined });
  assert.equal(emptyProfile.success, false);
  if (!emptyProfile.success) {
    assert.equal(
      emptyProfile.error.issues[0]?.message,
      'Phải cung cấp ít nhất một trong: username, họ tên, email, hoặc số điện thoại',
    );
  }
});
