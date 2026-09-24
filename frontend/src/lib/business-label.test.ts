import { describe, expect, it } from 'vitest';
import { businessName } from './business-label';

describe('businessName strips seed id suffixes (case QA-2026-09-24-01)', () => {
  it('drops the trailing epoch-ms seed suffix from customer, route and driver names', () => {
    expect(businessName('ADC P 1790089547534-zcain7')).toBe('ADC P');
    expect(businessName('ADC route P 1790089547534-zcain7')).toBe('ADC route P');
    expect(businessName('C16 customer 1790049643236-195l16-69')).toBe('C16 customer');
    expect(businessName('card6 driver 1790004852053-9kzgw8-26')).toBe('card6 driver');
  });
  it('leaves ordinary business names untouched', () => {
    expect(businessName('SITC')).toBe('SITC');
    expect(businessName('Khách A')).toBe('Khách A');
    expect(businessName('ADC route W1')).toBe('ADC route W1');
    expect(businessName('29K-123.45')).toBe('29K-123.45');
  });
  it('collapses null/empty to empty so the cell falls back to its dash placeholder', () => {
    expect(businessName(null)).toBe('');
    expect(businessName('')).toBe('');
    expect(businessName(undefined)).toBe('');
  });
});
