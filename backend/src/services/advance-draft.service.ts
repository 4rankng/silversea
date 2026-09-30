import { and, eq, notInArray } from 'drizzle-orm';
import { Role, TxnType, createAdvanceRequestSchema } from '@tingting/shared';
import * as s from '../db/schema';
import { acquireAdvisoryLock, lockKeys } from './advisory-lock.service';
import type { Tx } from './trip-shared';
import { ApiError } from '../errors';

/** Explicit recovery of unposted legacy drafts, plus the owner's withdrawal of an unfunded recorded request (which is not yet financial history); everything else stays immutable. */
export async function resolveAdvanceDraft(tx: Tx, input: {
  id: number; action: 'record' | 'void'; expectedVersion: number;
  actorId: number; actorRole: Role; resolutionReason: string;
  amount?: number; reason?: string;
}) {
  const office = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT].includes(input.actorRole);
  if (!office && input.actorRole !== Role.OPS) throw new ApiError(403, 'Bạn không có quyền xử lý tạm ứng.');
  // Match settlement source-claim locks, then freeze the source version.
  await acquireAdvisoryLock(tx, lockKeys.advance(input.id));
  const [before] = await tx.select().from(s.advanceRequests).where(eq(s.advanceRequests.id, input.id)).for('update');
  if (!before || (!office && before.requesterId !== input.actorId)) throw new ApiError(404, 'Không tìm thấy tạm ứng của bạn.');
  // Pre-demo audit: the OPS create path writes RECORDED (advance-request.service
  // `createAdvanceRequest` — "Record the request directly without approval"), so
  // a DRAFT-only guard made an OPS's own just-created request impossible to
  // withdraw: the UI rendered nothing and the service refused. The OWNER may
  // void their own RECORDED request while no money has been funded and no
  // settlement claims it — both conditions are enforced below. Every other
  // status stays refused with the same message, and the office side keeps its
  // DRAFT-only rule.
  const ownerVoid = !office && input.action === 'void' && before.status === 'RECORDED';
  if (before.status !== 'DRAFT' && !ownerVoid) throw new ApiError(409, 'Chỉ tạm ứng chưa ghi sổ được xử lý.');
  if (before.version !== input.expectedVersion) throw new ApiError(409, 'Tạm ứng đã thay đổi. Tải lại trước khi tiếp tục.');
  // "Chưa giao tiền" is the whole licence for that withdrawal, and this ledger
  // row IS the funding record: `getAdvanceFundedAmounts` reads the same
  // OPS_ADVANCE entry plus its POSTED, un-reversed treasury movement, so
  // "funded > 0" implies this lookup finds a row. One check therefore covers
  // both, and it refuses rather than voiding money that actually moved.
  const [posted] = await tx.select({ id: s.ledger.id }).from(s.ledger).where(and(
    eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.txnId, input.id),
  )).limit(1);
  if (posted) throw new ApiError(409, 'Tạm ứng đã có bút toán lịch sử. Cần đối chiếu sổ trước khi xử lý.');
  const [claimed] = await tx.select({ id: s.advanceSettlements.id }).from(s.advanceSettlementRequests)
    .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.advanceSettlementRequests.settlementId))
    .where(and(eq(s.advanceSettlementRequests.advanceRequestId, input.id), notInArray(s.advanceSettlements.status, ['VOIDED', 'REVERSED']))).limit(1);
  if (claimed) throw new ApiError(409, 'Tạm ứng đang gắn với phiếu hoàn ứng. Đối chiếu phiếu trước khi xử lý.');
  const resolutionReason = input.resolutionReason.trim();
  if (!resolutionReason || resolutionReason.length > 1000) throw new ApiError(400, 'Nhập lý do xử lý từ 1 đến 1.000 ký tự.');
  const values = input.action === 'record'
    ? createAdvanceRequestSchema.parse({ amount: input.amount, reason: input.reason?.trim() }) : null;
  if (values && (!Number.isSafeInteger(values.amount) || values.amount > 999_999_999_999_999 || values.reason.length > 1000)) {
    throw new ApiError(400, 'Số tiền phải là số nguyên dương hợp lệ; nội dung tối đa 1.000 ký tự.');
  }
  const [after] = await tx.update(s.advanceRequests).set({
    status: input.action === 'record' ? 'RECORDED' : 'VOIDED',
    ...(values ? { amount: String(values.amount), reason: values.reason, approvedBy: input.actorId, approvedAt: new Date() } : {}),
    version: before.version + 1, updatedAt: new Date(),
  }).where(eq(s.advanceRequests.id, input.id)).returning();
  // Recovering a request does not certify that money changed hands.
  const ledgerEntryId = null;
  await tx.insert(s.auditLogs).values({
    userId: input.actorId, entityType: 'advance-request-draft', entityId: input.id,
    message: input.action === 'record' ? 'Đã ghi sổ tạm ứng cũ'
      : before.status === 'DRAFT' ? 'Đã hủy tạm ứng chưa ghi sổ' : 'Đã hủy tạm ứng chưa giao tiền',
    payload: { action: input.action, actorRole: input.actorRole, resolutionReason, before, after, ledgerEntryId },
  });
  return after!;
}
