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
  });
}
