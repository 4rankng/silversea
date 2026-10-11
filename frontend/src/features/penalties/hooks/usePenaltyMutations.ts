import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { qk } from '../../../api/keys';
import { FINANCIAL } from '@tingting/shared';
import type { CreatePenaltyRequest } from '@tingting/shared';
import { useToast } from '../../../components/shared/Toast';

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
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (body: CreatePenaltyRequest) => {
      return api.post('/penalties', body);
    },
    onSuccess: async () => {
      // Success feedback at commit (case 2026-10-11-R14-06 / card 101026163020
      // law): a slow or rejecting cache refresh must never swallow the
      // feedback of a write that already persisted.
      toast({ kind: 'success', message: 'Đã lập biên bản kỷ luật.' });
      await invalidatePenaltyReads(queryClient);
    },
  });
}

export function useCancelPenalty() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason?: string }) => {
      return api.post(FINANCIAL.PENALTY_CANCEL(id), { reason });
    },
    onSuccess: async () => {
      toast({ kind: 'success', message: 'Đã hủy biên bản kỷ luật.' });
      await invalidatePenaltyReads(queryClient);
    },
  });
}
