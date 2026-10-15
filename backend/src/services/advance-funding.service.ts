import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { TxnType, round2dp, type Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { runInTx } from '../lib/tx';
import { ApiError } from '../errors';
import { LedgerService } from './ledger.service';
import { insertTreasuryMovement, resolveTreasuryPaymentContract } from './treasury.service';
import { acquireAdvisoryLock, lockKeys } from './advisory-lock.service';

/** A request/status is not cash. Read funded principal from the existing cash book. */
export async function getAdvanceFundedAmounts(executor: Tx | typeof db, requestIds: readonly number[], asOfDate?: string): Promise<Map<number, number>> {
  if (!requestIds.length) return new Map();
  const movements = await executor.select({ requestId: s.advanceRequests.id, id: s.treasuryMovements.id, amount: s.treasuryMovements.amount })
    .from(s.advanceRequests)
    .innerJoin(s.ledger, and(eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.txnId, s.advanceRequests.id),
      eq(s.ledger.entityType, 'FORWARDER'), eq(s.ledger.entityId, s.advanceRequests.requesterId)))
    .innerJoin(s.treasuryMovements, and(eq(s.treasuryMovements.ledgerEntryId, s.ledger.id),
      eq(s.treasuryMovements.direction, 'OUT'), eq(s.treasuryMovements.status, 'POSTED'), isNull(s.treasuryMovements.reversalOfId)))
    .where(and(inArray(s.advanceRequests.id, [...requestIds]), asOfDate ? lte(s.treasuryMovements.valueDate, asOfDate) : undefined));
  const reversals = movements.length ? await executor.select({ originalId: s.treasuryMovements.reversalOfId, amount: s.treasuryMovements.amount })
    .from(s.treasuryMovements).where(and(inArray(s.treasuryMovements.reversalOfId, movements.map(row => row.id)), eq(s.treasuryMovements.status, 'POSTED'), asOfDate ? lte(s.treasuryMovements.valueDate, asOfDate) : undefined)) : [];
  const result = new Map<number, number>();
  for (const movement of movements) {
    const refunded = reversals.filter(row => row.originalId === movement.id).reduce((total, row) => total + Number(row.amount), 0);
    result.set(movement.requestId, round2dp((result.get(movement.requestId) ?? 0) + Number(movement.amount) - refunded));
  }
  return result;
}

/**
 * Khoản chi tạm ứng một chạm (KP-148): duyệt = giải ngân. Vì body duyệt chỉ
 * mang expectedVersion nên chứng từ quỹ được hệ thống suy ra, không hỏi tay:
 * tiền tạm ứng chi từ tài khoản nguồn quỹ công ty (fundCode COMPANY) đang hoạt
 * động — thấp nhất theo id để kết quả tất định khi quỹ có nhiều tài khoản.
 * Chưa có tài khoản quỹ thì từ chối rõ ràng (409), không bịa chứng từ.
 */
async function resolveDisbursementAccount(tx: Tx): Promise<number> {
  const [account] = await tx.select({ id: s.treasuryAccounts.id })
    .from(s.treasuryAccounts)
    .where(and(eq(s.treasuryAccounts.status, 'ACTIVE'), eq(s.treasuryAccounts.fundCode, 'COMPANY')))
    .orderBy(asc(s.treasuryAccounts.id))
    .limit(1);
  if (!account) {
    throw new ApiError(409, 'Chưa có tài khoản quỹ công ty đang hoạt động để giải ngân tạm ứng. Cấu hình Sổ quỹ / ngân hàng trước khi phê duyệt.');
  }
  return account.id;
}

/** Ngày giá trị theo lịch Việt Nam — cùng cách seed tính ngày giao nhận tiền. */
function businessDateVN(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export interface AdvanceFunding { ledgerEntryId: number; treasuryMovementId: number; }

/**
 * Ghi CẶP TIỀN của một khoản tạm ứng được cấp: bút toán OPS_ADVANCE + dòng
 * treasury OUT (đúng cấu trúc `recordFundedOpsAdvance` vẫn ghi cho đường ghi
 * chi tạm ứng có chọn quỹ). Chỉ gọi từ lệnh phê duyệt — mọi kiểm tra trạng thái
 * nằm ở `approveAdvanceRequest`.
 */
export async function fundAdvance(tx: Tx, actor: { userId: number }, advance: {
  id: number; requesterId: number; amount: number; reason: string; version: number;
}): Promise<AdvanceFunding> {
  const [existing] = await tx.select({ id: s.ledger.id }).from(s.ledger).where(and(
    eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.txnId, advance.id),
    eq(s.ledger.entityType, 'FORWARDER'), eq(s.ledger.entityId, advance.requesterId),
  )).limit(1);
  if (existing) throw new ApiError(409, 'Tạm ứng đã có bút toán lịch sử. Cần đối chiếu sổ trước khi ghi tiền.');
  const ledger = await LedgerService.postEntry(tx, {
    txnType: TxnType.OPS_ADVANCE, txnId: advance.id,
    entityType: 'FORWARDER', entityId: advance.requesterId,
    debit: 0, credit: advance.amount,
    note: `Phê duyệt tạm ứng: ${advance.reason}`,
  });
  const treasuryAccountId = await resolveDisbursementAccount(tx);
  // Lệnh duyệt là sự kiện giải ngân: tham chiếu sinh ra từ chính yêu cầu
  // (duy nhất theo chỉ mục POSTED của treasury_movements), ngày giao nhận là
  // ngày duyệt.
  const valueDate = businessDateVN();
  const physicalReference = `TU-${advance.id}-${Date.now()}`.slice(0, 160);
  const treasury = await resolveTreasuryPaymentContract(tx, { treasuryAccountId, valueDate, physicalReference }, new Date());
  if (!treasury.treasuryAccountId || !treasury.valueDate || !treasury.physicalReference) {
    throw new ApiError(409, 'Khoản ứng chưa có nguồn tiền hợp lệ.');
  }
  const movement = await insertTreasuryMovement(tx, {
    treasuryAccountId: treasury.treasuryAccountId, direction: 'OUT', amount: advance.amount,
    valueDate: treasury.valueDate, physicalReference: treasury.physicalReference,
    ledgerEntryId: ledger.id, sourceVersion: advance.version,
    paymentContractVersion: treasury.paymentContractVersion, createdBy: actor.userId,
  });
  return { ledgerEntryId: ledger.id, treasuryMovementId: movement.id };
}

export interface AdvanceApprovalResult {
  id: number; status: string; version: number;
  approvedBy: number | null; approvedAt: Date | null;
  funding?: AdvanceFunding;
}

/**
 * Kế toán phê duyệt yêu cầu tạm ứng đang chờ (PENDING → RECORDED) và tiền được
 * ghi vào quỹ ngay trong cùng transaction (ledger + treasury OUT). Chỉ nhận
 * đúng trạng thái chờ; đã xử lý ở nơi khác thì 409 để double-click/hai tab cũ
 * không ghi tiền hai lần.
 */
export async function approveAdvanceRequest(
  id: number,
  input: { expectedVersion: number },
  actor: { userId: number; role: Role | string },
  transaction?: Tx,
): Promise<AdvanceApprovalResult> {
  const execute = async (tx: Tx) => {
    await acquireAdvisoryLock(tx, lockKeys.advance(id));
    const [before] = await tx.select().from(s.advanceRequests).where(eq(s.advanceRequests.id, id)).for('update');
    if (!before) throw new ApiError(404, 'Không tìm thấy yêu cầu tạm ứng.');
    if (before.status !== 'PENDING') throw new ApiError(409, 'Yêu cầu tạm ứng không còn chờ phê duyệt.');
    if (before.version !== input.expectedVersion) throw new ApiError(409, 'Yêu cầu tạm ứng đã thay đổi. Tải lại trước khi tiếp tục.');
    const [after] = await tx.update(s.advanceRequests).set({
      status: 'RECORDED', approvedBy: actor.userId, approvedAt: new Date(),
      version: before.version + 1, updatedAt: new Date(),
    }).where(eq(s.advanceRequests.id, id)).returning();
    const funding = await fundAdvance(tx, actor, {
      id, requesterId: before.requesterId, amount: Number(before.amount), reason: before.reason, version: after!.version,
    });
    await tx.insert(s.auditLogs).values({
      userId: actor.userId, entityType: 'advance_request', entityId: id,
      message: 'ADVANCE_REQUEST_APPROVED',
      payload: { before, after, ...funding },
    });
    return {
      id: after!.id, status: after!.status, version: after!.version,
      approvedBy: after!.approvedBy, approvedAt: after!.approvedAt, funding,
    };
  };
  return runInTx(transaction, execute);
}

/**
 * Từ chối yêu cầu tạm ứng đang chờ: PENDING → VOIDED kèm lý do (lưu cùng audit
 * log — advance_requests không có cột lý do từ chối và yêu cầu gốc giữ nguyên
 * nội dung). Cùng luật khóa / 409 như lệnh duyệt.
 */
export async function rejectAdvanceRequest(
  id: number,
  input: { expectedVersion: number; reason: string },
  actor: { userId: number; role: Role | string },
  transaction?: Tx,
): Promise<AdvanceApprovalResult> {
  const execute = async (tx: Tx) => {
    await acquireAdvisoryLock(tx, lockKeys.advance(id));
    const [before] = await tx.select().from(s.advanceRequests).where(eq(s.advanceRequests.id, id)).for('update');
    if (!before) throw new ApiError(404, 'Không tìm thấy yêu cầu tạm ứng.');
    if (before.status !== 'PENDING') throw new ApiError(409, 'Yêu cầu tạm ứng không còn chờ phê duyệt.');
    if (before.version !== input.expectedVersion) throw new ApiError(409, 'Yêu cầu tạm ứng đã thay đổi. Tải lại trước khi tiếp tục.');
    const reason = input.reason.trim();
    if (!reason || reason.length > 500) throw new ApiError(400, 'Nhập lý do từ chối từ 1 đến 500 ký tự.');
    const [after] = await tx.update(s.advanceRequests).set({
      status: 'VOIDED', version: before.version + 1, updatedAt: new Date(),
    }).where(eq(s.advanceRequests.id, id)).returning();
    await tx.insert(s.auditLogs).values({
      userId: actor.userId, entityType: 'advance_request', entityId: id,
      message: 'ADVANCE_REQUEST_REJECTED',
      payload: { before, after, reason },
    });
    return {
      id: after!.id, status: after!.status, version: after!.version,
      approvedBy: after!.approvedBy, approvedAt: after!.approvedAt,
    };
  };
  return runInTx(transaction, execute);
}
