import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tireClient, type TireWritePayload } from '../api/tireClient';
import { qk } from '../api/keys';
import type { Tire } from '@tingting/shared';

/** All non-deleted tires; callers filter client-side by truckId / trailerId. */
export function useTires() {
  return useQuery<Tire[]>({
    queryKey: qk.catalogs.tiresAll,
    queryFn: () => tireClient.list(),
    staleTime: 60 * 1000,
  });
}

function useInvalidateTires() {
  const queryClient = useQueryClient();
  return () => {
    // Invalidate the broad 'tires' prefix so every per-vehicle view + the
    // unfiltered stock list refetch. Routed through qk so a key rename can't
    // silently break invalidation. (code-review MEDIUM)
    queryClient.invalidateQueries({ queryKey: qk.catalogs.tiresAll });
  };
}

export function useCreateTire() {
  const invalidate = useInvalidateTires();
  return useMutation({
    mutationFn: (data: TireWritePayload) => tireClient.create(data),
    onSuccess: invalidate,
  });
}

export function useUpdateTire() {
  const invalidate = useInvalidateTires();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: TireWritePayload }) =>
      tireClient.update(id, data),
    onSuccess: invalidate,
  });
}

export function useDeleteTire() {
  const invalidate = useInvalidateTires();
  return useMutation({
    mutationFn: (id: number) => tireClient.delete(id),
    onSuccess: invalidate,
  });
}

export function useInstallTire() {
  const invalidate = useInvalidateTires();
  return useMutation({
    mutationFn: (args: { id: number; updatedAt: string; truckId?: number | null; trailerId?: number | null; position?: string | null }) =>
      tireClient.install(args.id, {
        truckId: args.truckId ?? null,
        trailerId: args.trailerId ?? null,
        position: args.position ?? null,
      }, args.updatedAt),
    onSuccess: invalidate,
  });
}

/** Move a mounted tire to another vehicle (atomic; preserves install date). */
export function useTransferTire() {
  const invalidate = useInvalidateTires();
  return useMutation({
    mutationFn: (args: { id: number; updatedAt: string; truckId?: number | null; trailerId?: number | null; position?: string | null }) =>
      tireClient.transfer(args.id, {
        truckId: args.truckId ?? null,
        trailerId: args.trailerId ?? null,
        position: args.position ?? null,
      }, args.updatedAt),
    onSuccess: invalidate,
  });
}

/** Remove a tire from its vehicle → IN_STOCK (spare). */
export function useRemoveTire() {
  const invalidate = useInvalidateTires();
  return useMutation({
    mutationFn: ({ id, updatedAt }: { id: number; updatedAt: string }) =>
      tireClient.remove(id, updatedAt),
    onSuccess: invalidate,
  });
}

/** Dispose of (thanh lý) a tire with a reason → DISPOSED. */
export function useDisposeTire() {
  const invalidate = useInvalidateTires();
  return useMutation({
    mutationFn: ({ id, reason, updatedAt }: { id: number; reason: string; updatedAt: string }) =>
      tireClient.dispose(id, reason, updatedAt),
    onSuccess: invalidate,
  });
}
