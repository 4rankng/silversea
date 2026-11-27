// SIL-1205 — the port-change notification must name the changed field in the
// business word the driver knows ("tên", "mã"), never the schema key.
//
// The defect: the composer joined the raw column keys and wrapped them in
// parentheses, so the driver-facing body read
// `Cảng/bãi "Cảng Tân Vũ" vừa thay đổi (name).` — a template key where the
// change should be.
//
// The composer is pure (routes/config/port-change-notification), so the copy
// rule is pinned here without a database and without the route stack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PORT_CHANGE_FIELD_LABELS,
  portChangeNotice,
  portChangeSummary,
  portChangedFields,
} from '../../routes/config/port-change-notification';

const BEFORE = {
  id: 12,
  name: 'Cảng Tân Vũ',
  code: 'TVU',
  address: 'Cảng Tân Vũ, TP. Hồ Chí Minh',
  shortName: 'TVU',
  dispatchZone: 'HCM',
  isActive: true,
};

const PORT_LABEL = 'Cảng/bãi "Cảng Tân Vũ"';

test('a changed field is named in business words, never as a column key', () => {
  const after = { ...BEFORE, name: 'Cảng Tân Vũ mới' };
  assert.equal(portChangeSummary(BEFORE, after), 'tên');
  assert.equal(portChangeNotice(PORT_LABEL, portChangeSummary(BEFORE, after)),
    'Cảng/bãi "Cảng Tân Vũ" vừa thay đổi tên.');
});

test('no watched field ever leaks its raw key into the notification body', () => {
  for (const [field, label] of Object.entries(PORT_CHANGE_FIELD_LABELS)) {
    const after = { ...BEFORE, [field]: `${String(BEFORE[field as keyof typeof BEFORE])}-đổi` };
    const notice = portChangeNotice(PORT_LABEL, portChangeSummary(BEFORE, after));
    assert.ok(notice.includes(label), `${field} must be announced as "${label}"`);
    assert.ok(!notice.includes(`(${field})`), `${field} must not ship as a parenthesised key`);
    assert.ok(!notice.includes(field), `${field} must not ship as a raw key`);
    assert.ok(!notice.includes('('), 'the notification body carries no parenthesised key at all');
  }
});

test('every changed field is named, in Vietnamese list order', () => {
  assert.equal(portChangeSummary(BEFORE, { ...BEFORE, name: 'x', code: 'y' }), 'tên và mã');
  assert.equal(
    portChangeSummary(BEFORE, { ...BEFORE, name: 'x', code: 'y', address: 'z' }),
    'tên, mã và địa chỉ',
  );
});

test('an unchanged port announces nothing', () => {
  assert.deepEqual(portChangedFields(BEFORE, { ...BEFORE }), []);
  assert.equal(portChangeSummary(BEFORE, { ...BEFORE }), '');
});

test('the driver-facing body reads as a sentence, never as a template key', () => {
  const after = { ...BEFORE, name: 'Cảng Tân Vũ mới' };
  const notice = portChangeNotice(PORT_LABEL, portChangeSummary(BEFORE, after));
  assert.ok(!notice.includes('(name)'));
  assert.ok(!/\(\w+\)/.test(notice));
});
