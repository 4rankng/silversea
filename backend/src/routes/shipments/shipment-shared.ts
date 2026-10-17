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

/**
 * Field-specific advice for the create channels — the mistake is common enough
 * (the create form's own field ids are not the API's field names) that the
 * generic "unsupported field" list is not enough.
 */
const UNKNOWN_SHIPMENT_KEY_HINTS: Record<string, string> = {
  containers: 'Tạo lô hàng không nhận kèm danh sách container — tạo lô rồi dùng PUT /api/shipments/{id}/containers để khai báo container.',
};

/**
 * Reject body keys the create schema would silently strip (zod's default), so a
 * caller never believes a field landed while the row stays empty. An unknown
 * key holding an EMPTY array carries no data and stays accepted — the
 * create-workspace sends `containers: []` on the container-less path.
 *
 * `allowed` is the endpoint's accepted key list (`CREATE_SHIPMENT_KEYS` /
 * `QUICK_CREATE_SHIPMENT_KEYS`), so the contract cannot drift from the schema.
 */
export function assertKnownShipmentKeys(body: unknown, allowed: readonly string[], scope: string): void {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return;
  const unknown = Object.keys(body as Record<string, unknown>).filter((key) => {
    if (allowed.includes(key)) return false;
    const value = (body as Record<string, unknown>)[key];
    return !(Array.isArray(value) && value.length === 0);
  });
  if (unknown.length === 0) return;
  const hint = unknown.map((key) => UNKNOWN_SHIPMENT_KEY_HINTS[key]).find(Boolean);
  throw new ApiError(400, hint ?? `Trường không được hỗ trợ khi ${scope}: ${unknown.join(', ')}.`);
}
