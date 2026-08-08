/**
 * Role Alias Layer for CLERK→CUS and FORWARDER→OPS Migration
 *
 * This module provides backward compatibility functions during the role migration period.
 * It allows the system to handle both legacy role names (CLERK, FORWARDER) and new names (CUS, OPS).
 *
 * @migration-period: 2024-08 - TBD (30 days after full deployment)
 * @deprecated: This module will be removed after migration period completes
 */

/**
 * Role alias mapping for migration period
 * Maps legacy role names to their modern equivalents
 */
const ROLE_ALIASES: Readonly<Record<string, string>> = {
  'CLERK': 'CUS',
  'FORWARDER': 'OPS',
  'CUS': 'CUS', // Self-mapping for canonical form
  'OPS': 'OPS', // Self-mapping for canonical form
} as const;

/**
 * Legacy role names that should be migrated
 */
export const LEGACY_ROLES = new Set(['CLERK', 'FORWARDER']);

/**
 * Modern role names (post-migration)
 */
export const MODERN_ROLES = new Set(['CUS', 'OPS']);

/**
 * Convert any role string to its canonical modern form
 *
 * @example
 * canonicalizeRole('CLERK') // returns 'CUS'
 * canonicalizeRole('FORWARDER') // returns 'OPS'
 * canonicalizeRole('ADMIN') // returns 'ADMIN' (no change)
 */
export function canonicalizeRole(role: string): string {
  return ROLE_ALIASES[role] || role;
}

/**
 * Check if a role is a legacy name that needs migration
 *
 * @example
 * isLegacyRole('CLERK') // true
 * isLegacyRole('CUS') // false
 * isLegacyRole('ADMIN') // false
 */
export function isLegacyRole(role: string): boolean {
  return role === 'CLERK' || role === 'FORWARDER';
}

/**
 * Get the modern role name for a given role
 * Returns the same value if it's already modern or unknown
 *
 * @example
 * getModernRole('CLERK') // returns 'CUS'
 * getModernRole('FORWARDER') // returns 'OPS'
 * getModernRole('ADMIN') // returns 'ADMIN'
 */
export function getModernRole(role: string): string {
  if (role === 'CLERK') return 'CUS';
  if (role === 'FORWARDER') return 'OPS';
  return role;
}

/**
 * Check if two role strings represent the same role (accounting for aliases)
 *
 * @example
 * areRolesEqual('CLERK', 'CUS') // true
 * areRolesEqual('FORWARDER', 'OPS') // true
 * areRolesEqual('ADMIN', 'MANAGER') // false
 */
export function areRolesEqual(role1: string, role2: string): boolean {
  return canonicalizeRole(role1) === canonicalizeRole(role2);
}

/**
 * Get all alias pairs for logging/debugging
 */
export function getRoleAliasMappings(): ReadonlyArray<{ legacy: string; modern: string }> {
  return [
    { legacy: 'CLERK', modern: 'CUS' },
    { legacy: 'FORWARDER', modern: 'OPS' },
  ];
}