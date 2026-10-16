// Shipment LCL grouping leaf (FB-092/093) — cost/rev group commands.
//
// POST endpoints (no DELETE: the /api/shipments mount maps DELETE to casbin's
// `delete` action, which only ADMIN/MANAGER hold — CUS and DISPATCHER must be
// able to manage their own groups, so these are POST commands, matching the
// house pattern of action-shaped POSTs like /:id/lock).
//
//   POST /api/shipments/lcl/cost-group — dispatch "Gán xe nhóm" (FB-092)
//   POST /api/shipments/lcl/rev-group  — CUS "Ghép cước thu khách" (FB-093)
//   POST /api/shipments/lcl/rev-class  — CUS "Loại xe tính cước thu" của MỘT lô
//                                        chưa ghép (161026232349, §II.3.2)
//   POST /api/shipments/lcl/truck      — BKS quick-edit from settlement
//   POST /api/shipments/lcl/unmerge    — one lot leaves a dimension (FB-095)

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  assignLclCostGroupSchema,
  mergeLclRevGroupSchema,
  setLclLotRevClassSchema,
  unmergeLclLotSchema,
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
  mergeLclRevGroup,
  setLclLotRevClass,
  unmergeLclLot,
  updateLclGroupTruck,
} from '../../services/lcl-grouping.service';

// 161026232349 — the request-level audit label for the single-lot class
// command; the service's own `auditGroupChange` record stays the authority.
registerAuditEvent('POST', '/api/shipments/lcl/rev-class', AuditEvent.SHIPMENT_UPDATED);

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
