import { Role } from '@tingting/shared';

export function canReadShipmentRoutes(role: string | undefined): boolean {
  return role === Role.ADMIN
    || role === Role.MANAGER
    || role === Role.ACCOUNTANT
    || role === Role.CUS // formerly CLERK
    || role === Role.DISPATCHER;
}

/** Match the settlement API: managers read summaries; editors open and issue debit details. */
export function canManageShipmentDebit(role: string | undefined): boolean {
  return role === Role.ADMIN || role === Role.ACCOUNTANT || role === Role.CUS;
}

export function canReadShipmentDebitRoutes(role: string | undefined): boolean {
  return canManageShipmentDebit(role) || role === Role.MANAGER;
}
