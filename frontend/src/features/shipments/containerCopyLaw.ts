// SIL-717 (id 837) / SIL-180 (card gốc `221026173728-cus-them-cont-copy-tru-so-loai`)
// — THE owner of the "thêm container copy trừ 2 trường" law.
//
// The customer's rule, verbatim: "khi thêm dòng container mới, tự động copy toàn
// bộ nội dung dòng trên liền kề, TRỪ thông tin số cont và loại cont".
//
// WHY THIS FILE EXISTS (one pattern, one shared implementation — AGENTS.md §3):
// the rule has been implemented on more than one surface, and SIL-488 had to
// be opened to re-apply the same reversal to a second copy. This module is the
// ONE owner of the three parts that must never drift:
//
//   1. the two excluded per-container identifiers (Số container, Loại cont);
//   2. the copied field set;
//   3. "the row DIRECTLY ABOVE the new one" — the sheet's LAST row.
//
// THE SIBLING SURFACES, AND WHAT EACH ONE DOES TODAY (recorded here so the
// next lane knows the exact state — each file belongs to another lane in
// flight, so this lane does not touch them):
//
//   - the create workspace (`features/shipments/create/shipment-create-model.ts`
//     — `createContainerFromPrevious`): copies the WHOLE row minus the two
//     identifiers. Its field set is a SUPERSET of `CONTAINER_ADD_COPY_KEYS`
//     (it also carries the free-text route/port/factory names).
//   - the dispatch container drawer
//     (`features/dispatch/master-plan/DispatchContainerDetailDrawer.tsx` —
//     `AddContainerLineForm`): posts ONLY {expectedShipmentVersion,
//     containerNumber}. It copies NOTHING — and because the wire leaves the
//     type undefined, the SERVER re-copies the lot's loại cont onto the new
//     row. The customer's SIL-180 rule is therefore NOT honoured there yet.
//
// Both must DELEGATE here when their lane next touches them. The CUS Tổng quan
// drawer (SIL-717) already reads the law from this module.

/** The two per-container identifiers the rule NEVER copies. */
export const CONTAINER_ADD_EXCLUDED_FIELDS = ['containerNumber', 'containerTypeId'] as const;

/** A row of the fields a container line carries. */
export interface ContainerAddRow {
  containerNumber: string | null;
  containerTypeId: string | null;
  cargoWeightKg: string | null;
  cargoVolumeCbm: string | null;
  routeId: number | null;
  operationalSiteId: number | null;
  liftSiteId: number | null;
  dropoffSiteId: number | null;
  customerAppointmentAt: string | null;
}

/**
 * The fields a new container row inherits from the row directly above it.
 *
 * `cargoWeightKg` / `cargoVolumeCbm` ride because the server never inherits
 * cargo metrics (they stay per-container facts); the rest ride because the
 * FE mirrors the row above instead of letting the server pick the lot's
 * oldest non-null sibling (an explicit null is a deliberate clear on the
 * server — see `cus-shipment-workspace-writes.service.ts`).
 */
/**
 * The copied field set — every field of the row EXCEPT the two identifiers.
 * The type makes the exclusion STRUCTURAL: a key of the excluded pair cannot
 * be listed here without a compile error.
 */
export const CONTAINER_ADD_COPY_KEYS: readonly (Exclude<
  keyof ContainerAddRow,
  (typeof CONTAINER_ADD_EXCLUDED_FIELDS)[number]
>)[] = [
  'cargoWeightKg',
  'cargoVolumeCbm',
  'routeId',
  'operationalSiteId',
  'liftSiteId',
  'dropoffSiteId',
  'customerAppointmentAt',
];

export type ContainerAddCopyKey = (typeof CONTAINER_ADD_COPY_KEYS)[number];

/** The copied field set — the shape every "thêm container" surface writes. */
export interface ContainerAddCopy {
  cargoWeightKg: string | null;
  cargoVolumeCbm: string | null;
  routeId: number | null;
  operationalSiteId: number | null;
  liftSiteId: number | null;
  dropoffSiteId: number | null;
  customerAppointmentAt: string | null;
}

/** An empty copy — the seed of a lot whose sheet has no row above yet. */
export const EMPTY_CONTAINER_ADD_COPY: ContainerAddCopy = {
  cargoWeightKg: null,
  cargoVolumeCbm: null,
  routeId: null,
  operationalSiteId: null,
  liftSiteId: null,
  dropoffSiteId: null,
  customerAppointmentAt: null,
};

/**
 * The row DIRECTLY ABOVE the new one — the sheet's LAST row. A new row is
 * appended at the end of the sheet, so "dòng trên" is the last existing row.
 *
 * One resolution, shared by the copy seed AND the wire body, so the caption
 * the operator reads can never name a different row than the one that is
 * copied.
 */
export function containerAddSource<T>(containers: readonly T[] | null | undefined): T | null {
  if (!containers || containers.length === 0) return null;
  return containers[containers.length - 1] ?? null;
}

/**
 * The copy of the row above — the named fields, and nothing else. The two
 * per-container identifiers cannot ride: `CONTAINER_ADD_COPY_KEYS` excludes
 * them at the type level, so a surface cannot re-introduce the
 * copy-everything regression.
 */
export function containerAddCopy(
  source: Partial<ContainerAddRow> | null | undefined,
): ContainerAddCopy {
  if (!source) return { ...EMPTY_CONTAINER_ADD_COPY };
  const copy: Record<string, unknown> = {};
  for (const key of CONTAINER_ADD_COPY_KEYS) {
    copy[key] = source[key] ?? null;
  }
  return copy as unknown as ContainerAddCopy;
}
