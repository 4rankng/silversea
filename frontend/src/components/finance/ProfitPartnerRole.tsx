import { TruckCapRole, TRUCK_CAP_ROLE_LABELS } from '@tingting/shared';

/** B2 — render a partner-role tag. Driver-contributors get a distinct "Lái xe"
 * label so investors and drivers are visually distinguishable in the per-truck
 * breakdown and distribution tables. Returns null for the default investor
 * role so legacy investor-only views stay uncluttered. */
export function RoleTag({ role }: { role?: TruckCapRole | string | null }) {
  if (!role || role === TruckCapRole.INVESTOR) return null;
  const label = TRUCK_CAP_ROLE_LABELS[TruckCapRole.DRIVER];
  return <span className="profit-role-tag">{label}</span>;
}
