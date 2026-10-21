import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseOpsMoney } from '../../services/ops-expenses.service';

/**
 * Card 211026213838 — the Ops wallet money guard. PRD OpsVanHanh "Số tiền":
 * "Số nguyên dương bằng đồng Việt Nam" — a negative is refused by name
 * ("không được âm") instead of being read as the old card-20260928_197
 * "(-) chi phí tương đương xóa dòng" adjustment. 0 stays rejected (an empty
 * row is not an amount) and the money ceiling is unchanged.
 */
describe('parseOpsMoney — Ops chi phí nonneg money guard (card 211026213838)', () => {
  test('accepts positive integer VND inside the ceiling, as number or digit string', () => {
    assert.equal(parseOpsMoney(50_000), 50_000n);
    assert.equal(parseOpsMoney('50000'), 50_000n);
    assert.equal(parseOpsMoney(999_999_999_999_999), 999_999_999_999_999n);
    assert.equal(parseOpsMoney('999999999999999'), 999_999_999_999_999n);
  });

  test('rejects a negative amount with the named message', () => {
    assert.throws(
      () => parseOpsMoney(-50_000),
      (error: unknown) => error instanceof Error && 'Số tiền không được âm.'.includes(error.message) && error.message.includes('không được âm'),
    );
    assert.throws(
      () => parseOpsMoney('-1'),
      /không được âm/,
    );
  });

  test('still rejects 0 as an empty row', () => {
    assert.throws(() => parseOpsMoney(0), /không được bằng 0/);
    assert.throws(() => parseOpsMoney('0'), /không được bằng 0/);
  });

  test('keeps the non-integer and ceiling refusals', () => {
    assert.throws(() => parseOpsMoney('12.5'), /phải là số nguyên/);
    assert.throws(() => parseOpsMoney(1_000_000_000_000_000), /vượt quá giới hạn/);
  });

  test('a custom field name rides the refusal messages', () => {
    assert.throws(() => parseOpsMoney(-5, 'Thực chi'), /Thực chi không được âm/);
  });
});
