// Shipment POD leaf — e-POD review and file download.
//
// `GET /:id/pod-files/:fileId` streams a stored POD attachment;
// `POST /:id/pod-reviews/:submissionId/review` is the CUS clerk's
// ACCEPT/REJECT decision on a driver's e-POD submission.

import { Router } from 'express';
import { Role } from '@tingting/shared';
import { z } from 'zod';
import type { Request, Response } from 'express';
import {
  downloadShipmentPodFile,
  reviewTripPodSubmission,
} from '../../services/shipment.service';
import { attachmentDisposition } from '../../services/statement.service';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { throwValidation } from '../../lib/validation';
import { parseId, requireShipmentIdempotencyKey } from './shipment-shared';

const reviewTripPodSchema = z.object({
  expectedVersion: z.number().int().positive(),
  resolution: z.enum(['ACCEPT', 'REJECT']),
  rejectionReason: z.string().trim().max(2_000).optional().nullable(),
  // O2C C1: required when ACCEPT — confirms the accountant has the paper POD.
  podRecovered: z.boolean().optional(),
});

const podRoutes = Router();

podRoutes.get(
  '/:id/pod-files/:fileId',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const fileId = parseInt(req.params.fileId as string, 10);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      res.status(400).json({ error: 'ID tệp e-POD không hợp lệ' });
      return;
    }
    const file = await downloadShipmentPodFile(shipmentId, fileId, getUser(req));
    res.type(file.mimeType);
    res.setHeader('Content-Disposition', attachmentDisposition(file.originalFileName));
    res.send(file.buffer);
  }),
);

podRoutes.post(
  '/:id/pod-reviews/:submissionId/review',
  requireRoles(Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const submissionId = parseInt(req.params.submissionId as string, 10);
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      res.status(400).json({ error: 'ID e-POD không hợp lệ' });
      return;
    }
    const parsed = reviewTripPodSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const actor = getUser(req);
    const idempotencyKey = requireShipmentIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi duyệt e-POD.');
    const reviewed = await reviewTripPodSubmission({
      shipmentId,
      submissionId,
      expectedVersion: parsed.data.expectedVersion,
      resolution: parsed.data.resolution,
      rejectionReason: parsed.data.rejectionReason ?? null,
      idempotencyKey,
      actor,
      podRecovered: parsed.data.podRecovered ?? false,
    });
    res.locals.auditEntityId = reviewed.shipment.id;
    res.locals.auditEntityKey = reviewed.shipment.shipmentCode ?? "Lô hàng chưa có mã";
    res.json(reviewed);
  }),
);

export { podRoutes };
