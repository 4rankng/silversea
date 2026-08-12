/**
 * Unit Tests for Role Alias Layer
 * Tests for CLERK→CUS and FORWARDER→OPS migration helpers
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
      assert.equal(canonicalizeRole('CLERK'), 'CUS');
    });

    it('converts FORWARDER to OPS', () => {
      assert.equal(canonicalizeRole('FORWARDER'), 'OPS');
    });

    it('returns unchanged for modern roles', () => {
      assert.equal(canonicalizeRole('CUS'), 'CUS');
      assert.equal(canonicalizeRole('OPS'), 'OPS');
    });

    it('returns unchanged for other roles', () => {
      assert.equal(canonicalizeRole('ADMIN'), 'ADMIN');
      assert.equal(canonicalizeRole('MANAGER'), 'MANAGER');
      assert.equal(canonicalizeRole('ACCOUNTANT'), 'ACCOUNTANT');
      assert.equal(canonicalizeRole('DRIVER'), 'DRIVER');
      assert.equal(canonicalizeRole('DISPATCHER'), 'DISPATCHER');
      assert.equal(canonicalizeRole('CUSTOMER'), 'CUSTOMER');
    });

    it('handles unknown roles gracefully', () => {
      assert.equal(canonicalizeRole('UNKNOWN_ROLE'), 'UNKNOWN_ROLE');
    });
  });

  describe('isLegacyRole', () => {
    it('returns true for CLERK', () => {
      assert.equal(isLegacyRole('CLERK'), true);
    });

    it('returns true for FORWARDER', () => {
      assert.equal(isLegacyRole('FORWARDER'), true);
    });

    it('returns false for modern roles', () => {
      assert.equal(isLegacyRole('CUS'), false);
      assert.equal(isLegacyRole('OPS'), false);
    });

    it('returns false for other roles', () => {
      assert.equal(isLegacyRole('ADMIN'), false);
      assert.equal(isLegacyRole('MANAGER'), false);
      assert.equal(isLegacyRole('ACCOUNTANT'), false);
      assert.equal(isLegacyRole('DRIVER'), false);
    });
  });

  describe('getModernRole', () => {
    it('converts CLERK to CUS', () => {
      assert.equal(getModernRole('CLERK'), 'CUS');
    });

    it('converts FORWARDER to OPS', () => {
      assert.equal(getModernRole('FORWARDER'), 'OPS');
    });

    it('returns unchanged for non-legacy roles', () => {
      assert.equal(getModernRole('ADMIN'), 'ADMIN');
      assert.equal(getModernRole('CUS'), 'CUS');
      assert.equal(getModernRole('OPS'), 'OPS');
    });
  });

  describe('areRolesEqual', () => {
    it('returns true for CLERK and CUS', () => {
      assert.equal(areRolesEqual('CLERK', 'CUS'), true);
      assert.equal(areRolesEqual('CUS', 'CLERK'), true);
    });

    it('returns true for FORWARDER and OPS', () => {
      assert.equal(areRolesEqual('FORWARDER', 'OPS'), true);
      assert.equal(areRolesEqual('OPS', 'FORWARDER'), true);
    });

    it('returns false for different roles', () => {
      assert.equal(areRolesEqual('ADMIN', 'MANAGER'), false);
      assert.equal(areRolesEqual('CLERK', 'FORWARDER'), false);
    });

    it('returns true for identical roles', () => {
      assert.equal(areRolesEqual('ADMIN', 'ADMIN'), true);
      assert.equal(areRolesEqual('CLERK', 'CLERK'), true);
    });
  });

  describe('getRoleAliasMappings', () => {
    it('returns CLERK→CUS mapping', () => {
      const mappings = getRoleAliasMappings();
      assert.ok(mappings.some((mapping) => mapping.legacy === 'CLERK' && mapping.modern === 'CUS'));
    });

    it('returns FORWARDER→OPS mapping', () => {
      const mappings = getRoleAliasMappings();
      assert.ok(mappings.some((mapping) => mapping.legacy === 'FORWARDER' && mapping.modern === 'OPS'));
    });

    it('returns exactly 2 mappings', () => {
      assert.equal(getRoleAliasMappings().length, 2);
    });
  });

  describe('LEGACY_ROLES constant', () => {
    it('contains CLERK', () => {
      assert.equal(LEGACY_ROLES.has('CLERK'), true);
    });

    it('contains FORWARDER', () => {
      assert.equal(LEGACY_ROLES.has('FORWARDER'), true);
    });

    it('does not contain modern roles', () => {
      assert.equal(LEGACY_ROLES.has('CUS'), false);
      assert.equal(LEGACY_ROLES.has('OPS'), false);
    });
  });

  describe('MODERN_ROLES constant', () => {
    it('contains CUS', () => {
      assert.equal(MODERN_ROLES.has('CUS'), true);
    });

    it('contains OPS', () => {
      assert.equal(MODERN_ROLES.has('OPS'), true);
    });

    it('does not contain legacy roles', () => {
      assert.equal(MODERN_ROLES.has('CLERK'), false);
      assert.equal(MODERN_ROLES.has('FORWARDER'), false);
    });
  });
});
