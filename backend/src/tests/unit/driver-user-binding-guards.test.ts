// QA 28/11 F-E — the "five orders undeliverable" cluster's remaining ask: a
// driver↔account link control in Quản trị người dùng. The service's
// transaction bodies (bindDriverUser / unbindDriverUser) own the db work;
// these unit tests pin the PURE guard path both verbs share (tsx --test
// unit-only ruling): every refusal shape + its exact actionable message,
// without touching a database.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDriverBindable,
  assertDriverUnbindable,
  driverUserBindingVersion,
} from '../../services/driver-user-binding.service';
import { ApiError } from '../../errors';

const updatedAt = new Date('2026-11-20T08:00:00Z');
const activeDriver = { status: 'ACTIVE', deletedAt: null, updatedAt };
const activeUser = { status: 'ACTIVE', role: 'DRIVER', deletedAt: null };

function bindError(...args: Parameters<typeof assertDriverBindable>): ApiError {
  try {
    assertDriverBindable(...args);
  } catch (err) {
    assert.ok(err instanceof ApiError, 'guards refuse with ApiError, never a bare Error');
    return err;
  }
  throw new Error('expected assertDriverBindable to refuse');
}

function unbindError(driver: Parameters<typeof assertDriverUnbindable>[0], expectedVersion: number): ApiError {
  try {
    assertDriverUnbindable(driver, expectedVersion);
  } catch (err) {
    assert.ok(err instanceof ApiError, 'guards refuse with ApiError, never a bare Error');
    return err;
  }
  throw new Error('expected assertDriverUnbindable to refuse');
}

describe('assertDriverBindable — every refusal shape keeps its actionable message', () => {
  test('a complete bind (fresh version, no conflicting link) passes silently', () => {
    assert.doesNotThrow(() =>
      assertDriverBindable(activeDriver, activeUser, driverUserBindingVersion(updatedAt)),
    );
  });

  test('deleted drivers profile → 404 naming the catalog row', () => {
    const err = bindError({ ...activeDriver, deletedAt: new Date() }, activeUser, driverUserBindingVersion(updatedAt));
    assert.equal(err.statusCode, 404);
    assert.match(err.message, /Không tìm thấy hồ sơ tài xế đang sử dụng/);
  });

  test('INACTIVE drivers profile → 409 asking to reactivate first', () => {
    const err = bindError({ ...activeDriver, status: 'INACTIVE' }, activeUser, driverUserBindingVersion(updatedAt));
    assert.equal(err.statusCode, 409);
    assert.match(err.message, /đang ngưng hoạt động; hãy kích hoạt lại trước khi liên kết/);
    assert.ok(!err.message.includes('INACTIVE'), 'internal status codes never reach the screen');
  });

  test('stale version token → 409 reload hint (the optimistic-lock refusal)', () => {
    const err = bindError(activeDriver, activeUser, driverUserBindingVersion(updatedAt) - 1);
    assert.equal(err.statusCode, 409);
    assert.match(err.message, /đã thay đổi\. Vui lòng tải lại/);
  });

  test('account deleted/inactive/wrong-role refusals keep their order and messages', () => {
    const gone = bindError(activeDriver, { ...activeUser, deletedAt: new Date() }, driverUserBindingVersion(updatedAt));
    assert.equal(gone.statusCode, 404);
    assert.match(gone.message, /Không tìm thấy tài khoản đang sử dụng/);

    const disabled = bindError(activeDriver, { ...activeUser, status: 'INACTIVE' }, driverUserBindingVersion(updatedAt));
    assert.equal(disabled.statusCode, 409);
    assert.match(disabled.message, /Tài khoản đang ngưng hoạt động; hãy kích hoạt lại trước khi liên kết/);

    const wrongRole = bindError(activeDriver, { ...activeUser, role: 'OPS' }, driverUserBindingVersion(updatedAt));
    assert.equal(wrongRole.statusCode, 409);
    assert.match(wrongRole.message, /phải có đúng vai trò Tài xế \(DRIVER\)/);
    assert.ok(!wrongRole.message.includes('OPS'), 'internal role codes never reach the screen');
  });

  test('an account already linked to ANOTHER profile names that driver', () => {
    const err = bindError(activeDriver, activeUser, driverUserBindingVersion(updatedAt), 'Nguyễn Văn C');
    assert.equal(err.statusCode, 409);
    assert.match(err.message, /đã được liên kết với tài xế "Nguyễn Văn C"/);
  });

  test('precedence is contractual — a stale version beats the account checks', () => {
    const err = bindError(
      activeDriver,
      { ...activeUser, status: 'INACTIVE', role: 'OPS' },
      driverUserBindingVersion(updatedAt) - 1,
    );
    assert.match(err.message, /đã thay đổi\. Vui lòng tải lại/);
  });
});

describe('assertDriverUnbindable — clearing a link accepts maintenance states', () => {
  test('an ACTIVE profile with a fresh version unbinds', () => {
    assert.doesNotThrow(() =>
      assertDriverUnbindable(activeDriver, driverUserBindingVersion(updatedAt)),
    );
  });

  test('a DEACTIVATED profile still unbinds — clearing a stale link is maintenance', () => {
    const inactiveDriver = { ...activeDriver, status: 'INACTIVE' };
    assert.doesNotThrow(() =>
      assertDriverUnbindable(inactiveDriver, driverUserBindingVersion(updatedAt)),
    );
  });

  test('deleted profile and stale version refuse with the reload hint', () => {
    const gone = unbindError({ ...activeDriver, deletedAt: new Date() }, driverUserBindingVersion(updatedAt));
    assert.equal(gone.statusCode, 404);
    assert.match(gone.message, /Không tìm thấy hồ sơ tài xế đang sử dụng/);

    const stale = unbindError(activeDriver, driverUserBindingVersion(updatedAt) - 1);
    assert.equal(stale.statusCode, 409);
    assert.match(stale.message, /đã thay đổi\. Vui lòng tải lại trước khi hủy liên kết/);
  });
});

describe('driverUserBindingVersion — the version token the editor sends back', () => {
  test('derives from updatedAt and never drops below 1', () => {
    assert.equal(driverUserBindingVersion(updatedAt), updatedAt.getTime());
    assert.equal(driverUserBindingVersion(new Date(0)), 1);
  });
});
