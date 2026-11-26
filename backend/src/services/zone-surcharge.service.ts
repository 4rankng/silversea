// Zone-surcharge source ladder (card _2, payee ruling (i)): dispatcher
// override > driver incidental actuals > port config > null. Lives in its
// own module so the lock service and the debit-detail producer can both use
// it without an import cycle.
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { sumExcludingNegative } from '@tingting/shared';
import { db } from '../db';
import { liveDebitOpsExpense } from './live-debit-expense-scope';
import * as s from '../db/schema';

export const ZONE_SURCHARGE_KIND = 'zone_lift_drop_surcharge';
export const ZONE_SURCHARGE_EXPENSE_TYPE = 'ZONE_SURCHARGE';

export async function resolveLotZoneSurcharge(
  shipmentId: number,
): Promise<{ label: string; amount: number; source: 'OVERRIDE' | 'INCIDENTAL' | 'CONFIG' } | null> {
  const lotContainers = await db.select({ pickupPortId: s.shipmentContainers.pickupPortId, dropoffPortId: s.shipmentContainers.dropoffPortId })
    .from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, shipmentId));
  const portIds = [...new Set(lotContainers
    .flatMap((container) => [container.pickupPortId, container.dropoffPortId])
    .filter((value): value is number => value != null))];
  // The display label comes from CONFIG whenever one exists for the lot's
  // ports (place names are data). Structural fallback otherwise.
  const configRows = portIds.length > 0 ? await db.select({ portId: s.portZoneSurcharges.portId, label: s.portZoneSurcharges.label, amount: s.portZoneSurcharges.amount })
    .from(s.portZoneSurcharges)
    .where(and(inArray(s.portZoneSurcharges.portId, portIds), isNull(s.portZoneSurcharges.deletedAt))) : [];
  const configLabel = configRows[0]?.label ?? 'Phí nâng/hạ theo vùng';
  const overrideRows = await db.select({ amount: s.opsExpenseEntries.amount })
    .from(s.opsExpenseEntries)
    .where(and(
      eq(s.opsExpenseEntries.shipmentId, shipmentId),
      eq(s.opsExpenseEntries.expenseTypeCode, ZONE_SURCHARGE_EXPENSE_TYPE),
      liveDebitOpsExpense(),
    ));
  // Card 20260928_197 — an Ops cost row may now be NEGATIVE, and the PM rule
  // is "a negative row must leave the result exactly as if it did not exist".
  // The ladder's population test is a question about ROWS, so it uses the same
  // keep-rule as the money below: a rung holding only negative rows is EMPTY
  // and falls through to the next rung instead of publishing a known 0.
  const countedOverride = overrideRows.filter((row) => Number(row.amount) >= 0);
  if (countedOverride.length > 0) {
    const total = sumExcludingNegative(overrideRows, (row) => row.amount);
    return { label: configLabel, amount: total, source: 'OVERRIDE' };
  }
  const lotTrips = await db.select({ id: s.trips.id })
    .from(s.trips)
    .where(eq(s.trips.shipmentId, shipmentId));
  // Card 2026-10-05_373: a cost the accountant REJECTED (từ chối) is voided on
  // its accounting source, and must stop justifying a zone surcharge exactly as
  // it stops counting toward the road-fee total. The OVERRIDE rung above is
  // already status-aware via liveDebitOpsExpense(), so leaving this rung
  // unfiltered would let a rejected lift/drop keep its surcharge. The join is a
  // LEFT join and the null branch is kept, so a legacy cost with no accounting
  // source still counts (same rule as getPhoiPhieuTienDuong).
  const incidentalRows = await db.select({ amount: s.driverIncidentalCosts.amount })
    .from(s.driverIncidentalCosts)
    .leftJoin(s.expenseAccountingSources, and(
      eq(s.expenseAccountingSources.sourceKind, 'DRIVER'),
      eq(s.expenseAccountingSources.sourceId, s.driverIncidentalCosts.id),
    ))
    .where(and(
      inArray(s.driverIncidentalCosts.tripId, lotTrips.length > 0 ? lotTrips.map((trip) => trip.id) : [0]),
      eq(s.driverIncidentalCosts.costType, 'LIFT_DROP_ZONE'),
      or(isNull(s.expenseAccountingSources.id), ne(s.expenseAccountingSources.status, 'VOIDED')),
    ));
  // Same rule as the OVERRIDE rung above: only negative rows = an empty rung.
  const countedIncidental = incidentalRows.filter((row) => Number(row.amount) >= 0);
  if (countedIncidental.length > 0) {
    const total = sumExcludingNegative(incidentalRows, (row) => row.amount);
    return { label: configLabel, amount: total, source: 'INCIDENTAL' };
  }
  if (configRows.length > 0) {
    // Card 20260922_63: the fee is PER LIFT — each container end (nâng at the
    // pickup port, hạ at the dropoff port) at a fee-configured port counts
    // once. Config rows are per-port data, so their presence IS the fee-zone
    // membership; ports and amounts never enter this logic by name.
    const amountByPort = new Map<number, number>();
    for (const row of configRows) amountByPort.set(row.portId, Number(row.amount));
    let lifts = 0;
    let amount = 0;
    for (const container of lotContainers) {
      for (const endPortId of [container.pickupPortId, container.dropoffPortId]) {
        const perLift = endPortId != null ? amountByPort.get(endPortId) : undefined;
        if (perLift != null) {
          lifts += 1;
          amount += perLift;
        }
      }
    }
    if (lifts === 0) return null;
    return { label: configLabel, amount, source: 'CONFIG' };
  }
  return null;
}
