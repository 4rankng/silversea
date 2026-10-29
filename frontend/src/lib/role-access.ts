import { Role } from '@tingting/shared';

export function canReadShipmentRoutes(role: string | undefined): boolean {
  return role === Role.ADMIN
    || role === Role.MANAGER
    || role === Role.ACCOUNTANT
    || role === Role.CUS // formerly CLERK
    || role === Role.DISPATCHER
    // Ticket 141026230710 (2026-10-17, spec T3): mọi Ops khai chi phí mọi lô —
    // /shipments mở view cho Ops (backend: `p, OPS, shipments, read`).
    || role === Role.OPS;
}

/** Match the settlement API: managers read summaries; editors open and issue debit details. */
export function canManageShipmentDebit(role: string | undefined): boolean {
  return role === Role.ADMIN || role === Role.ACCOUNTANT || role === Role.CUS;
}

/**
 * SIL-592 (id 692) — the staff close for external-carrier trips
 * (`POST /trips/:id/complete-external`) is allowlisted server-side in
 * `backend/src/middleware/authz-grants.ts` to exactly these roles; the CUS
 * surfaces hide the "Hoàn thành" action for everyone else.
 */
export function canCloseExternalTrips(role: string | undefined): boolean {
  return role === Role.ADMIN || role === Role.MANAGER || role === Role.DISPATCHER || role === Role.CUS;
}

export function canReadShipmentDebitRoutes(role: string | undefined): boolean {
  return canManageShipmentDebit(role) || role === Role.MANAGER;
}
