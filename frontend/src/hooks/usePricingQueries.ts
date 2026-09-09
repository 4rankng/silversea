import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  pricingClient,
  type FreightPreviewInput,
  type DebitNoteOverrideRow,
} from '../api/pricingClient';
import { qk } from '../api/keys';

/** Fuel price periods — full history, newest first at render time. */
export function useFuelPricePeriods() {
  return useQuery({
    queryKey: qk.catalogs.fuelPricePeriods,
    queryFn: pricingClient.listFuelPricePeriods,
    staleTime: 5 * 60 * 1000,
  });
}

/** Freight rate terms per customer x route — contract params the engine reads. */
export function useFreightRateTerms() {
  return useQuery({
    queryKey: qk.catalogs.freightRateTerms,
    queryFn: pricingClient.listFreightRateTerms,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Live freight preview. `input` null = not enough data to price yet — the
 * query stays idle. Non-blocking: errors surface as a hidden card, never a
 * blocker for shipment creation (engine resolves MANUAL server-side).
 */
export function useFreightPreview(input: FreightPreviewInput | null) {
  return useQuery({
    queryKey: [
      'freight-preview',
      input?.customerId,
      input?.routeId,
      input?.vehicleSizeClassCode,
      input?.transportDate,
    ] as const,
    queryFn: () => pricingClient.previewFreight(input as FreightPreviewInput),
    enabled: input !== null,
    staleTime: 0,
    retry: false,
  });
}

/** Existing debit-note override on a snapshot; null snapshot id = idle query. */
export function useDebitNoteOverride(snapshotId: number | null) {
  return useQuery({
    queryKey: qk.catalogs.debitNoteOverride(snapshotId),
    queryFn: async () => {
      try {
        return await pricingClient.getDebitNoteOverride(snapshotId as number);
      } catch {
        // 404 (or engine gap): no override exists yet — not an error state.
        return null;
      }
    },
    enabled: snapshotId !== null,
    staleTime: 0,
  });
}

/** Upsert the override; invalidates the snapshot's override read. */
export function useSaveDebitNoteOverride(snapshotId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof pricingClient.saveDebitNoteOverride>[1]) =>
      pricingClient.saveDebitNoteOverride(snapshotId as number, data),
    onSuccess: (row: DebitNoteOverrideRow) => {
      queryClient.setQueryData(
        qk.catalogs.debitNoteOverride(snapshotId),
        row,
      );
    },
  });
}
