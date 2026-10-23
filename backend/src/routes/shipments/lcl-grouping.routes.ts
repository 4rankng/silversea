// Shipment LCL grouping leaf (FB-092/093, spec 23/10) — cost/rev group
// commands. The two money dimensions stay fully independent: cost commands
// (ĐV) never move rev facts and vice versa.
//
// POST endpoints (no DELETE: the /api/shipments mount maps DELETE to casbin's
// `delete` action, which only ADMIN/MANAGER hold — CUS and DISPATCHER must be
// able to manage their own groups, so these are POST commands, matching the
// house pattern of action-shaped POSTs like /:id/lock).
//
//   POST /api/shipments/lcl/cost-group        — dispatch "Gán xe nhóm" THÊM
//                                               (FB-092, 4 fields spec 23/10)
//   POST /api/shipments/lcl/cost-group/update — dispatch "Gán xe nhóm" SỬA
//                                               (spec 23/10, same 4 fields)
//   POST /api/shipments/lcl/rev-group         — CUS "Ghép cước thu khách"
//                                               (FB-093, same-customer only)
//   POST /api/shipments/lcl/rev-class         — CUS per-lot outputs của MỘT lô
//                                               chưa ghép (161026232349 +
//                                               spec 23/10 §4.1: Loại xe thu +
//                                               Giá cước thu auto/nhập tay)
//   POST /api/shipments/lcl/truck             — BKS quick-edit (BKS báo khách
//                                               là per-lot CUS; null = clear)
//   POST /api/shipments/lcl/unmerge           — one lot leaves a dimension
//                                               (FB-095, "unmerge 1 lô về riêng")
//   POST /api/shipments/lcl/unmerge-group     — whole-group tách nhóm (FB-095)

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  assignLclCostGroupSchema,
  updateLclCostGroupSchema,
  mergeLclRevGroupSchema,
  setLclLotRevClassSchema,
  unmergeLclLotSchema,
  unmergeLclGroupSchema,
  updateLclTruckSchema,
  Role,
} from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { declareMaterialWrite } from '../../middleware/material-write';
import { registerAuditEvent } from '../../services/audit-registry';
import { AuditEvent } from '../../services/audit-types';
import {
  assignLclCostGroup,
  updateLclCostGroup,
  mergeLclRevGroup,
  setLclLotRevClass,
  unmergeLclLot,
  unmergeLclGroup,
  updateLclGroupTruck,
} from '../../services/lcl-grouping.service';

// 161026232349 — the request-level audit label for the single-lot class
// command; the service's own `auditGroupChange` record stays the authority.
registerAuditEvent('POST', '/api/shipments/lcl/rev-class', AuditEvent.SHIPMENT_UPDATED);
// Spec 23/10 — "Gán xe nhóm" SỬA shares the shared-event label with its own
// action discriminator ('cost-group-update', like truck-quick-edit).
registerAuditEvent('POST', '/api/shipments/lcl/cost-group/update', AuditEvent.SHIPMENT_UPDATED);

export const lclGroupingRoutes = Router();

lclGroupingRoutes.post(
  '/lcl/cost-group',
  declareMaterialWrite('shipments.lcl.cost-group', { method: 'POST', path: '/api/shipments/lcl/cost-group' }),
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const input = assignLclCostGroupSchema.parse(req.body);
    const actor = getUser(req);
    const result = await assignLclCostGroup(input, {
      userId: actor.userId,
      role: actor.role,
      actorName: actor.fullName ?? actor.username ?? undefined,
    });
    res.status(201).json(result);
  }),
);

lclGroupingRoutes.post(
  '/lcl/cost-group/update',
  declareMaterialWrite('shipments.lcl.cost-group-update', { method: 'POST', path: '/api/shipments/lcl/cost-group/update' }),
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const input = updateLclCostGroupSchema.parse(req.body);
    const actor = getUser(req);
    const result = await updateLclCostGroup(input, {
      userId: actor.userId,
      role: actor.role,
      actorName: actor.fullName ?? actor.username ?? undefined,
    });
    res.json(result);
  }),
);

lclGroupingRoutes.post(
  '/lcl/rev-group',
  declareMaterialWrite('shipments.lcl.rev-group', { method: 'POST', path: '/api/shipments/lcl/rev-group' }),
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const input = mergeLclRevGroupSchema.parse(req.body);
    const actor = getUser(req);
    const result = await mergeLclRevGroup(input, {
      userId: actor.userId,
      role: actor.role,
      actorName: actor.fullName ?? actor.username ?? undefined,
    });
    res.status(201).json(result);
  }),
);

lclGroupingRoutes.post(
  '/lcl/rev-class',
  declareMaterialWrite('shipments.lcl.rev-class', { method: 'POST', path: '/api/shipments/lcl/rev-class' }),
  // Same roles as the rev-group merge: this is the CUS half of cước thu.
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const input = setLclLotRevClassSchema.parse(req.body);
    const actor = getUser(req);
    const result = await setLclLotRevClass(input, {
      userId: actor.userId,
      role: actor.role,
      actorName: actor.fullName ?? actor.username ?? undefined,
    });
    res.json(result);
  }),
);

lclGroupingRoutes.post(
  '/lcl/unmerge',
  declareMaterialWrite('shipments.lcl.unmerge', { method: 'POST', path: '/api/shipments/lcl/unmerge' }),
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.CUS, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const input = unmergeLclLotSchema.parse(req.body);
    const actor = getUser(req);
    const result = await unmergeLclLot(input, {
      userId: actor.userId,
      role: actor.role,
      actorName: actor.fullName ?? actor.username ?? undefined,
    });
    res.json(result);
  }),
);

lclGroupingRoutes.post(
  '/lcl/unmerge-group',
  declareMaterialWrite('shipments.lcl.unmerge-group', { method: 'POST', path: '/api/shipments/lcl/unmerge-group' }),
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.CUS, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const input = unmergeLclGroupSchema.parse(req.body);
    const actor = getUser(req);
    const result = await unmergeLclGroup(input, {
      userId: actor.userId,
      role: actor.role,
      actorName: actor.fullName ?? actor.username ?? undefined,
    });
    res.json(result);
  }),
);

lclGroupingRoutes.post(
  '/lcl/truck',
  declareMaterialWrite('shipments.lcl.truck', { method: 'POST', path: '/api/shipments/lcl/truck' }),
  requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.CUS, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const input = updateLclTruckSchema.parse(req.body);
    const actor = getUser(req);
    const result = await updateLclGroupTruck(input, {
      userId: actor.userId,
      role: actor.role,
      actorName: actor.fullName ?? actor.username ?? undefined,
    });
    res.json(result);
  }),
);
