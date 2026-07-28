import { Role } from '@tingting/shared';
import type { CreditOverrideTier } from '../api/creditOverrideClient';

export function canCheckCreditOverride(role: string | null | undefined): boolean {
  return role === Role.ADMIN || role === Role.MANAGER || role === Role.ACCOUNTANT;
}

export function canDecideCreditOverride(
  role: string | null | undefined,
  requiredTier: CreditOverrideTier,
): boolean {
  if (role === Role.ADMIN) return true;
  if (requiredTier === 'FINANCE_TIER_1') return role === Role.ACCOUNTANT;
  return role === Role.MANAGER;
}
