/**
 * `ListFilterBar` — the former name of the FilterBar band.
 *
 * Since card 20260930_229 the band and the filter law it owns (the measured
 * two-row budget, the `Bộ lọc` fold) live in `design-system/FilterBar.tsx`;
 * this module is a compat alias. Card 20260930_238 migrated every surface to
 * the band's barrel import EXCEPT ONE: `pages/ShipmentsPage.tsx` stays here
 * because its test file pins the alias by name and belongs to another session
 * (standing do-not-touch). When that pin migrates, delete this alias and
 * rename the two `.css` sheets it documents in the same sweep.
 */
export { FilterBar as ListFilterBar } from '../design-system/FilterBar';
export type {
  FilterBarProps as ListFilterBarProps,
  FilterBarSearchProps as ListFilterBarSearchProps,
  FilterBarColumns as ListFilterBarColumns,
} from '../design-system/FilterBar';
