import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@tingting/shared';
import { getUser } from '../../middleware/auth';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { ApiError } from '../../errors';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';
import { resolveAdvanceDraft } from '../../services/advance-draft.service';
import { AuditEvent } from '../../services/audit-types';

const router = Router();
const schema = z.object({
  expectedVersion: z.number().int().positive(), resolutionReason: z.string().trim().min(1).max(1000),
  amount: z.number().int().positive().max(999_999_999_999_999).optional(),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict();

function advanceDraftWriteCommand(action: 'record' | 'void') {
  return asyncHandler(async (req, res) => {
    const actor = getUser(req);
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const data = schema.parse(req.body);
    if (action === 'record' && (data.amount === undefined || data.reason === undefined)) throw new ApiError(400, 'Nhập số tiền và nội dung tạm ứng.');
    const idempotencyKey = getRequestIdempotencyKey(req);
    if (!idempotencyKey) throw new ApiError(400, 'Thiếu mã thao tác. Vui lòng thử lại.');
    const input = { id, action, ...data, actorId: actor.userId, actorRole: actor.role };
    res.locals.auditEvent = AuditEvent.ENTITY_UPDATED;
    const outcome = await runIdempotent({
      endpoint: action === 'record' ? IDEMPOTENCY_ENDPOINTS.ADVANCE_DRAFT_RECORD : IDEMPOTENCY_ENDPOINTS.ADVANCE_DRAFT_VOID,
      idempotencyKey, payload: input, createdBy: actor.userId, entityType: 'advance_request',
      create: tx => resolveAdvanceDraft(tx, input), getEntityId: row => row.id,
    });
    res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
  });
}
const access = requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.OPS);
router.post('/advance-requests/:id/record', access, advanceDraftWriteCommand('record'));
router.post('/advance-requests/:id/void', access, advanceDraftWriteCommand('void'));
export default router;
