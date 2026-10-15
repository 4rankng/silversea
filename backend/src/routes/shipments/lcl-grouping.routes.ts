// Shipment LCL grouping leaf (FB-092) — cost group commands.
//
// One POST endpoint (no DELETE: the /api/shipments mount maps DELETE to
// casbin's `delete` action, which only ADMIN/MANAGER hold — DISPATCHER must be
// able to group their own lots, so the command is a POST, matching the house
// pattern of action-shaped POSTs like /:id/lock).
//
//   POST /api/shipments/lcl/cost-group — dispatch "Gán xe nhóm" (FB-092)
// The REV group command (FB-093) and the un-merge safety command (FB-095)
// land on this same leaf.

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  assignLclCostGroupSchema,
  Role,
} from '@tingting/shared';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { declareMaterialWrite } from '../../middleware/material-write';
import { assignLclCostGroup } from '../../services/lcl-grouping.service';

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
