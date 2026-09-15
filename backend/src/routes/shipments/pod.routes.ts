// Shipment POD leaf — e-POD file download. (The internal ACCEPT/REJECT
// review was removed: a saved submission is the evidence; customer
// acknowledgement stays a separate external flow.)

import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role } from '@tingting/shared';
import { downloadShipmentPodFile } from '../../services/shipment.service';
import { attachmentDisposition } from '../../services/statement.service';
import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { parseId } from './shipment-shared';

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

export { podRoutes };
