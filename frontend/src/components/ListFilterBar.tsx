/**
 * `ListFilterBar` — the former name of the FilterBar band.
 *
 * Since card 20260930_229 the band and the filter law it owns (the measured
 * two-row budget, the `Bộ lọc` fold) live in `design-system/FilterBar.tsx`;
 * this module is a compat alias for the surfaces the staged cutover has not
 * reached yet. It renders the SAME component with the SAME DOM — existing
 * consumers keep composing their own `FilterDropdown` as a child and keep
 * working on the same measured mode context. New surfaces should import
 * `FilterBar` from the design-system barrel and hand their foldable criteria
 * to the band's `fold` slot instead of mounting the trigger themselves.
 */
export { FilterBar as ListFilterBar } from '../design-system/FilterBar';
export type {
  FilterBarProps as ListFilterBarProps,
  FilterBarSearchProps as ListFilterBarSearchProps,
  FilterBarColumns as ListFilterBarColumns,
} from '../design-system/FilterBar';
