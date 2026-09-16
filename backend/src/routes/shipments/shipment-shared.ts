// Shared helpers for the `routes/shipments/` leaf routers.
//
// Every leaf mounts under `/api/shipments` (see `index.ts`), so these helpers
// stay path-agnostic: id parsing, the idempotent write envelope, and the
// intake mutation role list shared by the core and documents leaves.

import type { Request, Response } from 'express';
import { Role } from '@tingting/shared';
import { getUser } from '../../middleware/auth';
import { ApiError } from '../../errors';
import { runIdempotent } from '../../services/idempotency.service';
import { parseId as sharedParseId } from '../utils/parse-id';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import type { Tx } from '../../services/trip-shared';

// `/shipments/new` is shared by CUS and Điều vận. Keep every mutation used by
// its durable quick-create -> optional root update -> declaration -> containers
// sequence on one authority list so route guards cannot drift apart again.
export const SHIPMENT_INTAKE_MUTATION_ROLES = [
  Role.ADMIN,
  Role.MANAGER,
  Role.CUS,
  Role.DISPATCHER,
] as const;

export interface ShipmentWriteEnvelope<T> {
  body: T;
  status: number;
  auditEntityId: number;
  auditEntityKey?: string;
}

export async function runShipmentWrite<T>(
  req: Request,
  endpoint: string,
  payload: Record<string, unknown>,
  create: (tx: Tx) => Promise<ShipmentWriteEnvelope<T>>,
) {
  const user = getUser(req);
  return runIdempotent({
    endpoint,
    idempotencyKey: getRequestIdempotencyKey(req),
    payload: { actorId: user.userId, ...payload },
    createdBy: user.userId,
    create,
    entityType: 'shipment-write',
    getEntityId: (result) => result.auditEntityId,
    getEntityKey: (result) => result.auditEntityKey,
  });
}

export function sendShipmentWrite<T>(
  res: Response,
  envelope: ShipmentWriteEnvelope<T>,
) {
  res.locals.auditEntityId = envelope.auditEntityId;
  if (envelope.auditEntityKey) res.locals.auditEntityKey = envelope.auditEntityKey;
  return res.status(envelope.status).json(envelope.body);
}

// Parse a non-negative integer id from the route. Returns -1 (and a 400 from
// the caller) on garbage input — never NaN. Centralised so every /:id handler
// is consistent with `routes/trips.ts`.
export function parseId(req: Request, res: Response): number | null {
  // Delegates to the shared helper; the res-style contract (400 + null) is
  // preserved for the call sites that early-return on it.
  try {
    return sharedParseId(req.params.id as string, 'ID lô hàng');
  } catch {
    res.status(400).json({ error: 'ID lô hàng không hợp lệ' });
    return null;
  }
}

export function requireShipmentIdempotencyKey(req: Request, message: string): string {
  const key = getRequestIdempotencyKey(req);
  if (!key) throw new ApiError(400, message);
  return key;
}
