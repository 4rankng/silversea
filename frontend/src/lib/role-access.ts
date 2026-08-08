import { Role } from '@tingting/shared';

export function canReadShipmentRoutes(role: string | undefined): boolean {
  return role === Role.ADMIN
    || role === Role.MANAGER
    || role === Role.ACCOUNTANT
    || role === Role.CUS // formerly CLERK
    || role === Role.DISPATCHER;
}
