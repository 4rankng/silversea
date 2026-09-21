import { describe, expect, it } from 'vitest';
import { Role, ROLE_LABELS } from '@tingting/shared';
import { ROLE_PILL } from '../features/users/utils';

// Card 20260921_25: one business name per role, everywhere. The registry is
// the single source; the users filter pills must match it, and no internal
// role code may surface as a label.
describe('role label parity (card 20260921_25)', () => {
  it('never exposes an internal role code as the registry label', () => {
    for (const role of Object.values(Role)) {
      const label = ROLE_LABELS[role];
      expect(label, `label for ${role} must not be the bare code`).not.toBe(role);
    }
  });
  it('keeps the users filter pills in lockstep with the registry', () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_PILL[role].label).toBe(ROLE_LABELS[role]);
    }
  });
  it('labels the CUS role with the business name used by the nav', () => {
    expect(ROLE_LABELS[Role.CUS]).toBe('Chứng từ');
  });
});
