import { describe, expect, it } from 'vitest';
import { Role } from '@tingting/shared';
import { canReadShipmentRoutes } from './role-access';

describe('shipment route role access', () => {
  it('admits Dispatcher to the list/detail routes advertised in navigation', () => {
    expect(canReadShipmentRoutes(Role.DISPATCHER)).toBe(true);
  });

  it('keeps portal-only roles outside office shipment routes', () => {
    expect(canReadShipmentRoutes(Role.DRIVER)).toBe(false);
    expect(canReadShipmentRoutes(Role.OPS)).toBe(false);
    expect(canReadShipmentRoutes(Role.CUSTOMER)).toBe(false);
  });
});
