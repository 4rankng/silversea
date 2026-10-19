import { describe, expect, it } from 'vitest';
import { formatQuantity } from './cusUtils';

/**
 * Card 181026185900 (A.7) — the CUS weight column ("Trọng lượng (kg)" drawer
 * column, the Tổng quan hàng hóa cargo summary, the LCL metrics line) renders
 * through formatQuantity. The customer contract: integer kilograms never
 * carry a ",00" tail ("1.000,00 kg" reads "1.000 kg"), while a REAL decimal
 * keeps its significant digit. Intl's maximumFractionDigits already behaves
 * this way — this suite pins it so a future minimumFractionDigits/toFixed
 * regression cannot reintroduce the dead tail.
 */
describe('formatQuantity (CUS weight/metric columns)', () => {
  it('renders integer kilograms with grouping and no decimal tail', () => {
    expect(formatQuantity('1000.00')).toBe('1.000');
    expect(formatQuantity('12000')).toBe('12.000');
    expect(formatQuantity('0')).toBe('0');
  });

  it('keeps a real decimal digit (never rounds it away)', () => {
    expect(formatQuantity('1000.50')).toBe('1.000,5');
    expect(formatQuantity('12.345')).toBe('12,35');
  });

  it('renders an em dash for empty input and echoes non-numeric strings', () => {
    expect(formatQuantity(null)).toBe('—');
    expect(formatQuantity('')).toBe('—');
    expect(formatQuantity('n/a')).toBe('n/a');
  });
});
