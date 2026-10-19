/**
 * Shared facet picker types for dispatch planning filters (master plan and
 * detailed plan). Lives in a leaf module so DetailedPlanFilters and
 * DetailedPlanFacetMultiSelect can both depend on it without forming an
 * import cycle.
 */
export interface FacetItem {
  id: number;
  name: string;
}

export type FacetLoader = (q?: string) => Promise<FacetItem[]>;
