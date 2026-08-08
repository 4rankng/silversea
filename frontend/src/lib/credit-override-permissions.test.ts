import { describe, expect, it } from 'vitest';
import { Role } from '@tingting/shared';
import { canDecideCreditOverride } from './credit-override-permissions';

describe('canDecideCreditOverride', () => {
  it('matches the backend tier authority exactly', () => {
    expect(canDecideCreditOverride(Role.ADMIN, 'FINANCE_TIER_1')).toBe(true);
    expect(canDecideCreditOverride(Role.ADMIN, 'DIRECTOR')).toBe(true);
    expect(canDecideCreditOverride(Role.ACCOUNTANT, 'FINANCE_TIER_1')).toBe(true);
    expect(canDecideCreditOverride(Role.ACCOUNTANT, 'DIRECTOR')).toBe(false);
    expect(canDecideCreditOverride(Role.MANAGER, 'FINANCE_TIER_1')).toBe(false);
    expect(canDecideCreditOverride(Role.MANAGER, 'DIRECTOR')).toBe(true);
    expect(canDecideCreditOverride(Role.CUS, 'FINANCE_TIER_1')).toBe(false);
    expect(canDecideCreditOverride(Role.CUSTOMER, 'DIRECTOR')).toBe(false);
  });
});
