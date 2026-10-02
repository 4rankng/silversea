/**
 * QA fixture: seed a complete freight-snapshot lot for the debit-detail
 * re-rung (20260918_18 REWORK B). Creates a QA-tagged lot with container
 * rows, a completed trip, the pricing chain (terms/norm/period/pricing
 * table) and a freight snapshot — everything GET /debit-detail renders.
 *
 * Run ONLY against the shared dev DB while holding the exclusive 5441
 * window (coordinate via LEAD; QA holds the mốc tables):
 *
 *   DATABASE_URL='postgres://postgres:postgres@localhost:5441/silversea' \
 *     npx tsx scripts/seed-qa-debit-freight.ts [shipmentId]
 *
 * With no argument a new lot is created; with a shipmentId the pricing
 * chain + snapshot attach to THAT lot (its first fulfillment/trip is reused,
 * created when missing). Prints the seeded ids at the end.
 */
import { and, eq } from 'drizzle-orm';
import { client, db } from '../src/db';
import * as s from '../src/db/schema';
import { resolveFreightRate, persistFreightRateSnapshot } from '../src/services/freight-pricing-engine.service';

const suffix = `QA-DEBIT-${Date.now()}`;
const now = new Date();
const isoDate = now.toISOString().slice(0, 10);

async function ensureCustomer() {
  const [existing] = await db.select({ id: s.customers.id })
    .from(s.customers).where(eq(s.customers.name, 'LONG MINH')).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(s.customers)
    .values({ name: `QA debit customer ${suffix}` }).returning({ id: s.customers.id });
  return created.id;
}

async function ensureRoute() {
  const [existing] = await db.select({ id: s.routes.id })
    .from(s.routes).where(eq(s.routes.name, 'Cát Lái - Nhơn Trạch')).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(s.routes)
    .values({ name: `QA debit route ${suffix}` }).returning({ id: s.routes.id });
  return created.id;
}

async function ensureClass() {
  const [existing] = await db.select({ id: s.vehicleSizeClasses.id, code: s.vehicleSizeClasses.code })
    .from(s.vehicleSizeClasses).where(eq(s.vehicleSizeClasses.code, '15T')).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(s.vehicleSizeClasses)
    .values({ code: '15T', name: 'Xe tải 15 tấn' }).returning();
  return created;
}

async function ensureContainerType() {
  const [existing] = await db.select({ id: s.containerTypes.id })
    .from(s.containerTypes).where(eq(s.containerTypes.code, '40HC')).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(s.containerTypes)
    .values({ code: '40HC', name: "40'HC" }).returning({ id: s.containerTypes.id });
  return created.id;
}

async function main() {
  const argShipmentId = Number(process.argv[2] ?? '') || null;
  let shipmentId = argShipmentId;
  let customerId: number;
  let routeId: number;
  let fulfillmentId: number;
  let tripId: number;

  if (shipmentId != null) {
    const [shipment] = await db.select({ id: s.shipments.id, customerId: s.shipments.customerId, routeId: s.shipments.routeId })
      .from(s.shipments).where(eq(s.shipments.id, shipmentId)).limit(1);
    if (!shipment) throw new Error(`shipment ${shipmentId} not found`);
    customerId = shipment.customerId;
    routeId = shipment.routeId;
    const [fulfillment] = await db.select({ id: s.shipmentFulfillments.id })
      .from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.shipmentId, shipmentId)).limit(1);
    fulfillmentId = fulfillment?.id ?? 0;
    const [trip] = await db.select({ id: s.trips.id })
      .from(s.trips).where(eq(s.trips.fulfillmentId, fulfillmentId)).limit(1);
    tripId = trip?.id ?? 0;
    if (!fulfillmentId || !tripId) throw new Error('target shipment lacks fulfillment/trip — seed a fresh lot instead');
    console.log(`attaching to shipment ${shipmentId} (fulfillment ${fulfillmentId}, trip ${tripId})`);
  } else {
    customerId = await ensureCustomer();
    routeId = await ensureRoute();
    const [shipment] = await db.insert(s.shipments).values({
      customerId,
      routeId,
      blNumber: `QA-DEBIT-${suffix}`,
      status: 'READY_FOR_DISPATCH',
      // EDD is required for the lot to appear in L1's delivery-date filter
      // and for the appointment write to pass its stage validation.
      expectedDeliveryDate: isoDate,
    }).returning({ id: s.shipments.id });
    shipmentId = shipment.id;
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      sourceShipmentVersion: 1,
    }).returning({ id: s.shipmentFulfillments.id });
    fulfillmentId = fulfillment.id;
    const [trip] = await db.insert(s.trips).values({
      fulfillmentId,
      customerId,
      routeId,
      departureDate: isoDate,
      status: 'COMPLETED',
    }).returning({ id: s.trips.id });
    tripId = trip.id;
    const containerTypeId = await ensureContainerType();
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId,
      containerNumber: `QATU${String(shipmentId).padStart(7, '0')}`,
      containerTypeId,
    }).returning({ id: s.shipmentContainers.id });
    // FULL linkage: sourceShipmentContainerId is what the appointment write
    // validates — without it the trip↔container↔shipment chain 409s.
    await db.insert(s.tripContainers).values({
      tripId,
      sourceShipmentId: shipmentId,
      sourceShipmentContainerId: container.id,
      containerNumber: `QATU${String(shipmentId).padStart(7, '0')}`,
    });
  }

  const vehicleClass = await ensureClass();

  // Pricing chain — check-first idempotent: re-runs reuse existing rows
  // instead of duplicating mốc tables on the shared dev DB.
  const existingTerms = await db.select({ id: s.freightRateTerms.id })
    .from(s.freightRateTerms)
    .where(and(
      eq(s.freightRateTerms.customerId, customerId),
      eq(s.freightRateTerms.routeId, routeId),
      eq(s.freightRateTerms.effectiveDate, isoDate),
    )).limit(1);
  const terms = existingTerms[0] ?? await db.insert(s.freightRateTerms).values({
    customerId,
    routeId,
    sharePct: '2.00',
    billingKmOneWay: 100,
    baseFuelPrice: '17842.5926',
    fuelLagDays: 1,
    fuelLagConfirmed: true,
    surchargeThresholdMode: 'NONE',
  }).returning({ id: s.freightRateTerms.id }).then((rows) => rows[0]);
  const existingNorm = await db.select({ id: s.fuelConsumptionNorms.id })
    .from(s.fuelConsumptionNorms)
    .where(eq(s.fuelConsumptionNorms.vehicleSizeClassId, vehicleClass.id)).limit(1);
  const norm = existingNorm[0] ?? await db.insert(s.fuelConsumptionNorms).values({
    vehicleSizeClassId: vehicleClass.id,
    litersPerKm: '0.35',
  }).returning({ id: s.fuelConsumptionNorms.id }).then((rows) => rows[0]);
  const existingPeriod = await db.select({ id: s.fuelPricePeriods.id })
    .from(s.fuelPricePeriods)
    .where(eq(s.fuelPricePeriods.effectiveFrom, isoDate)).limit(1);
  const period = existingPeriod[0] ?? await db.insert(s.fuelPricePeriods).values({
    unitPrice: '20000',
    effectiveFrom: isoDate,
  }).returning({ id: s.fuelPricePeriods.id }).then((rows) => rows[0]);
  const existingPricing = await db.select({ id: s.pricingTables.id })
    .from(s.pricingTables)
    .where(and(
      eq(s.pricingTables.customerId, customerId),
      eq(s.pricingTables.routeId, routeId),
      eq(s.pricingTables.rateKey, vehicleClass.code),
      eq(s.pricingTables.effectiveDate, isoDate),
    )).limit(1);
  const pricing = existingPricing[0] ?? await db.insert(s.pricingTables).values({
    customerId,
    routeId,
    rateKey: vehicleClass.code,
    price: '6000000',
  }).returning({ id: s.pricingTables.id }).then((rows) => rows[0]);

  const resolved = await resolveFreightRate({
    customerId,
    routeId,
    vehicleSizeClassCode: vehicleClass.code,
    transportDate: isoDate,
  });
  const snapshotId = await persistFreightRateSnapshot(resolved, { shipmentId, tripId });

  console.log(JSON.stringify({
    shipmentId,
    tripId,
    termsId: terms.id,
    normId: norm.id,
    periodId: period.id,
    pricingTableId: pricing.id,
    snapshotId,
    resolvedSource: resolved.source,
    formula: resolved.formula,
  }, null, 2));

  await client.end({ timeout: 1 });
}

main().catch(async (error) => {
  console.error(error);
  await client.end({ timeout: 1 }).catch(() => {});
  process.exit(1);
});
