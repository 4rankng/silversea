// QA 28/11 — batch issue to a newly provisioned fleet driver failed 5/5 with
// the single generic line "Tài xế không còn hiệu lực để nhận lệnh." The check
// covers SIX distinct failure shapes (profile missing/deleted, profile
// INACTIVE, no linked users row, linked row missing/deleted, account
// INACTIVE, account without the DRIVER role) and the QA report's own ask is
// that the error IDENTIFY the missing setup. ineligibleDriverIssueMessage
// maps each shape to an actionable message naming the surface that fixes it.
// Deliberately NOT a blanket pass: an unlinked driver still cannot receive
// inbox orders — the inbox routes through the users link.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ineligibleDriverIssueMessage } from '../../services/dispatch-planning-commands.service';

const linked = {
  driver: { deletedAt: null, status: 'ACTIVE', userId: 42 as number | null },
  driverUser: { deletedAt: null, status: 'ACTIVE', role: 'DRIVER' },
};

describe('ineligibleDriverIssueMessage — one actionable message per failure shape', () => {
  test('QA shape — fleet-catalog driver without a users link names the missing account link', () => {
    const message = ineligibleDriverIssueMessage({ ...linked.driver, userId: null }, null);
    assert.match(message, /chưa được liên kết tài khoản đăng nhập/);
    assert.match(message, /Quản trị người dùng/);
    assert.ok(!message.includes('không còn hiệu lực'), 'the old generic line must not come back');
  });

  test('missing or deleted drivers profile points at the drivers catalog', () => {
    assert.match(
      ineligibleDriverIssueMessage(undefined, null),
      /hồ sơ tài xế không tồn tại hoặc đã bị xóa — kiểm tra lại Danh mục Tài xế/,
    );
    assert.match(
      ineligibleDriverIssueMessage({ ...linked.driver, deletedAt: new Date() }, linked.driverUser),
      /hồ sơ tài xế không tồn tại hoặc đã bị xóa/,
    );
  });

  test('INACTIVE drivers profile names the state without leaking the enum code', () => {
    const message = ineligibleDriverIssueMessage({ ...linked.driver, status: 'INACTIVE' }, linked.driverUser);
    assert.match(message, /Ngừng hoạt động — bật lại hồ sơ trong Danh mục Tài xế/);
    assert.ok(!message.includes('INACTIVE'), 'internal status codes never reach the screen');
  });

  test('linked account gone or disabled points at the Users admin', () => {
    assert.match(
      ineligibleDriverIssueMessage(linked.driver, null),
      /tài khoản đăng nhập đã liên kết không còn tồn tại/,
    );
    const disabled = ineligibleDriverIssueMessage(linked.driver, { ...linked.driverUser, status: 'INACTIVE' });
    assert.match(disabled, /đang bị vô hiệu hóa — kích hoạt lại trong Quản trị người dùng/);
    assert.ok(!disabled.includes('INACTIVE'));
  });

  test('linked account without the DRIVER role names the role fix', () => {
    const message = ineligibleDriverIssueMessage(linked.driver, { ...linked.driverUser, role: 'OPS' });
    assert.match(message, /không mang vai trò Lái xe — sửa lại vai trò trong Quản trị người dùng/);
    assert.ok(!message.includes('OPS'), 'internal role codes never reach the screen');
  });

  test('a fully eligible driver never reaches this message (type-level null only)', () => {
    // The gate only calls the helper inside the refusal branch; the helper
    // has no eligible shape. Last branch = role mismatch, so a complete
    // driver/driverUser pair still answers the role message, never a pass.
    assert.match(
      ineligibleDriverIssueMessage(linked.driver, linked.driverUser),
      /vai trò Lái xe/,
    );
  });
});
