import { api } from '../lib/api';
import { TIRES } from '@tingting/shared';
import type { Tire, PaginatedResponse } from '@tingting/shared';

/** Editable tire fields shared by create + update payloads. */
export type TireWritePayload = Partial<{
  serial: string;
  truckId: number | null;
  trailerId: number | null;
  position: string | null;
  size: string | null;
  installedAt: string | null;
  removedAt: string | null;
  supplierId: number | null;
  cost: number;
  purchasedAt: string | null;
  disposalDate: string | null;
  disposalReason: string | null;
  status: Tire['status'];
}>;

/**
 * N1 — Tire API client. CRUD hits the generic `/fleet/tires` router; install,
 * remove, and dispose hit the dedicated lifecycle endpoints.
 *
 * list returns all non-deleted tires; the page filters client-side by truckId
 * or trailerId (the catalog is small — one fleet's worth).
 */
export const tireClient = {
  list: async (): Promise<Tire[]> => {
    const res = await api.get<PaginatedResponse<Tire>>(`${TIRES.LIST}?limit=1000`);
    return res.items ?? [];
  },

  create: (data: TireWritePayload) => api.post<Tire>(TIRES.LIST, data),

  update: (id: number, data: TireWritePayload) => api.put<Tire>(TIRES.DETAIL(id), data),

  delete: (id: number) => api.delete<{ ok: boolean }>(TIRES.DETAIL(id)),

  install: (
    id: number,
    target: { truckId?: number | null; trailerId?: number | null; position?: string | null },
    expectedUpdatedAt: string,
  ) =>
    api.post<Tire>(TIRES.INSTALL(id), {
      truckId: target.truckId ?? null,
      trailerId: target.trailerId ?? null,
      position: target.position ?? null,
    }, { expectedUpdatedAt }),

  /** Move a mounted tire to another vehicle (atomic; preserves install date). */
  transfer: (
    id: number,
    target: { truckId?: number | null; trailerId?: number | null; position?: string | null },
    expectedUpdatedAt: string,
  ) =>
    api.post<Tire>(TIRES.TRANSFER(id), {
      truckId: target.truckId ?? null,
      trailerId: target.trailerId ?? null,
      position: target.position ?? null,
    }, { expectedUpdatedAt }),

  /** Remove a tire from its vehicle back to the spare pool (IN_STOCK). */
  remove: (id: number, expectedUpdatedAt: string) =>
    api.post<Tire>(TIRES.REMOVE(id), {}, { expectedUpdatedAt }),

  /** Dispose of (thanh lý) a tire with a reason. */
  dispose: (id: number, reason: string, expectedUpdatedAt: string) =>
    api.post<Tire>(TIRES.DISPOSE(id), { reason }, { expectedUpdatedAt }),
};
