import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreditOverrideListFilters,
  CreateCreditOverrideRequestInput,
  RejectCreditOverrideRequestInput,
} from '../api/creditOverrideClient';
import { creditOverrideClient } from '../api/creditOverrideClient';
import { qk } from '../api/keys';

export function useCreditOverrideQueue(filters: CreditOverrideListFilters, enabled = true) {
  return useQuery({
    queryKey: qk.creditOverrides.list(filters),
    queryFn: () => creditOverrideClient.listRequests(filters),
    enabled,
    staleTime: 15_000,
    retry: false,
  });
}

export function useCreditOverrideRequest(id: number | null, enabled = true) {
  return useQuery({
    queryKey: qk.creditOverrides.detail(id),
    queryFn: () => creditOverrideClient.getRequest(id as number),
    enabled: enabled && id != null,
    staleTime: 15_000,
    retry: false,
  });
}

export function useCreateCreditOverrideRequest(filtersToRefresh: CreditOverrideListFilters[] = []) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCreditOverrideRequestInput) => creditOverrideClient.createRequest(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.creditOverrides.all });
      for (const filters of filtersToRefresh) {
        queryClient.invalidateQueries({ queryKey: qk.creditOverrides.list(filters) });
      }
    },
  });
}

export function useApproveCreditOverrideRequest(filtersToRefresh: CreditOverrideListFilters[] = []) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: number; expectedVersion: number }) =>
      creditOverrideClient.approveRequest(id, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.creditOverrides.all });
      for (const filters of filtersToRefresh) {
        queryClient.invalidateQueries({ queryKey: qk.creditOverrides.list(filters) });
      }
    },
  });
}

export function useCheckCreditOverrideRequest(filtersToRefresh: CreditOverrideListFilters[] = []) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: number; expectedVersion: number }) =>
      creditOverrideClient.checkRequest(id, expectedVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.creditOverrides.all });
      for (const filters of filtersToRefresh) {
        queryClient.invalidateQueries({ queryKey: qk.creditOverrides.list(filters) });
      }
    },
  });
}

export function useRejectCreditOverrideRequest(filtersToRefresh: CreditOverrideListFilters[] = []) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: RejectCreditOverrideRequestInput }) =>
      creditOverrideClient.rejectRequest(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.creditOverrides.all });
      for (const filters of filtersToRefresh) {
        queryClient.invalidateQueries({ queryKey: qk.creditOverrides.list(filters) });
      }
    },
  });
}
