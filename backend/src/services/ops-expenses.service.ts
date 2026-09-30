/**
 * Ops cash expenses (docs/prd/OpsVanHanh.md §3.3, §5.3): context-first entry
 * per lô, receipt photos, author-scoped edits, accounting decisions, and the
 * pure grouping used by settlements + exports.
 */
import { listLegacyOpsExpenseHistory } from './ops-legacy-expense-history.service';
import { db } from '../db';
import * as s from '../db/schema';
import { and, desc, eq, exists, inArray, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import { storageService } from './storage.service';
import { opsInvoicedCostGroupOf, type ExpenseCostGroup } from '@tingting/shared';
import { upsertExpenseAccountingSource, lockExpenseSource, assertExpenseSourceMutable, receivableForDerivedCharge, assertReceivableNotNegative } from './expense-accounting-source.service';
import { assertOpsExpenseAssignment } from './expense-owner-scope.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export interface CreateOpsExpenseInput {
  shipmentId: number;
  shipmentContainerId?: number | null;
  expenseTypeCode: string;
  amount: string | number;
  paidAt: string; // YYYY-MM-DD
  note?: string | null;
  photoStorageKeys?: string[];
  costGroup?: ExpenseCostGroup;
  feeName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  recoveryNote?: string | null;
  /** Card 20260921_5 — the Thực-thu side of the no-invoice pair. Invoice
   *  rows ignore it (charge = amount invariant). */
  customerChargeAmount?: string | number | null;
}
type OpsExpenseWriteResult = typeof s.opsExpenseEntries.$inferSelect & {
  version?: number; costGroup?: ExpenseCostGroup | null; feeName?: string | null; invoiceNumber?: string | null;
  invoiceDate?: string | null; customerChargeAmount?: string | null; recoveryNote?: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Card 20260928_197 — a SIGNED integer VND amount, the same contract
 *  `signedExpenseVndSchema` gives the shared layer (card 20260928_181): a cost
 *  row may carry a negative number, and every total that reads this column
 *  drops such a row via `sumExcludingNegative` instead of netting it against
 *  the positive rows. The magnitude ceiling is unchanged and symmetric, and 0
 *  stays rejected — 0 is an empty row, not a signed one. This is the BigInt
 *  mirror of the shared schema, so the value never touches a float. */
export function parseOpsMoney(value: string | number, field = 'Số tiền'): bigint {
  const text = typeof value === 'string' ? value.trim() : String(value);
  const isNumericString = typeof value === 'string' && /^-?\d+$/.test(text);
  const isInt = typeof value === 'number' && Number.isInteger(value);
  if (!isNumericString && !isInt) {
    throw new ApiError(400, `${field} phải là số nguyên (VND, không phân tách thập phân).`);
  }
  // `String(value)` is only safe for the string branch: a numeric literal
  // above 1e21 stringifies as `1e+21`, which BigInt cannot read, so the number
  // branch converts the value itself.
  const amount = BigInt(typeof value === 'number' ? value : text);
  if (amount === 0n) throw new ApiError(400, `${field} không được bằng 0.`);
  if (amount > 999_999_999_999_999n || amount < -999_999_999_999_999n) throw new ApiError(400, `${field} vượt quá giới hạn.`);
  return amount;
}

/**
 * Card 20260928_197 — the receivable for an Ops cost line. Delegates the rule to
 * `receivableForDerivedCharge` / `assertReceivableNotNegative`, which sit
 * beside the unsigned `expenseVndSchema` guard they exist to satisfy; see the
 * reasoning there. This wrapper only decides WHICH side applies:
 *
 *  - an invoice group charges the amount (card 20260921_5's invariant), and
 *    that derived value is clamped at 0 once the amount is signed;
 *  - a no-invoice group takes the caller's override, defaulting to 0, and a
 *    negative override is refused by name.
 */
export function receivableForCost(
  amount: bigint | string | number,
  costGroup: string | null | undefined,
  override: string | number | null | undefined,
  field = 'Thực thu',
): number {
  if (typeof costGroup === 'string' && costGroup.startsWith('INVOICED_')) {
    return receivableForDerivedCharge(Number(amount));
  }
  if (override == null || override === '') return 0;
  return assertReceivableNotNegative(Number(override), field);
}

export function assertValidPaidAt(value: string): void {
  if (!DATE_RE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new ApiError(400, 'Ngày chi không hợp lệ (YYYY-MM-DD).');
  }
}

/** The active catalog row of a fee code, with the two fields the Ops side
 *  derives from: invoice-bearing (charge = amount) and the card 20260928_161
 *  settlement `category` (the Nâng / Hạ / Phí khác group). */
async function assertActiveExpenseType(code: string): Promise<{ requiresInvoice: boolean | null; category: string | null }> {
  const [type] = await db
    .select({ requiresInvoice: s.forwarderExpenseTypes.requiresInvoice, category: s.forwarderExpenseTypes.category })
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
async function getEditableExpense(userId: number, expenseId: number, executor: Executor = db) {
  const [entry] = await executor
    .select()
    .from(s.opsExpenseEntries)
    .where(eq(s.opsExpenseEntries.id, expenseId))
    .limit(1);
  if (!entry || entry.paidById !== userId) throw new ApiError(404, 'Không tìm thấy khoản chi.');
  if (entry.approvalStatus === 'VOIDED' || entry.approvalStatus === 'REJECTED') {
    throw new ApiError(400, 'Khoản chi đã hủy chỉ được xem trong lịch sử.');
  }
  if (entry.opsSettlementId != null) {
    throw new ApiError(400, 'Khoản chi đã nằm trong phiếu quyết toán, không thể chỉnh sửa.');
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
): Promise<OpsExpenseWriteResult> {
  if (!transaction) return db.transaction(tx => createOpsExpense(userId, input, tx));
  const executor: Executor = transaction ?? db;
  await assertOpsExpenseAssignment(transaction, userId, input.shipmentId);
  const amount = parseOpsMoney(input.amount);
  assertValidPaidAt(input.paidAt);
  const expenseType = await assertActiveExpenseType(input.expenseTypeCode);
  await assertShipmentAccountingUnlocked(transaction, input.shipmentId);

  const [shipment] = await executor
    .select({ id: s.shipments.id, customerId: s.shipments.customerId })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
  if (!shipment.customerId) throw new ApiError(409, 'Lô hàng chưa có khách hàng.');

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
      approvalStatus: 'RECORDED' as const,
    })
    .returning();

  if (input.photoStorageKeys?.length) {
    await attachPhotoRows(executor, entry.id, userId, input.photoStorageKeys);
  }
  // Card 20260928_161 — the derived group reads the catalog row's settlement
  // `category` (LIFT → Nâng, DROP → Hạ, rest → Phí khác) through the shared
  // rule, never the code: `LIFT_EMPTY` / `LIFT_CARGO` / `YARD_STORAGE_LIFT`
  // and the DROP equivalents used to fall into the INVOICED_OTHER catch-all
  // because only the legacy `LIFTING` / `LOWERING` codes were matched, which
  // diverged from the catalog's own category (and from the report columns /
  // `expenseFeeGroupOf` the admin surface shows). The SET of groups is
  // unchanged, so EXPENSE_COST_GROUPS and the voucher fund rule stand.
  const costGroup = input.costGroup ?? (expenseType.requiresInvoice
    ? opsInvoicedCostGroupOf(expenseType.category)
    : 'OPS_REGULAR');
  if (!['INVOICED_LIFT', 'INVOICED_DROP', 'INVOICED_OTHER', 'OPS_REGULAR', 'OPS_INCIDENTAL'].includes(costGroup)) throw new ApiError(400, 'Nhóm chi phí Ops không hợp lệ.');
  // Card 20260921_5 — the no-invoice pair's Thực-thu side. Invoice rows keep
  // charge = amount; no-invoice rows take the caller's override (0 default).
  //
  // Card 20260928_197 — through `receivableForCost`, because "charge = amount"
  // stopped being an identity once the amount became signed: a negative line
  // charges 0 rather than a negative receivable.
  const customerCharge = receivableForCost(entry.amount, costGroup, input.customerChargeAmount);

  // Card 20260928_162: a row that does NOT charge the customer must carry a
  // note saying why, and the SERVER enforces it.
  //
  // This was the criterion's whole point — "hệ thống chặn lưu khi thiếu (kiểm
  // bằng test, không chỉ bằng UI disable)" — and it was not enforced anywhere.
  // `note` was `z.string().max(1000).nullable().optional()` on the route, and
  // the service stored `input.note?.trim() || null`. Only the FORWARDER path
  // had the rule ("Lý do chi là bắt buộc khi không có hóa đơn"), which is a
  // different flow. So an uncharged Ops cost could be saved with the reason
  // blank, and kế toán / CUS then had nothing to read on the dispatch board.
  //
  // Placed AFTER customerCharge is computed, which is the only place the
  // "does this charge the customer" answer exists — invoice groups always
  // charge (charge = amount), so this bites only the no-invoice rows the PM
  // meant. The insert above is inside the caller's transaction, so throwing
  // here rolls the row back rather than leaving an orphan.
  if (customerCharge <= 0 && !input.note?.trim()) {
    throw new ApiError(
      400,
      'Dòng chi không thu khách hàng thì bắt buộc nhập ghi chú — ghi rõ lý do để kế toán / CUS đọc được.',
    );
  }

  const source = await upsertExpenseAccountingSource(transaction, { sourceKind: 'OPS', sourceId: entry.id,
    shipmentId: entry.shipmentId, shipmentContainerId: entry.shipmentContainerId, customerId: shipment.customerId,
    // feeName is the operator's CUSTOM name for the line. It must never fall
    // back to the machine code: the code is not a name, and every surface that
    // prefers feeName over the catalog label (wallet history "Loại phí", Sổ quỹ
    // "Diễn giải", the edit-modal prefill) then prints LIFT_EMPTY/FEE_CLEANING
    // into a Vietnamese money table. Blank stays blank → the catalog name shows.
    expenseTypeCode: entry.expenseTypeCode, costGroup, feeName: input.feeName?.trim() || '',
    amount: Number(entry.amount), customerChargeAmount: customerCharge,
    expenseDate: entry.paidAt, payerKind: 'USER', payerUserId: userId, payableEntityType: 'FORWARDER', payableEntityId: userId,
    recordedById: userId, invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate, note: entry.note,
    recoveryNote: input.recoveryNote, photoStorageKeys: input.photoStorageKeys });
  return { ...entry, version: source.version, costGroup, feeName: source.feeName, invoiceNumber: source.invoiceNumber,
    invoiceDate: source.invoiceDate, customerChargeAmount: source.customerChargeAmount, recoveryNote: source.recoveryNote };
}

export async function updateOpsExpense(
  userId: number,
  expenseId: number,
  patch: Partial<Pick<CreateOpsExpenseInput,
    'amount' | 'paidAt' | 'note' | 'shipmentContainerId' | 'expenseTypeCode' | 'costGroup' | 'feeName' | 'invoiceNumber' | 'invoiceDate' | 'recoveryNote'>> & {
    shipmentContainerId?: number | null;
    customerChargeAmount?: string | number | null;
    expectedVersion?: number;
    reason?: string;
  },
  transaction?: Tx,
): Promise<OpsExpenseWriteResult> {
  if (!transaction) return db.transaction(tx => updateOpsExpense(userId, expenseId, patch, tx));
  const executor: Executor = transaction ?? db;
  const entry = await getEditableExpense(userId, expenseId, executor);
  await assertOpsExpenseAssignment(transaction, userId, entry.shipmentId);
  if (!patch.reason?.trim()) throw new ApiError(400, 'Nhập lý do điều chỉnh khoản chi.');
  await assertShipmentAccountingUnlocked(transaction, entry.shipmentId);
  const source = await lockExpenseSource(transaction, 'OPS', expenseId);
  if (source) {
    await assertExpenseSourceMutable(transaction, source);
    if (patch.expectedVersion !== source.version) throw new ApiError(409, 'Khoản chi đã thay đổi. Tải lại trước khi sửa.');
  }
  const next: Record<string, unknown> = { updatedAt: new Date(), approvalStatus: 'RECORDED' };
  parseOpsMoney(patch.amount ?? entry.amount);
  assertValidPaidAt(patch.paidAt ?? entry.paidAt);
  await assertActiveExpenseType(patch.expenseTypeCode ?? entry.expenseTypeCode);

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
      inArray(s.opsExpenseEntries.approvalStatus, ['RECORDED', 'DRAFT', 'APPROVED', 'PENDING']),
      isNull(s.opsExpenseEntries.opsSettlementId),
    ))
    .returning();
  if (!updated) {
    throw new ApiError(409, 'Khoản chi vừa thay đổi trạng thái (đã lập phiếu). Tải lại và thử lại.');
  }
  if (source) {
    // Card 20260921_5 — the patch may set the Thực-thu side on no-invoice
    // rows; invoice rows keep charge = the (updated) amount.
    //
    // Card 20260928_197 — a patched amount that turns negative re-derives the
    // same way `createOpsExpense` does: 0, not a negative receivable.
    const effectiveGroup = patch.costGroup ?? source.costGroup;
    const chargeIsInvariant = typeof effectiveGroup === 'string' && effectiveGroup.startsWith('INVOICED_');
    const nextCharge = patch.customerChargeAmount === undefined && !chargeIsInvariant
      ? source.customerChargeAmount
      : receivableForCost(updated.amount, effectiveGroup, chargeIsInvariant ? undefined : patch.customerChargeAmount);
    const after = await upsertExpenseAccountingSource(transaction, { ...source, sourceKind: 'OPS', sourceId: expenseId,
      amount: Number(updated.amount), customerChargeAmount: nextCharge == null ? null : Number(nextCharge),
      expenseDate: updated.paidAt, expenseTypeCode: updated.expenseTypeCode, shipmentContainerId: updated.shipmentContainerId,
      costGroup: effectiveGroup, feeName: patch.feeName ?? source.feeName,
      invoiceNumber: patch.invoiceNumber === undefined ? source.invoiceNumber : patch.invoiceNumber,
      invoiceDate: patch.invoiceDate === undefined ? source.invoiceDate : patch.invoiceDate,
      recoveryNote: patch.recoveryNote === undefined ? source.recoveryNote : patch.recoveryNote, note: updated.note });
    await transaction.insert(s.auditLogs).values({ userId, message: 'EXPENSE_ACCOUNTING_UPDATED', entityType: 'expense_accounting_source', entityId: source.id,
      payload: { reason: patch.reason.trim(), before: source, after } });
    return { ...updated, version: after.version, costGroup: after.costGroup, invoiceNumber: after.invoiceNumber, invoiceDate: after.invoiceDate };
  }
  return updated;
}

export async function deleteOpsExpense(
  userId: number,
  expenseId: number,
  reason: string,
  transaction?: Tx,
): Promise<void> {
  // Q10 (card 20260922_78): deletes are governed soft voids — reason is
  // mandatory and persisted on the row with the actor.
  if (!reason || !reason.trim()) throw new ApiError(400, 'Lý do xóa là bắt buộc.');
  if (!transaction) return db.transaction(tx => deleteOpsExpense(userId, expenseId, reason, tx));
  const executor: Executor = transaction ?? db;
  const entry = await getEditableExpense(userId, expenseId, executor);
  await assertOpsExpenseAssignment(transaction, userId, entry.shipmentId);
  const source = await lockExpenseSource(transaction, 'OPS', expenseId);
  if (source) {
    await assertExpenseSourceMutable(transaction, source);
    await transaction.update(s.expenseAccountingSources).set({ status: 'VOIDED', version: source.version + 1, updatedAt: new Date() }).where(eq(s.expenseAccountingSources.id, source.id));
  }
  const [voided] = await executor.update(s.opsExpenseEntries).set({
    approvalStatus: 'VOIDED',
    deletionReason: reason.trim(),
    deletedBy: userId,
    updatedAt: new Date(),
  })
    .where(and(eq(s.opsExpenseEntries.id, expenseId), eq(s.opsExpenseEntries.paidById, userId), isNull(s.opsExpenseEntries.opsSettlementId))).returning({ id: s.opsExpenseEntries.id });
  if (!voided) throw new ApiError(409, 'Khoản chi vừa thay đổi trạng thái. Tải lại và thử lại.');
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

export async function attachOpsExpensePhoto(userId: number, expenseId: number, storageKey: string) {
  return db.transaction(async tx => {
    const [entry] = await tx.select().from(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, expenseId)).for('update');
    if (!entry || entry.paidById !== userId) throw new ApiError(404, 'Không tìm thấy khoản chi.');
    await assertOpsExpenseAssignment(tx, userId, entry.shipmentId);
    if (['VOIDED', 'REJECTED'].includes(entry.approvalStatus)) throw new ApiError(409, 'Khoản chi đã hủy; giữ nguyên chứng từ lịch sử.');
    assertOwnStorageKey(userId, storageKey);
    const [photo] = await tx.insert(s.opsExpensePhotos).values({ opsExpenseId: expenseId, storageKey, uploadedById: userId }).onConflictDoNothing().returning();
    return photo ?? null;
  });
}

export async function deleteOpsExpensePhoto(userId: number, photoId: number): Promise<void> {
  const key = await db.transaction(async tx => {
    const [photo] = await tx.select().from(s.opsExpensePhotos).where(eq(s.opsExpensePhotos.id, photoId)).for('update');
    if (!photo) throw new ApiError(404, 'Không tìm thấy ảnh.');
    const [entry] = await tx.select().from(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, photo.opsExpenseId)).for('update');
    if (!entry || entry.paidById !== userId) throw new ApiError(404, 'Không tìm thấy ảnh.');
    await assertOpsExpenseAssignment(tx, userId, entry.shipmentId);
    const source = await lockExpenseSource(tx, 'OPS', entry.id);
    if (source?.confirmedAt || entry.opsSettlementId || ['VOIDED', 'REJECTED'].includes(entry.approvalStatus)) throw new ApiError(409, 'Giữ nguyên chứng từ đã đối chiếu; chỉ bổ sung ảnh.');
    await tx.delete(s.opsExpensePhotos).where(eq(s.opsExpensePhotos.id, photoId));
    return photo.storageKey;
  });
  await deleteStorageKeysIfUnreferenced([key]);
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
  canReviewFinancialEvidence: boolean,
  expenseId: number,
): Promise<OpsExpensePhotoRow[]> {
  const [entry] = await db
    .select({ id: s.opsExpenseEntries.id, paidById: s.opsExpenseEntries.paidById })
    .from(s.opsExpenseEntries)
    .where(eq(s.opsExpenseEntries.id, expenseId))
    .limit(1);
  if (!entry || (!canReviewFinancialEvidence && entry.paidById !== userId)) {
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

/** Sum of the still-linked entries; used after rejects unlink entries.
 *  Card 20260928_197 — the aggregate is SQL, so it takes the query-level
 *  equivalent of `sumExcludingNegative`: `filter (where amount >= 0)`. Same
 *  rule (strictly negative rows are dropped, 0 is kept), same integer money —
 *  the sum never leaves `numeric`. */
export async function recomputeOpsSettlementTotal(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  settlementId: number,
): Promise<void> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${s.opsExpenseEntries.amount}) filter (where ${s.opsExpenseEntries.amount} >= 0), 0)` })
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
  category: string | null;
}>> {
  return db
    .select({
      id: s.forwarderExpenseTypes.id,
      code: s.forwarderExpenseTypes.code,
      name: s.forwarderExpenseTypes.name,
      requiresInvoice: s.forwarderExpenseTypes.requiresInvoice,
      category: s.forwarderExpenseTypes.category,
    })
    .from(s.forwarderExpenseTypes)
    .where(and(
      eq(s.forwarderExpenseTypes.status, 'ACTIVE'),
      isNull(s.forwarderExpenseTypes.deletedAt),
    ))
    .orderBy(s.forwarderExpenseTypes.name);
}

export interface OpsExpenseListRow {
  sourceKind?: 'OPS' | 'TRIP';
  sourceId?: number;
  version: number;
  confirmedAt: string | null;
  costGroup: ExpenseCostGroup | null;
  feeName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  customerChargeAmount: string | null;
  recoveryNote: string | null;
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
  approvalStatus: 'DRAFT' | 'RECORDED' | 'VOIDED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  opsSettlementId: number | null;
  hasPhoto: boolean;
  paidById: number;
  paidByName: string | null;
  createdAt: string;
}

export async function listOpsExpenses(filters: {
  paidById?: number;
  status?: 'DRAFT' | 'RECORDED' | 'VOIDED' | 'PENDING' | 'APPROVED' | 'REJECTED';
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
      version: s.expenseAccountingSources.version,
      confirmedAt: s.expenseAccountingSources.confirmedAt,
      costGroup: s.opsExpenseEntries.costGroup,
      feeName: s.opsExpenseEntries.feeName,
      invoiceNumber: s.opsExpenseEntries.invoiceNumber,
      invoiceDate: s.opsExpenseEntries.invoiceDate,
      customerChargeAmount: s.opsExpenseEntries.customerChargeAmount,
      recoveryNote: s.opsExpenseEntries.recoveryNote,
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
    .leftJoin(s.expenseAccountingSources, and(eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, s.opsExpenseEntries.id)))
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
    .limit((filters.limit ?? 100) + (filters.offset ?? 0));

  const nativeRows = rows.map((row) => ({
    ...row,
    // Rows written before the write-path fix carry the catalog CODE in
    // fee_name. A code is not a custom name, so it is dropped here and the
    // consumer falls back to expenseTypeName (the Vietnamese catalog label).
    feeName: row.feeName && row.feeName !== row.expenseTypeCode ? row.feeName : null,
    version: row.version ?? 1,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    hasPhoto: Boolean(row.hasPhoto),
  }));
  const legacy = filters.paidById != null && filters.settlementId == null
    ? await listLegacyOpsExpenseHistory(filters.paidById, filters.status) : [];
  return [...nativeRows, ...legacy].sort((a, b) => b.paidAt.localeCompare(a.paidAt) || b.id - a.id)
    .slice(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 100));
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

/** BigInt money sum carrying the `sumExcludingNegative` rule (card
 *  20260928_197): a strictly negative amount is dropped, never netted against
 *  the positive ones. Written in BigInt because these totals are integer VND —
 *  routing them through the number-returning helper would put the money on a
 *  float. Same predicate, integer-only arithmetic. */
function sumBig(values: string[]): bigint {
  return values.reduce((acc, value) => {
    const amount = BigInt(value || '0');
    return amount < 0n ? acc : acc + amount;
  }, 0n);
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
    // Card 20260928_197 — a negative entry stays in `items` (the row is real
    // and the reviewer must see it) but never reaches a total: the basket and
    // the group add only the same ">= 0" money `sumExcludingNegative` keeps.
    const entryAmount = BigInt(entry.amount || '0');
    if (entryAmount >= 0n) {
      basket.total = (BigInt(basket.total) + entryAmount).toString();
      group.total = (BigInt(group.total) + entryAmount).toString();
    }
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
