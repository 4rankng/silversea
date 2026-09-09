import { useQuery } from "@tanstack/react-query";
import { tripClient } from "../api/tripClient";
// Re-export the canonical bootstrap response type (defined in the API layer)
// so existing `import { CatalogData } from '../hooks/useCatalogs'` keeps working.
export type { CatalogData } from "../api/tripClient";
import type { CatalogData } from "../api/tripClient";
import { qk } from "../api/keys";

export const BOOTSTRAP_QUERY_KEY = qk.catalogs.all;

export function useCatalogs() {
  return useQuery<CatalogData>({
    queryKey: BOOTSTRAP_QUERY_KEY,
    queryFn: () => tripClient.getBootstrap(),
    staleTime: 5 * 60 * 1000,
    // Catalog staleness guard (2026-09-09 bug class): the app disables
    // refetchOnWindowFocus globally, which made this 5-minute-stale catalog
    // cache live for the whole tab session — a carrier/customer created
    // anywhere never reached open dropdowns (TripReassign, trip forms,
    // expenses) until a full reload. Opt this key back into focus refetch so
    // returning to the tab refreshes stale catalogs, mirroring the CUS
    // drawer and shipment-create revalidation.
    refetchOnWindowFocus: true,
  });
}
