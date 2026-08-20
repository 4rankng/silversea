import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import * as s from '../../db/schema';

export async function attachAcceptedTripCloseEvidence(input: {
  tripId: number;
  tripVersion: number;
  customerId: number;
  submittedBy: number;
  reviewedBy: number;
}) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId: input.customerId,
    status: 'IN_TRANSIT',
    cargoMode: 'LCL',
  }).returning();
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
  }).returning();
  await db.update(s.trips).set({
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
  }).where(eq(s.trips.id, input.tripId));
  await db.insert(s.tripPodSubmissions).values({
    tripId: input.tripId,
    fulfillmentId: fulfillment.id,
    submissionVersion: 1,
    sourceTripVersion: input.tripVersion,
    status: 'ACCEPTED',
    submittedBy: input.submittedBy,
    submittedAt: new Date(),
    reviewedBy: input.reviewedBy,
    reviewedAt: new Date(),
  });
  await db.insert(s.tripExpenseCompletionScopes).values({
    tripId: input.tripId,
    tripContainerId: null,
    status: 'COMPLETED',
    completedBy: input.reviewedBy,
    completedAt: new Date(),
  });
  const containers = await db.select({ id: s.tripContainers.id })
    .from(s.tripContainers)
    .where(eq(s.tripContainers.tripId, input.tripId));
  if (containers.length > 0) {
    await db.insert(s.tripExpenseCompletionScopes).values(containers.map((container) => ({
      tripId: input.tripId,
      tripContainerId: container.id,
      status: 'COMPLETED' as const,
      completedBy: input.reviewedBy,
      completedAt: new Date(),
    })));
  }
  return { shipmentId: shipment.id, fulfillmentId: fulfillment.id };
}

export async function cleanupTripCloseMilestones(tripIds: number[]) {
  if (tripIds.length === 0) return;
  const milestones = await db.select({ id: s.shipmentMilestones.id })
    .from(s.shipmentMilestones)
    .where(inArray(s.shipmentMilestones.tripId, tripIds));
  if (milestones.length > 0) {
    await db.delete(s.customerVisibleEvents)
      .where(inArray(s.customerVisibleEvents.milestoneId, milestones.map((row) => row.id)));
  }
  await db.delete(s.shipmentMilestones).where(inArray(s.shipmentMilestones.tripId, tripIds));
}

export async function cleanupTripCloseShipments(shipmentIds: number[]) {
  if (shipmentIds.length === 0) return;
  await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
}
