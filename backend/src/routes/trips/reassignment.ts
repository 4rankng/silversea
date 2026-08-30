/**
 * Dispatch reassignment for issued orders (dispatcher pre-departure
 * correction). Handler body moved verbatim from routes/trips.ts; the two
 * guard reads go through trip-lifecycle-ops so this leaf never touches the
 * db client directly (arch-layering route->db boundary).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role } from '@tingting/shared';
import { ApiError } from '../../errors';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import * as tripService from '../../services/trip.service';
import { reassignIssuedDispatchWriteCommand } from '../../services/dispatch-planning.service';
import { loadReassignmentGuardContext, loadFulfillmentVersion } from '../../services/trip-lifecycle-ops.service';
import { getRequestIdempotencyKey } from '../utils/idempotency';

const router = Router();

// Reassign truck/driver (only for CREATED trips). Dispatchers own this
// pre-departure correction after an order has been issued.
router.patch('/:id/reassign', requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const data = req.body;
  if (data.expectedVersion !== undefined
      && (!Number.isInteger(data.expectedVersion) || data.expectedVersion <= 0)) {
    return res.status(400).json({ error: 'Phiên bản chuyến đi không hợp lệ' });
  }
  if (data.carrierType === 'OWN' && (!data.truckId || !data.driverId)) {
    return res.status(400).json({ error: 'truckId và driverId là bắt buộc cho xe nhà' });
  }
  if (data.carrierType === 'EXTERNAL' && (!data.externalCarrierId && !data.externalPlateNumber)) {
    return res.status(400).json({ error: 'Vui lòng chọn đối tác xe ngoài hoặc nhập biển số' });
  }
  const trip = await loadReassignmentGuardContext(id);
  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
  if (trip.shipmentId == null || trip.fulfillmentId == null || !trip.plannedStartAt || !trip.plannedEndAt) {
    if (getUser(req).role === Role.DISPATCHER) {
      throw new ApiError(409, 'Chỉ có thể phân xe lại từ Điều phối cho lệnh gắn với tác vụ điều xe.');
    }
    const reassigned = await tripService.reassignTrip(id, data);
    return res.json(reassigned);
  }
  if (data.expectedVersion === undefined) {
    throw new ApiError(400, 'Phiên bản chuyến đi là bắt buộc khi phân xe lại.');
  }
  const fulfillmentVersion = await loadFulfillmentVersion(trip.fulfillmentId as number);
  // Field-reported bug: a late-issued trip can carry a fulfillmentId that no
  // longer resolves (legacy migration, manual data fix, or a fulfillment that
  // was re-decomposed out of existence). The reassign button is only shown
  // for trips in CREATED status, so falling back to the simple
  // tripService.reassignTrip is safe for every role — it just updates the
  // trip's vehicle/driver pair, and the next dispatch issuance can re-link
  // a fresh fulfillment if the operator wants the full governed flow.
  if (fulfillmentVersion == null) {
    const reassigned = await tripService.reassignTrip(id, data);
    return res.json(reassigned);
  }
  const user = getUser(req);
  const outcome = await reassignIssuedDispatchWriteCommand({
    shipmentId: trip.shipmentId,
    fulfillmentId: trip.fulfillmentId,
    expectedVersion: fulfillmentVersion,
    expectedTripVersion: data.expectedVersion,
    plannedStartAt: trip.plannedStartAt.toISOString(),
    plannedEndAt: trip.plannedEndAt.toISOString(),
    endTimeConfirmed: true,
    carrierType: data.carrierType ?? 'OWN',
    truckId: data.truckId ?? null,
    driverId: data.driverId ?? null,
    externalCarrierId: data.externalCarrierId ?? null,
    // The trip-detail reassignment form has no carrier-fleet vehicle picker.
    // Preserve the issued vehicle so the governed FCL validation still checks
    // a real active vehicle instead of accepting an unbound external plate.
    externalCarrierVehicleId: trip.externalCarrierVehicleId,
    externalPlateNumber: data.externalPlateNumber ?? null,
    externalDriverName: data.externalDriverName ?? null,
    externalDriverPhone: data.externalDriverPhone ?? null,
    idempotencyKey: getRequestIdempotencyKey(req) ?? '',
    actor: user as typeof user & { role: Role.ADMIN | Role.MANAGER | Role.DISPATCHER },
  });
  res.locals.auditEntityId = trip.shipmentId;
  res.status(outcome.replayed ? 200 : 201).json(outcome);
}));


export default router;
