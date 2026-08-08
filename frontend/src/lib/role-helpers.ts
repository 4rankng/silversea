/**
 * Role Helper Functions for CLERK→CUS and FORWARDER→OPS Migration
 *
 * This module provides frontend-specific role utilities during the migration period.
 * It handles display logic and role validation for UI components.
 *
 * @migration-period: 2024-08 - TBD (30 days after full deployment)
 */

import { Role } from '@tingting/shared';

/**
 * Get display label for a role during transition period
 * Shows transitional labels like "CUS (Nhân viên CSKH)" for legacy roles
 *
 * @example
 * getDisplayRole('CLERK') // returns 'CUS (Nhân viên CSKH)'
 * getDisplayRole('CUS') // returns 'CUS'
 * getDisplayRole('ADMIN') // returns 'ADMIN'
 */
export function getDisplayRole(role: string): string {
  switch (role) {
    case 'CLERK':
      return 'CUS (Nhân viên CSKH)';
    case 'FORWARDER':
      return 'OPS (Nhân viên vận hành)';
    default:
      return role;
  }
}

/**
 * Check if a role is a modern name (post-migration)
 *
 * @example
 * isModernRole('CUS') // true
 * isModernRole('CLERK') // false
 * isModernRole('ADMIN') // true
 */
export function isModernRole(role: Role | string): boolean {
  return !['CLERK', 'FORWARDER'].includes(role.toString());
}

/**
 * Check if a role is a legacy name (pre-migration)
 *
 * @example
 * isLegacyRole('CLERK') // true
 * isLegacyRole('CUS') // false
 */
export function isLegacyRole(role: Role | string): boolean {
  return ['CLERK', 'FORWARDER'].includes(role.toString());
}

/**
 * Get the modern equivalent of a role
 *
 * @example
 * getModernRole(Role.CUS) // returns 'CUS'
 * getModernRole(Role.OPS) // returns 'OPS'
 * getModernRole(Role.ADMIN) // returns 'ADMIN'
 */
export function getModernRole(role: Role | string): string {
  switch (String(role)) {
    case 'CLERK':
      return Role.CUS;
    case 'FORWARDER':
      return Role.OPS;
    default:
      return String(role);
  }
}

/**
 * Role categories for UI grouping
 */
export const ROLE_CATEGORIES = {
  MANAGEMENT: [Role.ADMIN, Role.MANAGER],
  FINANCIAL: [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT],
  OPERATIONS: [Role.DISPATCHER, Role.OPS],
  DOCUMENTATION: [Role.CUS],
  FIELD: [Role.DRIVER],
  PORTAL: [Role.CUSTOMER],
} as const;

/**
 * Check if role belongs to a specific category
 */
export function isRoleInCategory(role: Role, category: keyof typeof ROLE_CATEGORIES): boolean {
  const roles = ROLE_CATEGORIES[category];
  return roles ? (roles as readonly Role[]).includes(role) : false;
}
