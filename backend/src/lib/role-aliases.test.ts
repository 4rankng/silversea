/**
 * Unit Tests for Role Alias Layer
 * Tests for CLERK→CUS and FORWARDER→OPS migration helpers
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalizeRole,
  isLegacyRole,
  getModernRole,
  areRolesEqual,
  getRoleAliasMappings,
  LEGACY_ROLES,
  MODERN_ROLES,
} from './role-aliases';

describe('role-aliases', () => {
  describe('canonicalizeRole', () => {
    it('converts CLERK to CUS', () => {
      expect(canonicalizeRole('CLERK')).toBe('CUS');
    });

    it('converts FORWARDER to OPS', () => {
      expect(canonicalizeRole('FORWARDER')).toBe('OPS');
    });

    it('returns unchanged for modern roles', () => {
      expect(canonicalizeRole('CUS')).toBe('CUS');
      expect(canonicalizeRole('OPS')).toBe('OPS');
    });

    it('returns unchanged for other roles', () => {
      expect(canonicalizeRole('ADMIN')).toBe('ADMIN');
      expect(canonicalizeRole('MANAGER')).toBe('MANAGER');
      expect(canonicalizeRole('ACCOUNTANT')).toBe('ACCOUNTANT');
      expect(canonicalizeRole('DRIVER')).toBe('DRIVER');
      expect(canonicalizeRole('DISPATCHER')).toBe('DISPATCHER');
      expect(canonicalizeRole('CUSTOMER')).toBe('CUSTOMER');
    });

    it('handles unknown roles gracefully', () => {
      expect(canonicalizeRole('UNKNOWN_ROLE')).toBe('UNKNOWN_ROLE');
    });
  });

  describe('isLegacyRole', () => {
    it('returns true for CLERK', () => {
      expect(isLegacyRole('CLERK')).toBe(true);
    });

    it('returns true for FORWARDER', () => {
      expect(isLegacyRole('FORWARDER')).toBe(true);
    });

    it('returns false for modern roles', () => {
      expect(isLegacyRole('CUS')).toBe(false);
      expect(isLegacyRole('OPS')).toBe(false);
    });

    it('returns false for other roles', () => {
      expect(isLegacyRole('ADMIN')).toBe(false);
      expect(isLegacyRole('MANAGER')).toBe(false);
      expect(isLegacyRole('ACCOUNTANT')).toBe(false);
      expect(isLegacyRole('DRIVER')).toBe(false);
    });
  });

  describe('getModernRole', () => {
    it('converts CLERK to CUS', () => {
      expect(getModernRole('CLERK')).toBe('CUS');
    });

    it('converts FORWARDER to OPS', () => {
      expect(getModernRole('FORWARDER')).toBe('OPS');
    });

    it('returns unchanged for non-legacy roles', () => {
      expect(getModernRole('ADMIN')).toBe('ADMIN');
      expect(getModernRole('CUS')).toBe('CUS');
      expect(getModernRole('OPS')).toBe('OPS');
    });
  });

  describe('areRolesEqual', () => {
    it('returns true for CLERK and CUS', () => {
      expect(areRolesEqual('CLERK', 'CUS')).toBe(true);
      expect(areRolesEqual('CUS', 'CLERK')).toBe(true);
    });

    it('returns true for FORWARDER and OPS', () => {
      expect(areRolesEqual('FORWARDER', 'OPS')).toBe(true);
      expect(areRolesEqual('OPS', 'FORWARDER')).toBe(true);
    });

    it('returns false for different roles', () => {
      expect(areRolesEqual('ADMIN', 'MANAGER')).toBe(false);
      expect(areRolesEqual('CLERK', 'FORWARDER')).toBe(false);
    });

    it('returns true for identical roles', () => {
      expect(areRolesEqual('ADMIN', 'ADMIN')).toBe(true);
      expect(areRolesEqual('CLERK', 'CLERK')).toBe(true);
    });
  });

  describe('getRoleAliasMappings', () => {
    it('returns CLERK→CUS mapping', () => {
      const mappings = getRoleAliasMappings();
      expect(mappings).toContainEqual({ legacy: 'CLERK', modern: 'CUS' });
    });

    it('returns FORWARDER→OPS mapping', () => {
      const mappings = getRoleAliasMappings();
      expect(mappings).toContainEqual({ legacy: 'FORWARDER', modern: 'OPS' });
    });

    it('returns exactly 2 mappings', () => {
      expect(getRoleAliasMappings()).toHaveLength(2);
    });
  });

  describe('LEGACY_ROLES constant', () => {
    it('contains CLERK', () => {
      expect(LEGACY_ROLES.has('CLERK')).toBe(true);
    });

    it('contains FORWARDER', () => {
      expect(LEGACY_ROLES.has('FORWARDER')).toBe(true);
    });

    it('does not contain modern roles', () => {
      expect(LEGACY_ROLES.has('CUS')).toBe(false);
      expect(LEGACY_ROLES.has('OPS')).toBe(false);
    });
  });

  describe('MODERN_ROLES constant', () => {
    it('contains CUS', () => {
      expect(MODERN_ROLES.has('CUS')).toBe(true);
    });

    it('contains OPS', () => {
      expect(MODERN_ROLES.has('OPS')).toBe(true);
    });

    it('does not contain legacy roles', () => {
      expect(MODERN_ROLES.has('CLERK')).toBe(false);
      expect(MODERN_ROLES.has('FORWARDER')).toBe(false);
    });
  });
});