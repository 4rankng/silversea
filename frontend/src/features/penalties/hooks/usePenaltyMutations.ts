import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { qk } from '../../../api/keys';
import { FINANCIAL } from '@tingting/shared';
import type { CreatePenaltyRequest } from '@tingting/shared';

async function invalidatePenaltyReads(queryClient: QueryClient) {
  // ['penalties'] prefix-covers the paginated list cache; the insights base
  // is invalidated explicitly so KPI/scoreboard reads always refetch.
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.penalties.list }),
    queryClient.invalidateQueries({ queryKey: qk.penalties.insightsBase }),
  ]);
}

export function useCreatePenalty() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreatePenaltyRequest) => {
      return api.post('/penalties', body);
    },
    onSuccess: async () => {
      await invalidatePenaltyReads(queryClient);
    },
  });
}

export function useCancelPenalty() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason?: string }) => {
      return api.post(FINANCIAL.PENALTY_CANCEL(id), { reason });
    },
    onSuccess: async () => {
      await invalidatePenaltyReads(queryClient);
    },
  });
}
