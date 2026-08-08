/**
 * Unit Tests for Frontend Role Helpers
 * Tests for CLERK→CUS and FORWARDER→OPS migration helpers
 */

import { describe, it, expect } from 'vitest';
import { Role } from '@tingting/shared';
import {
  getDisplayRole,
  isModernRole,
  isLegacyRole as isLegacyRoleFrontend,
  getModernRole,
  isRoleInCategory,
  ROLE_CATEGORIES,
} from './role-helpers';

describe('role-helpers', () => {
  describe('getDisplayRole', () => {
    it('shows transitional label for CLERK', () => {
      expect(getDisplayRole('CLERK')).toBe('CUS (Nhân viên CSKH)');
    });

    it('shows transitional label for FORWARDER', () => {
      expect(getDisplayRole('FORWARDER')).toBe('OPS (Nhân viên vận hành)');
    });

    it('returns clean label for modern CUS', () => {
      expect(getDisplayRole('CUS')).toBe('CUS');
    });

    it('returns clean label for modern OPS', () => {
      expect(getDisplayRole('OPS')).toBe('OPS');
    });

    it('returns unchanged for other roles', () => {
      expect(getDisplayRole('ADMIN')).toBe('ADMIN');
      expect(getDisplayRole('MANAGER')).toBe('MANAGER');
      expect(getDisplayRole('ACCOUNTANT')).toBe('ACCOUNTANT');
    });
  });

  describe('isModernRole', () => {
    it('returns false for legacy CLERK string', () => {
      expect(isModernRole('CLERK')).toBe(false);
    });

    it('returns false for legacy FORWARDER string', () => {
      expect(isModernRole('FORWARDER')).toBe(false);
    });

    it('returns true for modern roles', () => {
      expect(isModernRole(Role.ADMIN)).toBe(true);
      expect(isModernRole(Role.MANAGER)).toBe(true);
      expect(isModernRole(Role.ACCOUNTANT)).toBe(true);
      expect(isModernRole(Role.DRIVER)).toBe(true);
      expect(isModernRole(Role.DISPATCHER)).toBe(true);
      expect(isModernRole(Role.CUSTOMER)).toBe(true);
      expect(isModernRole(Role.CUS)).toBe(true);
      expect(isModernRole(Role.OPS)).toBe(true);
    });

    it('handles string input', () => {
      expect(isModernRole('ADMIN')).toBe(true);
      expect(isModernRole('CLERK')).toBe(false);
    });
  });

  describe('isLegacyRole', () => {
    it('returns true for CLERK string', () => {
      expect(isLegacyRoleFrontend('CLERK')).toBe(true);
    });

    it('returns true for FORWARDER string', () => {
      expect(isLegacyRoleFrontend('FORWARDER')).toBe(true);
    });

    it('returns false for modern roles', () => {
      expect(isLegacyRoleFrontend(Role.ADMIN)).toBe(false);
      expect(isLegacyRoleFrontend(Role.MANAGER)).toBe(false);
      expect(isLegacyRoleFrontend(Role.CUSTOMER)).toBe(false);
      expect(isLegacyRoleFrontend(Role.CUS)).toBe(false);
      expect(isLegacyRoleFrontend(Role.OPS)).toBe(false);
    });
  });

  describe('getModernRole', () => {
    it('converts CUS enum to CUS string', () => {
      expect(getModernRole(Role.CUS)).toBe('CUS');
    });

    it('converts OPS enum to OPS string', () => {
      expect(getModernRole(Role.OPS)).toBe('OPS');
    });

    it('returns string value for other roles', () => {
      expect(getModernRole(Role.ADMIN)).toBe('ADMIN');
      expect(getModernRole(Role.MANAGER)).toBe('MANAGER');
      expect(getModernRole(Role.DRIVER)).toBe('DRIVER');
    });
  });

  describe('ROLE_CATEGORIES', () => {
    it('has MANAGEMENT category with ADMIN and MANAGER', () => {
      expect(ROLE_CATEGORIES.MANAGEMENT).toContainEqual(Role.ADMIN);
      expect(ROLE_CATEGORIES.MANAGEMENT).toContainEqual(Role.MANAGER);
      expect(ROLE_CATEGORIES.MANAGEMENT).toHaveLength(2);
    });

    it('has FINANCIAL category with ADMIN, MANAGER, ACCOUNTANT', () => {
      expect(ROLE_CATEGORIES.FINANCIAL).toContainEqual(Role.ADMIN);
      expect(ROLE_CATEGORIES.FINANCIAL).toContainEqual(Role.MANAGER);
      expect(ROLE_CATEGORIES.FINANCIAL).toContainEqual(Role.ACCOUNTANT);
      expect(ROLE_CATEGORIES.FINANCIAL).toHaveLength(3);
    });

    it('has OPERATIONS category with DISPATCHER and OPS', () => {
      expect(ROLE_CATEGORIES.OPERATIONS).toContainEqual(Role.DISPATCHER);
      expect(ROLE_CATEGORIES.OPERATIONS).toContainEqual(Role.OPS);
      expect(ROLE_CATEGORIES.OPERATIONS).toHaveLength(2);
    });

    it('has DOCUMENTATION category with CUS', () => {
      expect(ROLE_CATEGORIES.DOCUMENTATION).toContainEqual(Role.CUS);
      expect(ROLE_CATEGORIES.DOCUMENTATION).toHaveLength(1);
    });

    it('has FIELD category with DRIVER', () => {
      expect(ROLE_CATEGORIES.FIELD).toContainEqual(Role.DRIVER);
      expect(ROLE_CATEGORIES.FIELD).toHaveLength(1);
    });

    it('has PORTAL category with CUSTOMER', () => {
      expect(ROLE_CATEGORIES.PORTAL).toContainEqual(Role.CUSTOMER);
      expect(ROLE_CATEGORIES.PORTAL).toHaveLength(1);
    });
  });

  describe('isRoleInCategory', () => {
    it('returns true for ADMIN in MANAGEMENT', () => {
      expect(isRoleInCategory(Role.ADMIN, 'MANAGEMENT')).toBe(true);
    });

    it('returns true for ACCOUNTANT in FINANCIAL', () => {
      expect(isRoleInCategory(Role.ACCOUNTANT, 'FINANCIAL')).toBe(true);
    });

    it('returns false for DRIVER in FINANCIAL', () => {
      expect(isRoleInCategory(Role.DRIVER, 'FINANCIAL')).toBe(false);
    });

    it('returns false for invalid category', () => {
      // @ts-expect-error - testing invalid category
      expect(isRoleInCategory(Role.ADMIN, 'INVALID')).toBe(false);
    });
  });
});