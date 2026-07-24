import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  normalizeContainerNumber,
  validateContainerFormat,
  calculateCheckDigit,
  validateCheckDigit,
  validateContainerNumber,
  suggestCorrections,
} from './iso6346.ts';

describe('normalizeContainerNumber', () => {
  test('strips hyphens/spaces and uppercases', () => {
    assert.strictEqual(normalizeContainerNumber('msku-1234 565'), 'MSKU1234565');
    assert.strictEqual(normalizeContainerNumber(' allu 5216-535 '), 'ALLU5216535');
  });
});

describe('validateContainerFormat', () => {
  test('accepts 4 letters + 7 digits', () => {
    assert.strictEqual(validateContainerFormat('ALLU5216535'), true);
    assert.strictEqual(validateContainerFormat('msku1234565'), true); // normalized
  });

  test('rejects wrong shapes', () => {
    assert.strictEqual(validateContainerFormat('ALLU521653'), false); // too short
    assert.strictEqual(validateContainerFormat('ALLU52165355'), false); // too long
    assert.strictEqual(validateContainerFormat('12345678901'), false); // digits in owner
    assert.strictEqual(validateContainerFormat('ALLU52165AB'), false); // letters in serial
    assert.strictEqual(validateContainerFormat(''), false);
  });
});

describe('calculateCheckDigit', () => {
  test('ALLU521653 (first 10) → 5', () => {
    assert.strictEqual(calculateCheckDigit('ALLU521653'), 5);
  });

  test('MSKU123456 (first 10) → 5', () => {
    assert.strictEqual(calculateCheckDigit('MSKU123456'), 5);
  });

  test('remainder 10 maps to check digit 0 (AAAU000006 → 0)', () => {
    // total = 3398, 3398 % 11 = 10 → remapped to 0
    assert.strictEqual(calculateCheckDigit('AAAU000006'), 0);
  });

  test('throws when input is not 10 characters', () => {
    assert.throws(() => calculateCheckDigit('ALLU5216535'));
    assert.throws(() => calculateCheckDigit('ALLU52165'));
  });
});

describe('validateCheckDigit', () => {
  test('valid numbers pass', () => {
    assert.strictEqual(validateCheckDigit('ALLU5216535'), true); // check 5
    assert.strictEqual(validateCheckDigit('MSKU1234565'), true); // check 5
    assert.strictEqual(validateCheckDigit('AAAU0000060'), true); // check 0 via %11==10
  });

  test('bad check digit fails', () => {
    assert.strictEqual(validateCheckDigit('ALLU5216536'), false); // last digit 6 ≠ 5
    assert.strictEqual(validateCheckDigit('MSKU1234567'), false); // last digit 7 ≠ 5
  });

  test('wrong format fails fast', () => {
    assert.strictEqual(validateCheckDigit('ALLU521653'), false);
    assert.strictEqual(validateCheckDigit('1234567890A'), false);
  });
});

describe('validateContainerNumber', () => {
  test('valid → [true, ""]', () => {
    const [ok, msg] = validateContainerNumber('ALLU5216535');
    assert.strictEqual(ok, true);
    assert.strictEqual(msg, '');
  });

  test('bad format → Vietnamese message', () => {
    const [ok, msg] = validateContainerNumber('AB1234567890');
    assert.strictEqual(ok, false);
    assert.ok(msg.includes('định dạng'));
  });

  test('bad check digit → Vietnamese message', () => {
    const [ok, msg] = validateContainerNumber('ALLU5216536');
    assert.strictEqual(ok, false);
    assert.ok(msg.includes('kiểm tra'));
  });

  test('empty → prompt message', () => {
    const [ok, msg] = validateContainerNumber('');
    assert.strictEqual(ok, false);
    assert.ok(msg.includes('nhập'));
  });
});

describe('suggestCorrections', () => {
  test('returns [] for already-valid number', () => {
    assert.deepStrictEqual(suggestCorrections('ALLU5216535'), []);
  });

  test('returns [] for unrecoverable format', () => {
    assert.deepStrictEqual(suggestCorrections('ABC'), []);
    assert.deepStrictEqual(suggestCorrections('12345678901'), []);
  });

  test('check-digit-only typo ranks the original first', () => {
    // ALLU5216536 has wrong check digit; the valid original ALLU5216535 is a
    // single check-digit edit (best score) and must come first.
    const suggestions = suggestCorrections('ALLU5216536', 3);
    assert.ok(suggestions.length > 0);
    assert.strictEqual(suggestions[0], 'ALLU5216535');
    // every suggestion is itself valid
    for (const s of suggestions) {
      assert.strictEqual(validateCheckDigit(s), true);
    }
  });

  test('single mid-digit error recovers the original when given room', () => {
    // Flip the first serial digit of ALLU5216535 (5→8). Many valid 1-edit
    // candidates exist, so the original is not guaranteed in the top-3 — but it
    // IS a valid 1-edit candidate and must appear with enough room.
    const suggestions = suggestCorrections('ALLU8216535', 10);
    assert.ok(
      suggestions.includes('ALLU5216535'),
      `expected ALLU5216535 in ${JSON.stringify(suggestions)}`,
    );
    for (const s of suggestions) {
      assert.strictEqual(validateCheckDigit(s), true);
    }
  });

  test('respects maxResults', () => {
    const suggestions = suggestCorrections('ALLU5216536', 1);
    assert.ok(suggestions.length <= 1);
    assert.strictEqual(suggestions[0], 'ALLU5216535');
  });
});
