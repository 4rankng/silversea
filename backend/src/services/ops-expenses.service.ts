/**
 * Ops cash expenses (docs/prd/OpsVanHanh.md §3.3, §5.3): context-first entry
 * per lô, receipt photos, author-scoped edits, accounting decisions, and the
 * pure grouping used by settlements + exports.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, desc, eq, exists, inArray, isNull, ne, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import { storageService } from './storage.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type OpsExpenseDecision = 'APPROVED' | 'REJECTED';

export interface CreateOpsExpenseInput {
  shipmentId: number;
  shipmentContainerId?: number | null;
  expenseTypeCode: string;
  amount: string | number;
  paidAt: string; // YYYY-MM-DD
  note?: string | null;
  photoStorageKeys?: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseOpsMoney(value: string | number, field = 'Số tiền'): bigint {
  const isNumericString = typeof value === 'string' && /^\d+$/.test(value.trim());
  const isInt = typeof value === 'number' && Number.isInteger(value);
  if (!isNumericString && !isInt) {
    throw new ApiError(400, `${field} phải là số nguyên dương (VND, không phân tách thập phân).`);
  }
  const amount = BigInt(typeof value === 'number' ? value : value.trim());
  if (amount <= 0n) throw new ApiError(400, `${field} phải lớn hơn 0.`);
  if (amount > 999_999_999_999_999n) throw new ApiError(400, `${field} vượt quá giới hạn.`);
  return amount;
}

export function assertValidPaidAt(value: string): void {
  if (!DATE_RE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new ApiError(400, 'Ngày chi không hợp lệ (YYYY-MM-DD).');
  }
}

async function assertActiveExpenseType(code: string): Promise<{ requiresInvoice: boolean | null }> {
  const [type] = await db
    .select({ requiresInvoice: s.forwarderExpenseTypes.requiresInvoice })
    .from(s.forwarderExpenseTypes)
    .where(and(
      eq(s.forwarderExpenseTypes.code, code),
      eq(s.forwarderExpenseTypes.status, 'ACTIVE'),
      isNull(s.forwarderExpenseTypes.deletedAt),
    ))
    .limit(1);
  if (!type) throw new ApiError(400, `Loại phí "${code}" không hợp lệ hoặc đã dừng hoạt động.`);
  return type;
}

async function assertContainerInShipment(shipmentId: number, containerId: number): Promise<void> {
  const [container] = await db
    .select({ shipmentId: s.shipmentContainers.shipmentId })
    .from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.id, containerId))
    .limit(1);
  if (!container) throw new ApiError(404, 'Không tìm thấy vỏ container.');
  if (container.shipmentId !== shipmentId) {
    throw new ApiError(400, 'Vỏ container không thuộc lô hàng này.');
  }
}

/** Author-owned and still editable: not approved, not frozen in a settlement. */
async function getEditableExpense(userId: number, expenseId: number) {
  const [entry] = await db
    .select()
    .from(s.opsExpenseEntries)
    .where(eq(s.opsExpenseEntries.id, expenseId))
    .limit(1);
  if (!entry || entry.paidById !== userId) throw new ApiError(404, 'Không tìm thấy khoản chi.');
  if (entry.approvalStatus === 'APPROVED') {
    throw new ApiError(400, 'Khoản chi đã duyệt bị khóa, không thể chỉnh sửa.');
  }
  if (entry.opsSettlementId != null) {
    throw new ApiError(400, 'Khoản chi đã nằm trong đề nghị thanh toán, không thể chỉnh sửa.');
  }
  return entry;
}

async function attachPhotoRows(
  executor: Executor,
  expenseId: number,
  uploadedById: number,
  storageKeys: string[],
): Promise<void> {
  const unique = [...new Set(storageKeys.filter((key) => key && key.trim()))];
  if (unique.length === 0) return;
  for (const key of unique) assertOwnStorageKey(uploadedById, key);
  await executor
    .insert(s.opsExpensePhotos)
    .values(unique.map((storageKey) => ({
      opsExpenseId: expenseId,
      storageKey,
      uploadedById,
    })))
    .onConflictDoNothing();
}

/** Ops receipt keys are `ops-expense-photos/<uploader-uid>/<sha256>.<ext>` —
 *  the uid segment must be the caller so the photo gate can't be satisfied
 *  with another pipeline's (or another user's) object. */
const OPS_PHOTO_KEY_RE = /^ops-expense-photos\/(\d+)\/[0-9a-f]{32}\.(jpg|png)$/;
export function assertOwnStorageKey(userId: number, key: string): void {
  const match = key.match(OPS_PHOTO_KEY_RE);
  if (!match || Number(match[1]) !== userId) {
    throw new ApiError(400, 'Ảnh biên lai không hợp lệ.');
  }
}

export async function createOpsExpense(
  userId: number,
  input: CreateOpsExpenseInput,
  transaction?: Tx,
) {
  const executor: Executor = transaction ?? db;
  const amount = parseOpsMoney(input.amount);
  assertValidPaidAt(input.paidAt);
  await assertActiveExpenseType(input.expenseTypeCode);

  const [shipment] = await executor
    .select({ id: s.shipments.id })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');

  if (input.shipmentContainerId != null) {
    await assertContainerInShipment(input.shipmentId, input.shipmentContainerId);
  }

  const [entry] = await executor
    .insert(s.opsExpenseEntries)
    .values({
      shipmentId: input.shipmentId,
      shipmentContainerId: input.shipmentContainerId ?? null,
      expenseTypeCode: input.expenseTypeCode,
      amount: amount.toString(),
      paidById: userId,
      paidAt: input.paidAt,
      note: input.note?.trim() || null,
    })
    .returning();

  if (input.photoStorageKeys?.length) {
    await attachPhotoRows(executor, entry.id, userId, input.photoStorageKeys);
  }
  return entry;
}

export async function updateOpsExpense(
  userId: number,
  expenseId: number,
  patch: Partial<Pick<CreateOpsExpenseInput,
    'amount' | 'paidAt' | 'note' | 'shipmentContainerId' | 'expenseTypeCode'>> & {
    shipmentContainerId?: number | null;
  },
  transaction?: Tx,
) {
  const executor: Executor = transaction ?? db;
  const entry = await getEditableExpense(userId, expenseId);
  const next: Record<string, unknown> = { updatedAt: new Date() };

  if (patch.amount !== undefined) {
    next.amount = parseOpsMoney(patch.amount).toString();
  }
  if (patch.paidAt !== undefined) {
    assertValidPaidAt(patch.paidAt);
    next.paidAt = patch.paidAt;
  }
  if (patch.note !== undefined) next.note = patch.note?.trim() || null;
  if (patch.expenseTypeCode !== undefined && patch.expenseTypeCode !== entry.expenseTypeCode) {
    await assertActiveExpenseType(patch.expenseTypeCode);
    next.expenseTypeCode = patch.expenseTypeCode;
  }
  if (patch.shipmentContainerId !== undefined) {
    if (patch.shipmentContainerId != null) {
      await assertContainerInShipment(entry.shipmentId, patch.shipmentContainerId);
    }
    next.shipmentContainerId = patch.shipmentContainerId;
  }

  // Conditional write: the pre-read above produces friendly field errors, but
  // the freeze/approve race is closed here — the update only lands while the
  // entry is still unlinked and not approved.
  const [updated] = await executor
    .update(s.opsExpenseEntries)
    .set(next)
    .where(and(
      eq(s.opsExpenseEntries.id, expenseId),
      eq(s.opsExpenseEntries.paidById, userId),
      ne(s.opsExpenseEntries.approvalStatus, 'APPROVED'),
      isNull(s.opsExpenseEntries.opsSettlementId),
    ))
    .returning();
  if (!updated) {
    throw new ApiError(409, 'Khoản chi vừa thay đổi trạng thái (duyệt / lập phiếu). Tải lại và thử lại.');
  }
  return updated;
}

export async function deleteOpsExpense(
  userId: number,
  expenseId: number,
  transaction?: Tx,
): Promise<void> {
  const executor: Executor = transaction ?? db;
  await getEditableExpense(userId, expenseId);
  const photos = await executor
    .select({ storageKey: s.opsExpensePhotos.storageKey })
    .from(s.opsExpensePhotos)
    .where(eq(s.opsExpensePhotos.opsExpenseId, expenseId));
  const [deleted] = await executor
    .delete(s.opsExpenseEntries)
    .where(and(
      eq(s.opsExpenseEntries.id, expenseId),
      eq(s.opsExpenseEntries.paidById, userId),
      ne(s.opsExpenseEntries.approvalStatus, 'APPROVED'),
      isNull(s.opsExpenseEntries.opsSettlementId),
    ))
    .returning({ id: s.opsExpenseEntries.id });
  if (!deleted) {
    throw new ApiError(409, 'Khoản chi vừa thay đổi trạng thái (duyệt / lập phiếu). Tải lại và thử lại.');
  }
  await executor.delete(s.opsExpensePhotos).where(eq(s.opsExpensePhotos.opsExpenseId, expenseId));
  await deleteStorageKeysIfUnreferenced(photos.map((photo) => photo.storageKey));
}

/**
 * The same uploaded object can back photo rows on two different expenses
 * (buffer-hash storage keys dedupe). Only remove the object once no row
 * references it anymore.
 */
async function deleteStorageKeysIfUnreferenced(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const rows = await db
    .select({ storageKey: s.opsExpensePhotos.storageKey })
    .from(s.opsExpensePhotos)
    .where(inArray(s.opsExpensePhotos.storageKey, keys));
  const stillReferenced = new Set(rows.map((row) => row.storageKey));
  await Promise.allSettled(
    keys
      .filter((key) => !stillReferenced.has(key))
      .map((key) => storageService.delete(key)),
  );
}

export async function attachOpsExpensePhoto(
  userId: number,
  expenseId: number,
  storageKey: string,
) {
  await getEditableExpense(userId, expenseId);
  assertOwnStorageKey(userId, storageKey);
  const [photo] = await db
    .insert(s.opsExpensePhotos)
    .values({ opsExpenseId: expenseId, storageKey, uploadedById: userId })
    .onConflictDoNothing()
    .returning();
  return photo ?? null;
}

export async function deleteOpsExpensePhoto(userId: number, photoId: number): Promise<void> {
  const [photo] = await db
    .select({
      id: s.opsExpensePhotos.id,
      storageKey: s.opsExpensePhotos.storageKey,
      paidById: s.opsExpenseEntries.paidById,
      approvalStatus: s.opsExpenseEntries.approvalStatus,
      opsSettlementId: s.opsExpenseEntries.opsSettlementId,
    })
    .from(s.opsExpensePhotos)
    .innerJoin(s.opsExpenseEntries, eq(s.opsExpenseEntries.id, s.opsExpensePhotos.opsExpenseId))
    .where(eq(s.opsExpensePhotos.id, photoId))
    .limit(1);
  if (!photo || photo.paidById !== userId) throw new ApiError(404, 'Không tìm thấy ảnh.');
  if (photo.approvalStatus === 'APPROVED') {
    throw new ApiError(400, 'Khoản chi đã duyệt bị khóa, không thể xóa ảnh.');
  }
  if (photo.opsSettlementId != null) {
    throw new ApiError(400, 'Khoản chi đã nằm trong đề nghị thanh toán, không thể xóa ảnh.');
  }
  await db.delete(s.opsExpensePhotos).where(eq(s.opsExpensePhotos.id, photoId));
  await deleteStorageKeysIfUnreferenced([photo.storageKey]);
}

export interface OpsExpensePhotoRow {
  id: number;
  storageKey: string;
  url: string;
  uploadedAt: string;
}

/** Photo list for receipt review — the author or any approver may read it. */
export async function listOpsExpensePhotos(
  userId: number,
  isApprover: boolean,
  expenseId: number,
): Promise<OpsExpensePhotoRow[]> {
  const [entry] = await db
    .select({ id: s.opsExpenseEntries.id, paidById: s.opsExpenseEntries.paidById })
    .from(s.opsExpenseEntries)
    .where(eq(s.opsExpenseEntries.id, expenseId))
    .limit(1);
  if (!entry || (!isApprover && entry.paidById !== userId)) {
    throw new ApiError(404, 'Không tìm thấy khoản chi.');
  }
  const photos = await db
    .select({
      id: s.opsExpensePhotos.id,
      storageKey: s.opsExpensePhotos.storageKey,
      uploadedAt: s.opsExpensePhotos.uploadedAt,
    })
    .from(s.opsExpensePhotos)
    .where(eq(s.opsExpensePhotos.opsExpenseId, expenseId))
    .orderBy(s.opsExpensePhotos.id);
  return photos.map((photo) => ({
    id: photo.id,
    storageKey: photo.storageKey,
    url: `/api/photos/${encodeURIComponent(photo.storageKey)}`,
    uploadedAt: photo.uploadedAt.toISOString(),
  }));
}

/** REJECTED → PENDING after the author re-attaches evidence (PRD §5.3 —
 *  resend without at least one receipt photo is refused). */
export async function resendOpsExpense(userId: number, expenseId: number, transaction?: Tx) {
  const executor: Executor = transaction ?? db;
  const [entry] = await executor
    .select()
    .from(s.opsExpenseEntries)
    .where(eq(s.opsExpenseEntries.id, expenseId))
    .limit(1);
  if (!entry || entry.paidById !== userId) throw new ApiError(404, 'Không tìm thấy khoản chi.');
  if (entry.approvalStatus !== 'REJECTED') {
    throw new ApiError(400, 'Chỉ khoản bị từ chối mới cần gửi lại.');
  }
  const [photo] = await executor
    .select({ id: s.opsExpensePhotos.id })
    .from(s.opsExpensePhotos)
    .where(eq(s.opsExpensePhotos.opsExpenseId, expenseId))
    .limit(1);
  if (!photo) {
    throw new ApiError(400, 'Cần bổ sung ảnh biên lai trước khi gửi lại.');
  }
  const [updated] = await executor
    .update(s.opsExpenseEntries)
    .set({ approvalStatus: 'PENDING', rejectionReason: null, updatedAt: new Date() })
    .where(and(
      eq(s.opsExpenseEntries.id, expenseId),
      eq(s.opsExpenseEntries.paidById, userId),
      eq(s.opsExpenseEntries.approvalStatus, 'REJECTED'),
      isNull(s.opsExpenseEntries.opsSettlementId),
    ))
    .returning();
  if (!updated) {
    throw new ApiError(409, 'Khoản chi vừa thay đổi trạng thái. Tải lại và thử lại.');
  }
  return updated;
}

/**
 * Accounting decision on a PENDING entry. Both branches use a conditional
 * write (`WHERE approval_status = 'PENDING'`) inside a transaction so a
 * concurrent settlement freeze can't interleave: whichever side takes the row
 * lock first wins, and the loser sees a 0-row update instead of corrupting
 * the batch. Approving requires at least one receipt photo (PRD §5.4 —
 * đỏ-tag entries cannot be approved); rejecting requires a reason and, when
 * the entry is frozen in a settlement, unlinks it and recomputes that
 * settlement's total so the batch stays consistent.
 */
export async function decideOpsExpense(
  approverId: number,
  expenseId: number,
  decision: OpsExpenseDecision,
  reason?: string,
  transaction?: Tx,
) {
  if (decision === 'APPROVED') {
    const [photo] = await db
      .select({ id: s.opsExpensePhotos.id })
      .from(s.opsExpensePhotos)
      .where(eq(s.opsExpensePhotos.opsExpenseId, expenseId))
      .limit(1);
    if (!photo) {
      throw new ApiError(400, 'Khoản chi chưa có ảnh biên lai — không thể duyệt.');
    }
    const run = async (tx: Tx) => {
      const [updated] = await tx
        .update(s.opsExpenseEntries)
        .set({
          approvalStatus: 'APPROVED',
          approvedById: approverId,
          approvedAt: new Date(),
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(s.opsExpenseEntries.id, expenseId),
          eq(s.opsExpenseEntries.approvalStatus, 'PENDING'),
        ))
        .returning();
      if (!updated) throw staleExpenseDecision(tx, expenseId);
      return updated;
    };
    return transaction ? run(transaction) : db.transaction(run);
  }

  const trimmed = reason?.trim();
  if (!trimmed) throw new ApiError(400, 'Cần lý do từ chối.');

  const run = async (tx: Tx) => {
    const [updated] = await tx
      .update(s.opsExpenseEntries)
      .set({ approvalStatus: 'REJECTED', rejectionReason: trimmed, updatedAt: new Date() })
      .where(and(
        eq(s.opsExpenseEntries.id, expenseId),
        eq(s.opsExpenseEntries.approvalStatus, 'PENDING'),
      ))
      .returning();
    if (!updated) throw staleExpenseDecision(tx, expenseId);
    // RETURNING carries the row's live link: if a settlement froze this entry
    // between the pre-check and now, the link is non-null and the entry must
    // leave the batch with the total recomputed.
    if (updated.opsSettlementId != null) {
      await tx
        .update(s.opsExpenseEntries)
        .set({ opsSettlementId: null, updatedAt: new Date() })
        .where(eq(s.opsExpenseEntries.id, expenseId));
      await recomputeOpsSettlementTotal(tx, updated.opsSettlementId);
    }
    return updated;
  };
  return transaction ? run(transaction) : db.transaction(run);
}

/** Distinguish 404 from an already-decided entry after a 0-row update. */
async function staleExpenseDecision(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  expenseId: number,
): Promise<never> {
  const [row] = await tx
    .select({ id: s.opsExpenseEntries.id })
    .from(s.opsExpenseEntries)
    .where(eq(s.opsExpenseEntries.id, expenseId))
    .limit(1);
  if (!row) throw new ApiError(404, 'Không tìm thấy khoản chi.');
  throw new ApiError(400, 'Chỉ khoản đang chờ duyệt mới được xử lý.');
}

/** Sum of the still-linked entries; used after rejects unlink entries. */
export async function recomputeOpsSettlementTotal(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  settlementId: number,
): Promise<void> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${s.opsExpenseEntries.amount}), 0)` })
    .from(s.opsExpenseEntries)
    .where(eq(s.opsExpenseEntries.opsSettlementId, settlementId));
  await tx
    .update(s.opsSettlements)
    .set({ totalAmount: (row?.total ?? '0').toString(), updatedAt: new Date() })
    .where(eq(s.opsSettlements.id, settlementId));
}

/** Active expense-type catalog for the OPS declaration form (grouped by
 * requires_invoice on the client). Scoped copy of the config catalog so OPS
 * needs no config:read grant. */
export async function listActiveOpsExpenseTypes(): Promise<Array<{
  id: number;
  code: string;
  name: string;
  requiresInvoice: boolean | null;
}>> {
  return db
    .select({
      id: s.forwarderExpenseTypes.id,
      code: s.forwarderExpenseTypes.code,
      name: s.forwarderExpenseTypes.name,
      requiresInvoice: s.forwarderExpenseTypes.requiresInvoice,
    })
    .from(s.forwarderExpenseTypes)
    .where(and(
      eq(s.forwarderExpenseTypes.status, 'ACTIVE'),
      isNull(s.forwarderExpenseTypes.deletedAt),
    ))
    .orderBy(s.forwarderExpenseTypes.name);
}

export interface OpsExpenseListRow {
  id: number;
  shipmentId: number;
  shipmentCode: string | null;
  containerNumber: string | null;
  expenseTypeCode: string;
  expenseTypeName: string | null;
  requiresInvoice: boolean | null;
  amount: string;
  paidAt: string;
  note: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  opsSettlementId: number | null;
  hasPhoto: boolean;
  paidById: number;
  paidByName: string | null;
  createdAt: string;
}

export async function listOpsExpenses(filters: {
  paidById?: number;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  settlementId?: number;
  limit?: number;
  offset?: number;
}): Promise<OpsExpenseListRow[]> {
  const conditions = [];
  if (filters.paidById != null) {
    conditions.push(eq(s.opsExpenseEntries.paidById, filters.paidById));
  }
  if (filters.status) conditions.push(eq(s.opsExpenseEntries.approvalStatus, filters.status));
  if (filters.settlementId != null) {
    conditions.push(eq(s.opsExpenseEntries.opsSettlementId, filters.settlementId));
  }

  const rows = await db
    .select({
      id: s.opsExpenseEntries.id,
      shipmentId: s.opsExpenseEntries.shipmentId,
      shipmentCode: s.shipments.shipmentCode,
      containerNumber: s.shipmentContainers.containerNumber,
      expenseTypeCode: s.opsExpenseEntries.expenseTypeCode,
      expenseTypeName: s.forwarderExpenseTypes.name,
      requiresInvoice: s.forwarderExpenseTypes.requiresInvoice,
      amount: s.opsExpenseEntries.amount,
      paidAt: s.opsExpenseEntries.paidAt,
      note: s.opsExpenseEntries.note,
      approvalStatus: s.opsExpenseEntries.approvalStatus,
      rejectionReason: s.opsExpenseEntries.rejectionReason,
      opsSettlementId: s.opsExpenseEntries.opsSettlementId,
      paidById: s.opsExpenseEntries.paidById,
      paidByName: s.users.fullName,
      createdAt: s.opsExpenseEntries.createdAt,
      hasPhoto: exists(
        db.select({ one: sql`1` }).from(s.opsExpensePhotos)
          .where(eq(s.opsExpensePhotos.opsExpenseId, s.opsExpenseEntries.id)),
      ),
    })
    .from(s.opsExpenseEntries)
    .leftJoin(s.shipments, eq(s.shipments.id, s.opsExpenseEntries.shipmentId))
    .leftJoin(
      s.shipmentContainers,
      eq(s.shipmentContainers.id, s.opsExpenseEntries.shipmentContainerId),
    )
    .leftJoin(
      s.forwarderExpenseTypes,
      eq(s.forwarderExpenseTypes.code, s.opsExpenseEntries.expenseTypeCode),
    )
    .leftJoin(s.users, eq(s.users.id, s.opsExpenseEntries.paidById))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(s.opsExpenseEntries.paidAt), desc(s.opsExpenseEntries.id))
    .limit(filters.limit ?? 100)
    .offset(filters.offset ?? 0);

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    hasPhoto: Boolean(row.hasPhoto),
  }));
}

// ─── Settlement grouping (pure, shared with export) ──────────────────────────

export interface SettlementExpenseInput {
  shipmentId: number;
  shipmentCode: string | null;
  customerName: string | null;
  billRef: string | null;
  containerNumber: string | null;
  expenseTypeName: string | null;
  requiresInvoice: boolean | null;
  amount: string;
  approvalStatus: string;
}

export interface SettlementGroup {
  shipmentId: number;
  shipmentCode: string | null;
  customerName: string | null;
  billRef: string | null;
  withInvoice: { items: SettlementExpenseInput[]; total: string };
  withoutInvoice: { items: SettlementExpenseInput[]; total: string };
  total: string;
}

export interface SettlementGrouping {
  groups: SettlementGroup[];
  totals: { withInvoice: string; withoutInvoice: string; grand: string };
}

function sumBig(values: string[]): bigint {
  return values.reduce((acc, value) => acc + BigInt(value || '0'), 0n);
}

/**
 * Group settlement entries by lô and split each lô into the two invoice
 * baskets (Có hóa đơn / Không hóa đơn) per `requires_invoice` of the expense
 * type — PRD §5.4's "Phân loại Cột tự động". Pure so the export and the
 * preview share one tested implementation.
 */
export function groupOpsExpensesForSettlement(
  entries: readonly SettlementExpenseInput[],
): SettlementGrouping {
  const byShipment = new Map<number, SettlementGroup>();
  for (const entry of entries) {
    let group = byShipment.get(entry.shipmentId);
    if (!group) {
      group = {
        shipmentId: entry.shipmentId,
        shipmentCode: entry.shipmentCode,
        customerName: entry.customerName,
        billRef: entry.billRef,
        withInvoice: { items: [], total: '0' },
        withoutInvoice: { items: [], total: '0' },
        total: '0',
      };
      byShipment.set(entry.shipmentId, group);
    }
    const basket = entry.requiresInvoice ? group.withInvoice : group.withoutInvoice;
    basket.items.push(entry);
    basket.total = (BigInt(basket.total) + BigInt(entry.amount || '0')).toString();
    group.total = (BigInt(group.total) + BigInt(entry.amount || '0')).toString();
  }

  const groups = [...byShipment.values()].sort((a, b) =>
    (a.shipmentCode ?? '').localeCompare(b.shipmentCode ?? ''));
  const withInvoice = sumBig(groups.map((group) => group.withInvoice.total));
  const withoutInvoice = sumBig(groups.map((group) => group.withoutInvoice.total));
  return {
    groups,
    totals: {
      withInvoice: withInvoice.toString(),
      withoutInvoice: withoutInvoice.toString(),
      grand: (withInvoice + withoutInvoice).toString(),
    },
  };
}
