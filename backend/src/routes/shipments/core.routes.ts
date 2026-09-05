// Shipment core leaf — CRUD, quick-create, and lifecycle transitions.
//
// `/api/shipments` list + create (+ `/quick` idempotent mobile create), the
// `/:id` root read/update/delete, status transitions, dispatch order issue,
// direct completion, fulfillment cancellation disposition, submit-for-dispatch,
// carrier allocations, recovery facts, and the intake support endpoints
// (operational sites, pricing preview).

import { Router } from 'express';
import { Role, ShipmentStatus } from '@tingting/shared';
import { z } from 'zod';
import {
  cancelShipmentFulfillmentSchema,
  createShipmentSchema,
  updateShipmentSchema,
  transitionShipmentStatusSchema,
  quickCreateShipmentSchema,
  submitShipmentForDispatchSchema,
  assignShipmentCarriersSchema,
  operationalSiteSchema,
  operationalSiteUpdateSchema,
  shipmentRecoveryRecordSchema,
} from '@tingting/shared';
import type { Request, Response } from 'express';
import {
  createShipment,
  cancelShipmentFulfillment,
  completeShipmentDirect,
  createShipmentIdempotent,
  getShipment,
  getShipmentDetail,
  listShipmentsPaginated,
  ALLOCATION_STATUSES,
  type AllocationStatus,
  updateShipment,
  transitionShipmentStatus,
  softDeleteShipment,
} from '../../services/shipment.service';
import { assignShipmentCarriers, createOperationalSiteForIntake, listOperationalSitesForAdmin, listOperationalSitesForIntake, submitShipmentForDispatch, updateOperationalSiteForAdmin } from '../../services/shipment-intake.service';
import { issueFulfillmentDispatchOrder } from '../../services/dispatch-planning.service';
import { resolveShipmentPricingProjection } from '../../services/pricing.service';
import { recordShipmentRecovery } from '../../services/shipment-recovery.service';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { parsePagination } from '../utils/pagination';
import { throwValidation } from '../../lib/validation';
import { ApiError } from '../../errors';
import { IDEMPOTENCY_ENDPOINTS } from '../../services/idempotency.service';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import {
  SHIPMENT_INTAKE_MUTATION_ROLES,
  parseId,
  requireShipmentIdempotencyKey,
  runShipmentWrite,
  sendShipmentWrite,
} from './shipment-shared';

const fulfillmentDispatchSchema = z.object({
  fulfillmentId: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  plannedStartAt: z.string().trim().min(1),
  plannedEndAt: z.string().trim().min(1),
  endTimeConfirmed: z.boolean(),
  carrierType: z.enum(['OWN', 'EXTERNAL']),
  cargoTypeId: z.number().int().positive().optional().nullable(),
  truckId: z.number().int().positive().optional().nullable(),
  driverId: z.number().int().positive().optional().nullable(),
  trailerId: z.number().int().positive().optional().nullable(),
  containerTypeId: z.number().int().positive().optional().nullable(),
  pricingRateKey: z.string().trim().max(32).optional().nullable(),
  externalCarrierId: z.number().int().positive().optional().nullable(),
  externalCarrierVehicleId: z.number().int().positive().optional().nullable(),
  externalPlateNumber: z.string().trim().max(20).optional().nullable(),
  externalDriverName: z.string().trim().max(100).optional().nullable(),
  externalDriverPhone: z.string().trim().max(20).optional().nullable(),
});

const completeShipmentDirectSchema = z.object({
  expectedVersion: z.number().int().positive(),
  vatRate: z.union([
    z.literal(0),
    z.literal(0.05),
    z.literal(0.08),
    z.literal(0.1),
  ]),
  confirmZeroRevenue: z.boolean().optional(),
  // Allow the routine close to override the trip photo-evidence gate for trips
  // that legitimately have no CONTAINER/SEAL photo yet (mirrors the per-trip
  // `confirmNoPhoto` override in transitionTripStatus). Without this, a
  // PENDING_EXPENSE_APPROVAL shipment whose trips have no photos could never be
  // closed directly, even though PRD Bước 5 only requires e-POD + POD paper +
  // expense scope + VAT.
  confirmNoPhoto: z.boolean().optional(),
  trips: z.array(z.object({
    tripId: z.number().int().positive(),
    expectedVersion: z.number().int().positive(),
  })).min(1).max(100),
});

const shipmentPricingPreviewSchema = z.object({
  customerId: z.number().int().positive(),
  routeId: z.number().int().positive().optional().nullable(),
  cargoMode: z.enum(['FCL', 'LCL']).optional().nullable(),
  cargoTypeId: z.number().int().positive().optional().nullable(),
  expectedDeliveryDate: z.string().trim().optional().nullable(),
  cargoWeightKg: z.coerce.number().positive().optional().nullable(),
  containerCount: z.number().int().positive().optional().nullable(),
  containerTypeIds: z.array(z.number().int().positive()).optional(),
});

const coreRoutes = Router();

function resolveDriverNotes(input: { driverNotes?: string | null; operationalNotes?: string | null }) {
  return input.driverNotes !== undefined ? input.driverNotes : input.operationalNotes;
}

function toShipmentRecoveryFactPayload(fact: {
  id: number;
  version: number;
  shipmentContainerId: number | null;
  kind: string;
  status: string;
  expectedAmount: string;
  recoveredAmount: string;
  outstandingAmount: string;
  sourceExpenseId: number | null;
  sourceVersion: string | null;
  waiverReason: string | null;
}) {
  return {
    id: fact.id,
    version: fact.version,
    shipmentContainerId: fact.shipmentContainerId,
    kind: fact.kind as 'DEPOSIT' | 'REPAIR' | 'OTHER',
    status: fact.status as 'OPEN' | 'PARTIAL' | 'RECOVERED' | 'WAIVED',
    expectedAmount: fact.expectedAmount,
    recoveredAmount: fact.recoveredAmount,
    outstandingAmount: fact.outstandingAmount,
    sourceExpenseId: fact.sourceExpenseId,
    sourceVersion: fact.sourceVersion,
    waiverReason: fact.waiverReason,
  };
}

coreRoutes.post(
  '/:id/recovery-facts',
  requireRoles(Role.OPS, Role.ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const parsed = shipmentRecoveryRecordSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_RECOVERY_RECORD,
      { shipmentId, data: parsed.data },
      async (tx) => {
        const fact = await recordShipmentRecovery({
          ...parsed.data,
          actor: getUser(req),
          transaction: tx,
        });
        if (fact.shipmentId !== shipmentId) {
          throw new ApiError(409, 'Chi phí thu hồi không thuộc lô hàng trên đường dẫn yêu cầu.');
        }
        return {
          body: { fact: toShipmentRecoveryFactPayload(fact) },
          status: parsed.data.expectedRecoveryVersion === 0 ? 201 : 200,
          auditEntityId: shipmentId,
          auditEntityKey: `shipment-${shipmentId}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

// ─── GET / — paginated list ────────────────────────────────────────────────
coreRoutes.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const customerIdVal = (req.query.customerId || req.query.customer_id) as string | undefined;
  const statusVal = req.query.status as string | undefined;
  const q = typeof req.query.q === 'string' && req.query.q.trim().length > 0
    ? req.query.q.trim()
    : undefined;
  if (q && q.length > 100) {
    return res.status(400).json({ error: 'Từ khóa tìm kiếm không được vượt quá 100 ký tự' });
  }

  // Validate the status filter early — an invalid enum value would otherwise
  // silently return an empty list, hiding a client bug. Comma-separated sets
  // are also accepted so the dispatch master plan can fetch the full
  // operational range (READY_FOR_DISPATCH → COMPLETED) in one request.
  let status: ShipmentStatus | ShipmentStatus[] | undefined;
  if (statusVal !== undefined) {
    const requested = statusVal.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
    const invalid = requested.find((part) => !Object.values(ShipmentStatus).includes(part as ShipmentStatus));
    if (requested.length === 0 || invalid) {
      return res.status(400).json({ error: 'Trạng thái lô hàng không hợp lệ' });
    }
    status = requested.length === 1
      ? requested[0] as ShipmentStatus
      : requested as ShipmentStatus[];
  }

  // W4 20260805_03 §"Bổ sung các trường Filter tìm kiếm": trade direction,
  // Ngày đóng/trả range, Số Bill/Book.
  const tradeDirection = req.query.tradeDirection === 'IMPORT' || req.query.tradeDirection === 'EXPORT'
    ? (req.query.tradeDirection as 'IMPORT' | 'EXPORT')
    : undefined;
  const blNumber = typeof req.query.blNumber === 'string' && req.query.blNumber.trim().length > 0
    ? req.query.blNumber.trim()
    : undefined;
  if (blNumber && blNumber.length > 50) {
    return res.status(400).json({ error: 'Số B/L không được vượt quá 50 ký tự' });
  }
  const dateFrom = typeof req.query.dateFrom === 'string' && req.query.dateFrom.trim().length > 0
    ? req.query.dateFrom.trim()
    : undefined;
  const dateTo = typeof req.query.dateTo === 'string' && req.query.dateTo.trim().length > 0
    ? req.query.dateTo.trim()
    : undefined;
  if (dateFrom && isNaN(new Date(dateFrom).getTime())) {
    return res.status(400).json({ error: 'dateFrom không hợp lệ' });
  }
  if (dateTo && isNaN(new Date(dateTo).getTime())) {
    return res.status(400).json({ error: 'dateTo không hợp lệ' });
  }

  // Dispatch master-plan ("Kế hoạch Tổng quát") filters: delivery-date range on
  // expectedDeliveryDate and derived carrier-allocation coverage.
  const deliveryDateFrom = typeof req.query.deliveryDateFrom === 'string' && req.query.deliveryDateFrom.trim().length > 0
    ? req.query.deliveryDateFrom.trim()
    : undefined;
  const deliveryDateTo = typeof req.query.deliveryDateTo === 'string' && req.query.deliveryDateTo.trim().length > 0
    ? req.query.deliveryDateTo.trim()
    : undefined;
  if (deliveryDateFrom && isNaN(new Date(deliveryDateFrom).getTime())) {
    return res.status(400).json({ error: 'deliveryDateFrom không hợp lệ' });
  }
  if (deliveryDateTo && isNaN(new Date(deliveryDateTo).getTime())) {
    return res.status(400).json({ error: 'deliveryDateTo không hợp lệ' });
  }
  const allocationStatusVal = req.query.allocationStatus as string | undefined;
  let allocationStatus: AllocationStatus | undefined;
  if (allocationStatusVal !== undefined && allocationStatusVal.trim().length > 0) {
    if (!ALLOCATION_STATUSES.includes(allocationStatusVal as AllocationStatus)) {
      return res.status(400).json({ error: 'Trạng thái phân bổ không hợp lệ' });
    }
    allocationStatus = allocationStatusVal as AllocationStatus;
  }

  // Dispatch master-plan Lạch Huyện facets: repeatable `portIds` /
  // `carrierKeys` params, OR within one facet, AND across facets. Strict
  // boundary parsing with Vietnamese 400s.
  const rawPortIds = Array.isArray(req.query.portIds) ? req.query.portIds : [req.query.portIds];
  const portIds: number[] = [];
  for (const raw of rawPortIds) {
    if (raw == null || String(raw).trim() === '') continue;
    const id = Number(String(raw).trim());
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Cảng lọc không hợp lệ' });
    }
    portIds.push(id);
  }
  if (new Set(portIds).size !== portIds.length) portIds.splice(0, portIds.length, ...new Set(portIds));
  if (portIds.length > 50) {
    return res.status(400).json({ error: 'Chỉ được chọn tối đa 50 cảng' });
  }
  const rawCarrierKeys = Array.isArray(req.query.carrierKeys) ? req.query.carrierKeys : [req.query.carrierKeys];
  const carrierKeys: string[] = [];
  for (const raw of rawCarrierKeys) {
    if (raw == null || String(raw).trim() === '') continue;
    const key = String(raw).trim();
    if (!/^(OWN|UNASSIGNED|EXTERNAL:[1-9]\d*)$/.test(key)) {
      return res.status(400).json({ error: 'Nhà xe lọc không hợp lệ' });
    }
    carrierKeys.push(key);
  }
  const uniqueCarrierKeys = [...new Set(carrierKeys)];
  if (uniqueCarrierKeys.length > 50) {
    return res.status(400).json({ error: 'Chỉ được chọn tối đa 50 nhà xe' });
  }

  const result = await listShipmentsPaginated({
    page,
    limit,
    customerId: customerIdVal ? parseInt(customerIdVal, 10) : undefined,
    status,
    q,
    tradeDirection,
    blNumber,
    dateFrom,
    dateTo,
    deliveryDateFrom,
    deliveryDateTo,
    allocationStatus,
    portIds: portIds.length > 0 ? portIds : undefined,
    carrierKeys: uniqueCarrierKeys.length > 0 ? uniqueCarrierKeys : undefined,
    includeDispatchSummary: req.query.includeDispatchSummary === 'true',
    actor: getUser(req),
  });
  res.json(result);
}));

coreRoutes.post(
  '/:id/submit-for-dispatch',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const parsed = submitShipmentForDispatchSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const idempotencyKey = getRequestIdempotencyKey(req);
    const outcome = await submitShipmentForDispatch({
      shipmentId,
      expectedVersion: parsed.data.expectedVersion,
      idempotencyKey: idempotencyKey ?? '',
      actor: getUser(req),
      priority: parsed.data.priority,
      vehicleNeededBy: parsed.data.vehicleNeededBy ? new Date(parsed.data.vehicleNeededBy) : null,
      operationalNote: parsed.data.operationalNote,
      carrierAllocations: parsed.data.carrierAllocations,
    });
    res.json({ ...outcome.result, replayed: outcome.replayed });
  }),
);

coreRoutes.post(
  '/:id/carrier-allocations',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const parsed = assignShipmentCarriersSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    // Dispatch master-plan popover saves partial allocations (docx allows
    // under-allocation); the clerk submit flow keeps exact-match.
    const allowPartial = req.query.mode === 'partial';
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CARRIER_ALLOCATIONS_ASSIGN,
      { shipmentId, data: parsed.data },
      async (tx) => {
        const assigned = await assignShipmentCarriers({
          shipmentId,
          expectedVersion: parsed.data.expectedVersion,
          carrierAllocations: parsed.data.carrierAllocations,
          actor: getUser(req),
          ...(allowPartial ? { allowPartial: true } : {}),
          transaction: tx,
        });
        return {
          body: assigned,
          status: 200,
          auditEntityId: shipmentId,
          auditEntityKey: assigned.shipment.shipmentCode ?? 'Lô hàng chưa có mã',
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

coreRoutes.get(
  '/operational-sites',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const customerId = Number(req.query.customerId);
    if (!Number.isInteger(customerId) || customerId < 1) {
      throw new ApiError(400, 'customerId không hợp lệ.');
    }
    res.json({ items: await listOperationalSitesForIntake(customerId, getUser(req)) });
  }),
);

// Create a customer-owned factory/warehouse from the clerk intake form so a
// user is never blocked by an empty "Nhà máy" dropdown. Matches the GET
// guard; the service additionally enforces CLERK customer-scope.
coreRoutes.post(
  '/operational-sites',
  requireRoles(...SHIPMENT_INTAKE_MUTATION_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = operationalSiteSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const site = await createOperationalSiteForIntake(parsed.data, getUser(req));
    res.status(201).json(site);
  }),
);

// Master-data management for the ADMIN/MANAGER "Nhà máy" config surface.
// Kept on the shipment router (requireRoles guard, no Casbin policy churn)
// because the entity ships on the intake endpoints above.
coreRoutes.get(
  '/operational-sites/admin',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ items: await listOperationalSitesForAdmin(getUser(req)) });
  }),
);

coreRoutes.patch(
  '/operational-sites/:id',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const siteId = Number.parseInt(req.params.id as string, 10);
    if (!Number.isInteger(siteId) || siteId < 1) {
      throw new ApiError(400, 'Mã nhà máy / kho không hợp lệ.');
    }
    const parsed = operationalSiteUpdateSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    res.json(await updateOperationalSiteForAdmin(siteId, parsed.data, getUser(req)));
  }),
);

coreRoutes.post(
  '/pricing-preview',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = shipmentPricingPreviewSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    res.json(await resolveShipmentPricingProjection({
      customerId: parsed.data.customerId,
      routeId: parsed.data.routeId,
      cargoMode: parsed.data.cargoMode,
      cargoTypeId: parsed.data.cargoTypeId,
      date: parsed.data.expectedDeliveryDate,
      cargoWeightKg: parsed.data.cargoWeightKg,
      containerCount: parsed.data.containerCount,
      containerTypeIds: parsed.data.containerTypeIds,
    }));
  }),
);

// ─── POST / — create draft shipment ────────────────────────────────────────
coreRoutes.post(
  '/',
  requireRoles(...SHIPMENT_INTAKE_MUTATION_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createShipmentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { driverNotes, operationalNotes, ...shipmentInput } = parsed.data;
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CREATE,
      { data: parsed.data },
      async (tx) => {
        const shipment = await createShipment({
          ...shipmentInput,
          operationalNotes: driverNotes !== undefined ? driverNotes : operationalNotes,
          cargoTypeId: shipmentInput.cargoTypeId,
          createdBy: user.userId,
        }, user, tx);
        return {
          body: shipment,
          status: 201,
          auditEntityId: shipment.id,
          auditEntityKey: shipment.shipmentCode ?? "Lô hàng chưa có mã",
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

// ─── POST /quick — M10.1 clerk mobile quick-create ──────────────────────────
//
// Same minimum data set as `POST /` (customerId required; all other fields
// optional), wrapped with server-side idempotency so a flaky-network
// resubmit returns the original shipment instead of creating a duplicate
// (PRD M10-01-03, Q23 proposal). The dedupe token is the `Idempotency-Key`
// header when present, otherwise the body `_requestId` (the offline-queue
// client lib prefers the body channel). A replay with a differing payload
// is rejected 409 — never silently overwritten.
//
// RBAC: same mount-level `casbinAuthz('shipments')` applies. The explicit
// `requireRoles` keeps quick-create aligned with the canonical intake roles,
// while ACCOUNTANT remains limited to its separate review/close commands.
// CUSTOMER/DRIVER/OPS remain denied at the mount.
coreRoutes.post(
  '/quick',
  requireRoles(...SHIPMENT_INTAKE_MUTATION_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = quickCreateShipmentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    // Header wins; fall back to body channel for the offline-queue lib.
    const idempotencyKey =
      (req.header('Idempotency-Key') as string | undefined) ?? parsed.data._requestId;
    if (!idempotencyKey) {
      throw new ApiError(400, 'Idempotency-Key là bắt buộc khi tạo lệnh giao nhận nhanh.');
    }
    const { shipment, replayed } = await createShipmentIdempotent(
      {
        customerId: parsed.data.customerId,
        routeId: parsed.data.routeId,
        cargoTypeId: parsed.data.cargoTypeId,
        responsibleUnitId: parsed.data.responsibleUnitId,
        bookingRef: parsed.data.bookingRef,
        blNumber: parsed.data.blNumber,
        tradeDirection: parsed.data.tradeDirection,
        cargoMode: parsed.data.cargoMode,
        operationalSiteId: parsed.data.operationalSiteId,
        pickupWarehouseSiteId: parsed.data.pickupWarehouseSiteId,
        factoryName: parsed.data.factoryName,
        isCombined: parsed.data.isCombined,
        shippingLineName: parsed.data.shippingLineName,
        expectedDeliveryDate: parsed.data.expectedDeliveryDate,
        customsCutoffAt: parsed.data.customsCutoffAt,
        closingAt: parsed.data.closingAt,
        plannedReturnAt: parsed.data.plannedReturnAt,
        cargoWeightKg: parsed.data.cargoWeightKg,
        cargoVolumeCbm: parsed.data.cargoVolumeCbm,
        packageCount: parsed.data.packageCount,
        packageType: parsed.data.packageType,
        operationalNotes: resolveDriverNotes(parsed.data),
        customerNotes: parsed.data.customerNotes,
        pickupLocation: parsed.data.pickupLocation,
        deliveryLocation: parsed.data.deliveryLocation,
        contactName: parsed.data.contactName,
        contactPhone: parsed.data.contactPhone,
        createdBy: getUser(req).userId,
      },
      idempotencyKey,
      getUser(req),
    );
    const pricingProjection = await resolveShipmentPricingProjection({
      customerId: shipment.customerId,
      routeId: shipment.routeId,
      cargoMode: shipment.cargoMode,
      cargoTypeId: shipment.cargoTypeId,
      date: shipment.expectedDeliveryDate,
      cargoWeightKg: shipment.cargoWeightKg,
      containerCount: 0,
      containerTypeIds: [],
    });
    res.locals.auditEntityId = shipment.id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? "Lô hàng chưa có mã";
    res.status(replayed ? 200 : 201).json({
      ...shipment,
      pricingProjection,
    });
  }),
);

// ─── GET /:id — detail (shipment + containers + documents + declarations + history)
coreRoutes.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (id === null) return;
  res.json(await getShipmentDetail(id, getUser(req)));
}));

// ─── PUT /:id — update with optimistic-lock version ────────────────────────
coreRoutes.put(
  '/:id',
  requireRoles(...SHIPMENT_INTAKE_MUTATION_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req, res);
    if (id === null) return;
    const parsed = updateShipmentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_UPDATE,
      { shipmentId: id, data: parsed.data },
      async (tx) => {
        const shipment = await updateShipment(id, {
          expectedVersion: parsed.data.expectedVersion,
          customerId: parsed.data.customerId,
          routeId: parsed.data.routeId,
          cargoTypeId: parsed.data.cargoTypeId,
          responsibleUnitId: parsed.data.responsibleUnitId,
          bookingRef: parsed.data.bookingRef,
          blNumber: parsed.data.blNumber,
          tradeDirection: parsed.data.tradeDirection,
          cargoMode: parsed.data.cargoMode,
          operationalSiteId: parsed.data.operationalSiteId,
          pickupWarehouseSiteId: parsed.data.pickupWarehouseSiteId,
          factoryName: parsed.data.factoryName,
          shippingLineName: parsed.data.shippingLineName,
          expectedDeliveryDate: parsed.data.expectedDeliveryDate,
          customsCutoffAt: parsed.data.customsCutoffAt,
          closingAt: parsed.data.closingAt,
          plannedReturnAt: parsed.data.plannedReturnAt,
          cargoWeightKg: parsed.data.cargoWeightKg,
          cargoVolumeCbm: parsed.data.cargoVolumeCbm,
          packageCount: parsed.data.packageCount,
          packageType: parsed.data.packageType,
          operationalNotes: resolveDriverNotes(parsed.data),
          customerNotes: parsed.data.customerNotes,
          pickupLocation: parsed.data.pickupLocation,
          deliveryLocation: parsed.data.deliveryLocation,
          contactName: parsed.data.contactName,
          contactPhone: parsed.data.contactPhone,
          updatedBy: user.userId,
        }, user, tx);
        return {
          body: shipment,
          status: 200,
          auditEntityId: shipment.id,
          auditEntityKey: shipment.shipmentCode ?? "Lô hàng chưa có mã",
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

// ─── POST /:id/transition — status transition ──────────────────────────────
coreRoutes.post(
  '/:id/transition',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req, res);
    if (id === null) return;
    const parsed = transitionShipmentStatusSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_TRANSITION,
      { shipmentId: id, data: parsed.data },
      async (tx) => {
        const shipment = await transitionShipmentStatus(id, parsed.data.status, {
          reason: parsed.data.reason ?? null,
          changedBy: user.userId,
        }, tx);
        return {
          body: shipment,
          status: 200,
          auditEntityId: shipment.id,
          auditEntityKey: shipment.shipmentCode ?? "Lô hàng chưa có mã",
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

// ─── POST /:id/dispatch — fulfillment → linked trip ────────────────────────
coreRoutes.post(
  '/:id/dispatch',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req, res);
    if (id === null) return;
    const parsed = fulfillmentDispatchSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const shipment = await getShipment(id);
    const outcome = await issueFulfillmentDispatchOrder({
      shipmentId: id,
      fulfillmentId: parsed.data.fulfillmentId,
      expectedVersion: parsed.data.expectedVersion,
      plannedStartAt: parsed.data.plannedStartAt,
      plannedEndAt: parsed.data.plannedEndAt,
      endTimeConfirmed: parsed.data.endTimeConfirmed,
      carrierType: parsed.data.carrierType,
      cargoTypeId: parsed.data.cargoTypeId ?? null,
      truckId: parsed.data.truckId ?? null,
      driverId: parsed.data.driverId ?? null,
      trailerId: parsed.data.trailerId ?? null,
      containerTypeId: parsed.data.containerTypeId ?? null,
      pricingRateKey: parsed.data.pricingRateKey ?? null,
      externalCarrierId: parsed.data.externalCarrierId ?? null,
      externalCarrierVehicleId: parsed.data.externalCarrierVehicleId ?? null,
      externalPlateNumber: parsed.data.externalPlateNumber ?? null,
      externalDriverName: parsed.data.externalDriverName ?? null,
      externalDriverPhone: parsed.data.externalDriverPhone ?? null,
      idempotencyKey: getRequestIdempotencyKey(req) ?? '',
      actor: user as typeof user & { role: Role.ADMIN | Role.MANAGER | Role.DISPATCHER },
    });
    res.locals.auditEntityId = id;
    res.locals.auditEntityKey = shipment.shipmentCode ?? "Lô hàng chưa có mã";
    res.status(outcome.replayed ? 200 : 201).json(outcome);
  }),
);

coreRoutes.post(
  '/:id/complete',
  requireRoles(Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const parsed = completeShipmentDirectSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const actor = getUser(req);
    const idempotencyKey = requireShipmentIdempotencyKey(
      req,
      'Idempotency-Key là bắt buộc khi chốt trực tiếp lô hàng.',
    );
    const completed = await completeShipmentDirect({
      shipmentId,
      expectedVersion: parsed.data.expectedVersion,
      vatRate: parsed.data.vatRate,
      trips: parsed.data.trips,
      confirmZeroRevenue: parsed.data.confirmZeroRevenue === true,
      confirmNoPhoto: parsed.data.confirmNoPhoto === true,
      idempotencyKey,
      actor,
    });
    res.locals.auditEntityId = completed.shipment.id;
    res.locals.auditEntityKey = completed.shipment.shipmentCode ?? 'Lô hàng chưa có mã';
    res.json(completed);
  }),
);

coreRoutes.post(
  '/:id/fulfillments/:fulfillmentId/cancellation-disposition',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const fulfillmentId = parseInt(req.params.fulfillmentId as string, 10);
    if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
      res.status(400).json({ error: 'ID tác vụ không hợp lệ' });
      return;
    }
    const parsed = cancelShipmentFulfillmentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const actor = getUser(req);
    const idempotencyKey = requireShipmentIdempotencyKey(
      req,
      'Idempotency-Key là bắt buộc khi xử lý tác vụ đã hủy.',
    );
    const updated = await cancelShipmentFulfillment({
      shipmentId,
      fulfillmentId,
      expectedVersion: parsed.data.expectedVersion,
      disposition: parsed.data.disposition,
      reason: parsed.data.reason,
      actor,
      idempotencyKey,
    });
    res.locals.auditEntityId = updated.shipment.id;
    res.locals.auditEntityKey = updated.shipment.shipmentCode ?? "Lô hàng chưa có mã";
    res.json(updated);
  }),
);

// ─── DELETE /:id — soft-delete (DRAFT/CANCELED only, version-gated) ─────────
coreRoutes.delete(
  '/:id',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req, res);
    if (id === null) return;
    // version is required for the optimistic-lock check; accept it from either
    // the body (JSON DELETE) or the query string for clients that can't send
    // a DELETE body.
    const versionRaw = (req.body?.version ?? req.query.version) as unknown;
    const version = Number(versionRaw);
    if (!Number.isInteger(version) || version < 0) {
      return res.status(400).json({ error: 'version là bắt buộc để xóa lô hàng' });
    }
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_DELETE,
      { shipmentId: id, version },
      async (tx) => {
        const shipment = await softDeleteShipment(id, {
          version,
          deletedBy: user.userId,
        }, tx);
        return {
          body: { ok: true },
          status: 200,
          auditEntityId: shipment.id,
          auditEntityKey: shipment.shipmentCode ?? "Lô hàng chưa có mã",
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

export { coreRoutes };
