// Dispatch planning leaf — `/api/shipments/dispatch-*` and `/carrier-fleet-vehicles`.
//
// Master-plan / detail-plan reads (queues, fleet, facets, zones) plus the
// single-save detail-plan editor commands (carrier / plate / estimates / plan
// PATCHes) and the external carrier-fleet vehicle catalog they select from.

import { Router } from 'express';
import { Role } from '@tingting/shared';
import { z } from 'zod';
import {
  atomicDispatchPlanEditSchema,
  carrierFleetVehicleSchema,
} from '@tingting/shared';
import type { Request, Response } from 'express';
import {
  assignFulfillmentCarrierWriteCommand,
  assignFulfillmentPlate,
  updateFulfillmentEstimates,
  updateDispatchDetailPlan,
  listDispatchDeliveryPointFacets,
  listDispatchPortFacets,
  listZonePortFacets,
  listZoneTruckPresence,
  listDispatchDetailPlanRows,
  listDispatchFleet,
  listDispatchHandoffs,
  listDispatchQueue,
} from '../../services/dispatch-planning.service';
import {
  createCarrierFleetVehicle,
  listCarrierFleetVehicles,
  updateCarrierFleetVehicle,
} from '../../services/carrier-fleet-vehicle.service';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { throwValidation } from '../../lib/validation';
import { ApiError } from '../../errors';
import { IDEMPOTENCY_ENDPOINTS } from '../../services/idempotency.service';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { runShipmentWrite, sendShipmentWrite } from './shipment-shared';

const updateCarrierFleetVehicleSchema = carrierFleetVehicleSchema
  .pick({ licensePlate: true, isActive: true })
  .partial()
  .refine((value) => value.licensePlate !== undefined || value.isActive !== undefined, {
    message: 'Cần có ít nhất một nội dung thay đổi.',
  });

const dispatchPlanningRoutes = Router();

dispatchPlanningRoutes.get(
  '/dispatch-handoffs',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string'
      ? req.query.status.split(',').map((value) => value.trim()).filter(Boolean)
      : undefined;
    const urgency = typeof req.query.urgency === 'string' ? req.query.urgency : undefined;
    res.json(await listDispatchHandoffs({
      actor: getUser(req),
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      status: status as Array<'UNSEEN' | 'SEEN'> | undefined,
      urgency: urgency as 'NORMAL' | 'URGENT' | undefined,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      date: typeof req.query.date === 'string' ? req.query.date : undefined,
    }));
  }),
);

dispatchPlanningRoutes.get(
  '/dispatch-queue',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string'
      ? req.query.status.split(',').map((value) => value.trim()).filter(Boolean)
      : undefined;
    const urgency = typeof req.query.urgency === 'string' ? req.query.urgency : undefined;
    res.json(await listDispatchQueue({
      actor: getUser(req),
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      status: status as Array<'READY' | 'DISPATCHED'> | undefined,
      urgency: urgency as 'NORMAL' | 'URGENT' | undefined,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      date: typeof req.query.date === 'string' ? req.query.date : undefined,
    }));
  }),
);

dispatchPlanningRoutes.get(
  '/dispatch-fleet',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const resource = typeof req.query.resource === 'string' ? req.query.resource.trim() : '';
    if (resource !== 'TRUCK' && resource !== 'DRIVER' && resource !== 'EXTERNAL_CARRIER' && resource !== 'EXTERNAL_VEHICLE') {
      throw new ApiError(400, 'resource không hợp lệ.');
    }
    res.json(await listDispatchFleet({
      actor: getUser(req),
      resource,
      carrierId: typeof req.query.carrierId === 'string' ? Number(req.query.carrierId) : undefined,
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      fulfillmentId: typeof req.query.fulfillmentId === 'string' && req.query.fulfillmentId.trim() !== ''
        ? Number(req.query.fulfillmentId)
        : undefined,
    }));
  }),
);

dispatchPlanningRoutes.get(
  '/dispatch-detail-plan-rows',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const directionRaw = typeof req.query.direction === 'string' ? req.query.direction.trim().toUpperCase() : '';
    if (directionRaw && directionRaw !== 'IMPORT' && directionRaw !== 'EXPORT') {
      throw new ApiError(400, 'direction không hợp lệ.');
    }
    const assignmentStatusRaw = typeof req.query.assignmentStatus === 'string' ? req.query.assignmentStatus.trim().toUpperCase() : '';
    if (assignmentStatusRaw && assignmentStatusRaw !== 'UNASSIGNED' && assignmentStatusRaw !== 'ASSIGNED') {
      throw new ApiError(400, 'assignmentStatus không hợp lệ.');
    }
    const idList = (key: string) => {
      const raw = req.query[key];
      if (raw == null) return undefined;
      const values = Array.isArray(raw) ? raw : String(raw).split(',');
      const parsed = values.map((value) => Number(value));
      if (parsed.some((value) => !Number.isInteger(value) || value <= 0)) {
        throw new ApiError(400, `Tham số ${key} không hợp lệ`);
      }
      return parsed;
    };
    const time = (key: string) => {
      const raw = req.query[key];
      if (raw == null || raw === '') return undefined;
      const value = String(raw).trim();
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        throw new ApiError(400, `Giờ lọc không hợp lệ (${key})`);
      }
      return value;
    };
    const zone = (() => {
      const raw = req.query.zone;
      if (raw == null || raw === '') return undefined;
      const value = String(raw).trim();
      if (value.length > 32) throw new ApiError(400, 'Khu vực điều phối không hợp lệ.');
      return value;
    })();
    res.json(await listDispatchDetailPlanRows({
      actor: getUser(req),
      page: typeof req.query.page === 'string' && Number.isInteger(Number(req.query.page)) && Number(req.query.page) > 0
        ? Number(req.query.page)
        : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      date: typeof req.query.date === 'string' ? req.query.date : undefined,
      direction: directionRaw ? directionRaw as 'IMPORT' | 'EXPORT' : undefined,
      assignmentStatus: assignmentStatusRaw ? assignmentStatusRaw as 'UNASSIGNED' | 'ASSIGNED' : undefined,
      pickupIds: idList('pickupIds'),
      dropoffIds: idList('dropoffIds'),
      deliveryPointIds: idList('deliveryPointIds'),
      hourFrom: time('hourFrom'),
      hourTo: time('hourTo'),
      zone,
    }));
  }),
);

dispatchPlanningRoutes.get(
  '/dispatch-delivery-point-facets',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await listDispatchDeliveryPointFacets({
      actor: getUser(req),
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
    }));
  }),
);

dispatchPlanningRoutes.get(
  '/dispatch-pickup-port-facets',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await listDispatchPortFacets(
      { actor: getUser(req), q: typeof req.query.q === 'string' ? req.query.q : undefined },
      'pickup',
    ));
  }),
);

dispatchPlanningRoutes.get(
  '/dispatch-dropoff-port-facets',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await listDispatchPortFacets(
      { actor: getUser(req), q: typeof req.query.q === 'string' ? req.query.q : undefined },
      'dropoff',
    ));
  }),
);

// Master-plan per-zone port facet: only ports with the persisted dispatch_zone
// matching ?zone= referenced by active dispatch-eligible work.
dispatchPlanningRoutes.get(
  '/dispatch-zone-port-facets',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const zone = String(req.query.zone ?? '').trim();
    if (!zone) throw new ApiError(400, 'Thiếu khu vực điều phối (zone).');
    if (zone.length > 32) throw new ApiError(400, 'Khu vực điều phối không hợp lệ.');
    res.json(await listZonePortFacets({
      actor: getUser(req),
      zone,
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
    }));
  }),
);

// Zone truck presence: OWN trucks with dropoff D-1 / pickup D+1 evidence in
// ?zone= around the viewing date — advisory input for pairing zone orders.
dispatchPlanningRoutes.get(
  '/dispatch-zone-truck-presence',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const zone = String(req.query.zone ?? '').trim();
    if (!zone) throw new ApiError(400, 'Thiếu khu vực điều phối (zone).');
    if (zone.length > 32) throw new ApiError(400, 'Khu vực điều phối không hợp lệ.');
    res.json(await listZoneTruckPresence({
      actor: getUser(req),
      zone,
      date: typeof req.query.date === 'string' ? req.query.date : undefined,
    }));
  }),
);

const assignFulfillmentPlateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  truckId: z.number().int().positive().nullish(),
  externalCarrierVehicleId: z.number().int().positive().nullish(),
  plateNumber: z.string().trim().min(1).max(20).nullish(),
  clear: z.boolean().optional(),
}).strict().refine(
  (value) => [value.truckId, value.externalCarrierVehicleId, value.plateNumber].filter((field) => field != null && field !== '').length <= 1,
  { message: 'Chỉ chọn một nguồn biển số.' },
);

const assignFulfillmentCarrierSchema = z.object({
  expectedVersion: z.number().int().positive(),
  carrierType: z.enum(['OWN', 'EXTERNAL']),
  externalCarrierId: z.number().int().positive().nullish(),
}).strict().superRefine((value, ctx) => {
  if (value.carrierType === 'OWN' && value.externalCarrierId != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['externalCarrierId'], message: 'Xe nội bộ không dùng mã nhà xe ngoài.' });
  }
  if (value.carrierType === 'EXTERNAL' && value.externalCarrierId == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['externalCarrierId'], message: 'Nhà xe ngoài là bắt buộc.' });
  }
});

const updateFulfillmentEstimatesSchema = z.object({
  expectedVersion: z.number().int().positive(),
  plannedRevenue: z.number().int().nonnegative().nullable(),
  plannedCarrierCost: z.number().int().nonnegative().nullable(),
}).strict();

// Single-save editor command: the schema is shared with the frontend so the
// contract cannot drift; validation lives at the API boundary.
const updateDispatchDetailPlanSchema = atomicDispatchPlanEditSchema;

dispatchPlanningRoutes.patch(
  '/dispatch-detail-plan-rows/:fulfillmentId/carrier',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const fulfillmentId = Number(req.params.fulfillmentId);
    if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
      throw new ApiError(400, 'fulfillmentId không hợp lệ.');
    }
    const parsed = assignFulfillmentCarrierSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    res.json(await assignFulfillmentCarrierWriteCommand({
      fulfillmentId,
      expectedVersion: parsed.data.expectedVersion,
      carrierType: parsed.data.carrierType,
      externalCarrierId: parsed.data.externalCarrierId ?? null,
      idempotencyKey: getRequestIdempotencyKey(req) ?? '',
      actor: user as typeof user & { role: Role.ADMIN | Role.MANAGER | Role.DISPATCHER },
    }));
  }),
);

dispatchPlanningRoutes.patch(
  '/dispatch-detail-plan-rows/:fulfillmentId/plate',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const fulfillmentId = Number(req.params.fulfillmentId);
    if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
      throw new ApiError(400, 'fulfillmentId không hợp lệ.');
    }
    const parsed = assignFulfillmentPlateSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    res.json(await assignFulfillmentPlate({
      fulfillmentId,
      expectedVersion: parsed.data.expectedVersion,
      truckId: parsed.data.truckId ?? null,
      externalCarrierVehicleId: parsed.data.externalCarrierVehicleId ?? null,
      plateNumber: parsed.data.plateNumber ?? null,
      clear: parsed.data.clear === true,
      idempotencyKey: getRequestIdempotencyKey(req) ?? '',
      actor: user as typeof user & { role: Role.ADMIN | Role.MANAGER | Role.DISPATCHER },
    }));
  }),
);

dispatchPlanningRoutes.patch(
  '/dispatch-detail-plan-rows/:fulfillmentId/estimates',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const fulfillmentId = Number(req.params.fulfillmentId);
    if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
      throw new ApiError(400, 'fulfillmentId không hợp lệ.');
    }
    const parsed = updateFulfillmentEstimatesSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    res.json(await updateFulfillmentEstimates({
      fulfillmentId,
      expectedVersion: parsed.data.expectedVersion,
      plannedRevenue: parsed.data.plannedRevenue,
      plannedCarrierCost: parsed.data.plannedCarrierCost,
      idempotencyKey: getRequestIdempotencyKey(req) ?? '',
      actor: user as typeof user & { role: Role.ADMIN | Role.MANAGER | Role.DISPATCHER },
    }));
  }),
);

// Atomic single-save editor command — replaces the editor's old sequence of
// carrier → plate → estimates PATCHes with one fulfillment+shipment
// transaction. Legacy endpoints remain for existing callers.
dispatchPlanningRoutes.patch(
  '/dispatch-detail-plan-rows/:fulfillmentId/plan',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const fulfillmentId = Number(req.params.fulfillmentId);
    if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
      throw new ApiError(400, 'fulfillmentId không hợp lệ.');
    }
    const parsed = updateDispatchDetailPlanSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    res.json(await updateDispatchDetailPlan({
      fulfillmentId,
      expectedFulfillmentVersion: parsed.data.expectedFulfillmentVersion,
      expectedShipmentVersion: parsed.data.expectedShipmentVersion,
      carrierType: parsed.data.carrierType,
      externalCarrierId: parsed.data.externalCarrierId ?? null,
      truckId: parsed.data.truckId ?? null,
      externalCarrierVehicleId: parsed.data.externalCarrierVehicleId ?? null,
      plateNumber: parsed.data.plateNumber ?? null,
      clearVehicle: parsed.data.clearVehicle === true,
      plannedRevenue: parsed.data.plannedRevenue,
      plannedCarrierCost: parsed.data.plannedCarrierCost,
      classification: parsed.data.classification,
      isCombined: parsed.data.isCombined,
      idempotencyKey: getRequestIdempotencyKey(req) ?? '',
      actor: user as typeof user & { role: Role.ADMIN | Role.MANAGER | Role.DISPATCHER },
    }));
  }),
);

dispatchPlanningRoutes.get(
  '/carrier-fleet-vehicles',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const carrierId = Number(req.query.carrierId);
    if (!Number.isInteger(carrierId) || carrierId <= 0) throw new ApiError(400, 'carrierId không hợp lệ.');
    res.json({ items: await listCarrierFleetVehicles(carrierId) });
  }),
);

dispatchPlanningRoutes.post(
  '/carrier-fleet-vehicles',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = carrierFleetVehicleSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.CARRIER_FLEET_VEHICLE_CREATE,
      { data: parsed.data },
      async (tx) => {
        const vehicle = await createCarrierFleetVehicle({ ...parsed.data, actorUserId: user.userId }, tx);
        return {
          body: vehicle,
          status: 201,
          auditEntityId: vehicle.id,
          auditEntityKey: vehicle.licensePlate,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

dispatchPlanningRoutes.patch(
  '/carrier-fleet-vehicles/:vehicleId',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const vehicleId = Number(req.params.vehicleId);
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) throw new ApiError(400, 'vehicleId không hợp lệ.');
    const parsed = updateCarrierFleetVehicleSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.CARRIER_FLEET_VEHICLE_UPDATE,
      { vehicleId, data: parsed.data },
      async (tx) => {
        const vehicle = await updateCarrierFleetVehicle(
          vehicleId,
          { ...parsed.data, actorUserId: user.userId },
          tx,
        );
        return {
          body: vehicle,
          status: 200,
          auditEntityId: vehicle.id,
          auditEntityKey: vehicle.licensePlate,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

export { dispatchPlanningRoutes };
