import { describe, expect, it } from 'vitest';
import { Role } from '@tingting/shared';
import { canManageShipmentDebit, canReadShipmentDebitRoutes, canReadShipmentRoutes } from './role-access';

describe('shipment route role access', () => {
  it('admits Dispatcher to the list/detail routes advertised in navigation', () => {
    expect(canReadShipmentRoutes(Role.DISPATCHER)).toBe(true);
  });

  it('keeps portal-only roles outside office shipment routes', () => {
    expect(canReadShipmentRoutes(Role.DRIVER)).toBe(false);
    expect(canReadShipmentRoutes(Role.OPS)).toBe(false);
    expect(canReadShipmentRoutes(Role.CUSTOMER)).toBe(false);
  });

  it('matches settlement summary and detail permissions without granting dispatcher access', () => {
    for (const role of [Role.ADMIN, Role.ACCOUNTANT, Role.CUS]) {
      expect(canReadShipmentDebitRoutes(role)).toBe(true);
      expect(canManageShipmentDebit(role)).toBe(true);
    }
    expect(canReadShipmentDebitRoutes(Role.MANAGER)).toBe(true);
    expect(canManageShipmentDebit(Role.MANAGER)).toBe(false);
    for (const role of [Role.DISPATCHER, Role.DRIVER, Role.OPS, Role.CUSTOMER, undefined]) {
      expect(canReadShipmentDebitRoutes(role)).toBe(false);
      expect(canManageShipmentDebit(role)).toBe(false);
    }
  });
});
