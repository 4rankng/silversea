import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { quotationClient, type QuotationFrame } from '../api/quotationClient';
import { qk } from '../api/keys';
import type { QuotationCreateInput, QuotationUpdateInput } from '@tingting/shared';

/** Quotation frames — the Báo giá screen's list (no cells; grid per detail). */
export function useQuotations() {
  return useQuery({
    queryKey: qk.catalogs.quotations,
    queryFn: quotationClient.list,
    staleTime: 60 * 1000,
  });
}

/** One quotation's live grid (per-route cells, computed server-side). */
export function useQuotation(id: number | null) {
  return useQuery({
    queryKey: qk.catalogs.quotation(id ?? 0),
    queryFn: () => quotationClient.get(id!),
    enabled: id != null,
    staleTime: 60 * 1000,
  });
}

export function useCreateQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: QuotationCreateInput) => quotationClient.create(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.catalogs.quotations }),
  });
}

export function useUpdateQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: QuotationUpdateInput }) => quotationClient.update(id, body),
    // Both the frame list and the open grid refetch (heSo changed).
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: qk.catalogs.quotations });
      queryClient.invalidateQueries({ queryKey: qk.catalogs.quotation(variables.id) });
    },
  });
}

export type { QuotationFrame };
