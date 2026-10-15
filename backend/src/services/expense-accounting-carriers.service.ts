import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db, type Executor } from '../db';
import * as s from '../db/schema';
import { isCarrierSupplier } from './supplier-carrier-link.service';

export interface ExpenseCarrierOption { id: number; name: string; routeName: string | null }

/**
 * Nhà xe cho ô "Nhà cung cấp" của khoản chi (card 20261005 — tự điền nhà xe
 * đang chạy tuyến). A carrier is a CARRIER-typed supplier (`isCarrierSupplier`,
 * the one classifier every "Chọn nhà xe" path shares); `routeName` is the route
 * of that carrier's most recent run — reached directly through the trip's
 * external carrier entity or indirectly through a truck owned by the carrier's
 * linked customer. The drawer matches this route name against the row it is
 * opening and auto-selects the carrier; no match leaves the field empty for a
 * manual pick.
 */
export async function listExpenseCarriers(executor: Executor = db): Promise<ExpenseCarrierOption[]> {
  const suppliers = await executor.select({ id: s.suppliers.id, name: s.suppliers.name, types: s.suppliers.types })
    .from(s.suppliers).where(and(eq(s.suppliers.status, 'ACTIVE'), isNull(s.suppliers.deletedAt)));
  const carriers = suppliers.filter(row => isCarrierSupplier(row.types));
  if (!carriers.length) return [];
  const carrierIds = carriers.map(row => row.id);
  const [direct, viaTrucks] = await Promise.all([
    executor.select({ supplierId: s.tripsComposite.externalEntityId, routeName: s.routes.name, departureDate: s.tripsComposite.departureDate })
      .from(s.tripsComposite).leftJoin(s.routes, eq(s.routes.id, s.tripsComposite.routeId))
      .where(and(isNull(s.tripsComposite.deletedAt), eq(s.tripsComposite.externalEntityType, 'SUPPLIER'),
        inArray(s.tripsComposite.externalEntityId, carrierIds)))
      .orderBy(desc(s.tripsComposite.departureDate)),
    executor.select({ supplierId: s.customers.linkedSupplierId, routeName: s.routes.name, departureDate: s.tripsComposite.departureDate })
      .from(s.trucks)
      .innerJoin(s.customers, eq(s.customers.id, s.trucks.carrierId))
      .innerJoin(s.tripsComposite, eq(s.tripsComposite.truckId, s.trucks.id))
      .leftJoin(s.routes, eq(s.routes.id, s.tripsComposite.routeId))
      .where(and(isNull(s.trucks.deletedAt), isNull(s.tripsComposite.deletedAt), inArray(s.customers.linkedSupplierId, carrierIds)))
      .orderBy(desc(s.tripsComposite.departureDate)),
  ]);
  // Newest run wins per carrier, whichever link reached it.
  const runs = [...direct, ...viaTrucks].sort((a, b) => String(b.departureDate).localeCompare(String(a.departureDate)));
  const routeBySupplier = new Map<number, string | null>();
  for (const run of runs) {
    if (run.supplierId == null || routeBySupplier.has(run.supplierId)) continue;
    routeBySupplier.set(run.supplierId, run.routeName?.trim() || null);
  }
  return carriers.map(row => ({ id: row.id, name: row.name, routeName: routeBySupplier.get(row.id) ?? null }));
}
