import { describe, expect, it } from 'vitest';
import { formatMoneyInput, moneyInputToNumber, normalizeMoneyInput } from './moneyInput';

describe('moneyInput', () => {
  it('treats Vietnamese dots as thousands separators', () => {
    expect(normalizeMoneyInput('21.170')).toBe('21170');
    expect(moneyInputToNumber('21.170')).toBe(21170);
  });

  it('serializes two-point delivery bonus values as integer VND', () => {
    expect(normalizeMoneyInput('100.000')).toBe('100000');
    expect(moneyInputToNumber('100.000 đ')).toBe(100000);
  });

  it('formats raw integer VND for display', () => {
    expect(formatMoneyInput('21170')).toBe('21.170');
    expect(formatMoneyInput('100000')).toBe('100.000');
  });

  it('keeps blank money fields blank for fallback/null semantics', () => {
    expect(normalizeMoneyInput('')).toBe('');
    expect(moneyInputToNumber('')).toBeUndefined();
  });
});
