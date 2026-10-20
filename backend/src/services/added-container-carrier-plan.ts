/**
 * Card 201026124500 (181026185900 A.1) — the added container's Nhà xe copy,
 * one owner for both consumers that must never drift:
 *
 *   1. the container-add flow (`addCusShipmentContainer`), which must stamp a
 *      carrier plan onto the NEW fulfillment exactly like the lot's existing
 *      rows carry one — the round-2 verify-fail root cause: the add path
 *      copied Tuyến/Nâng/Hạ (container columns) but the carrier plan lives on
 *      the FULFILLMENT, so every added row arrived carrier-less ("Nhà xe
 *      trống") no matter how full the sibling rows were;
 *   2. the wire's provided pair (shipmentCusContainerAddSchema carrierType /
 *      externalCarrierId), which wins over the inherited plan when present.
 *
 * The A.1 copy set excludes Biển số/xe — plannedVehiclePlateNumber and
 * plannedExternalCarrierVehicleId are NOT part of this plan and stay entry
 * fields on the new row. Pure data, no database handle, so unit tests can pin
 * the resolution order.
 */
export type PlannedCarrierRow = {
  plannedCarrierType: string | null;
  plannedExternalCarrierId: number | null;
};

export type ProvidedCarrier = {
  carrierType: 'OWN' | 'EXTERNAL' | null;
  externalCarrierId: number | null;
};

export type ResolvedCarrierPlan =
  | { plannedCarrierType: 'OWN'; plannedExternalCarrierId: null }
  | { plannedCarrierType: 'EXTERNAL'; plannedExternalCarrierId: number };

/** A carrier plan is ONE atomic fact: OWN carries no carrier id, EXTERNAL is
 *  meaningless without one. Incoherent halves never resolve to a plan — the
 *  same strictness the add wire's superRefine applies to the provided pair. */
function normalizePlan(row: PlannedCarrierRow): ResolvedCarrierPlan | null {
  if (row.plannedCarrierType === 'OWN' && row.plannedExternalCarrierId == null) {
    return { plannedCarrierType: 'OWN', plannedExternalCarrierId: null };
  }
  if (row.plannedCarrierType === 'EXTERNAL' && row.plannedExternalCarrierId != null) {
    return { plannedCarrierType: 'EXTERNAL', plannedExternalCarrierId: row.plannedExternalCarrierId };
  }
  return null;
}

/**
 * Resolve the added row's carrier plan.
 *
 * - `provided !== undefined`: the wire's explicit value — EXPLICIT NULL is a
 *   deliberate carrier-less row (never re-inherited), OWN/EXTERNAL is the
 *   operator's pick (the same "UNDEFINED = lot default rides / EXPLICIT NULL
 *   = deliberate clear" contract the add wire's column fields follow).
 * - `provided === undefined`: the lot's default rides — first coherent plan
 *   of the sibling fulfillments in id order, the same per-column FIRST
 *   non-null rule the container-column inherit applies.
 */
export function resolveAddedContainerCarrierPlan(
  provided: ProvidedCarrier | undefined,
  siblingPlans: Iterable<PlannedCarrierRow>,
): ResolvedCarrierPlan | null {
  if (provided !== undefined) {
    return normalizePlan({
      plannedCarrierType: provided.carrierType,
      plannedExternalCarrierId: provided.externalCarrierId,
    });
  }
  for (const row of siblingPlans) {
    const plan = normalizePlan(row);
    if (plan != null) return plan;
  }
  return null;
}
