import { Role } from '@tingting/shared';

export function canReadShipmentRoutes(role: string | undefined): boolean {
  return role === Role.ADMIN
    || role === Role.MANAGER
    || role === Role.ACCOUNTANT
    || role === Role.CLERK
    || role === Role.DISPATCHER;
}
