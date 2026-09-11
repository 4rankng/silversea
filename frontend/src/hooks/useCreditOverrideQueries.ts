import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreditOverrideListFilters, CreateCreditOverrideRequestInput } from '../api/creditOverrideClient';
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
