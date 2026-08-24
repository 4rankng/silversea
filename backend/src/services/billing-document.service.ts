import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, and, isNull, inArray, desc, or, sql, type SQL } from 'drizzle-orm';
import { ApiError } from '../errors';
import { LedgerService } from './ledger.service';
import { canonicalFreightDescription } from '@tingting/shared';
import type {
  BillingDocument,
  BillingDocumentLine,
  BillingLineRenderData,
  BillingDocumentType,
  BillingDocumentEntityType,
  SaveBillingDocumentInput,
  DebitNoteTemplateSnapshot,
  BillingDocumentOfficialIdentitySnapshot,
} from '@tingting/shared';
import type { Tx } from './trip-shared';
import {
  resolveCustomerPaymentDueDate,
  type PaymentDatePolicy,
} from './business-calendar.service';
import {
  assertDebitNotePeriodWritable,
  replaceBillingDocumentSourcePeriodLocks,
  resolveBillingDocumentSourcePeriodLocks,
  resolveDebitNotePeriodAuthority,
} from './period-lock.service';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import {
  checkBillingDocumentOverlap,
  lockBillingDocumentOverlapAuthority,
} from './billing-overlap-guard.service';
import {
  effectiveAmount,
  postingChecksum,
  documentVatTotals,
  VAT_TREATMENT_VERSION,
} from './billing-document-shared.service';
import {
  defaultSnapshotForType,
  resolveDebitNoteTemplate,
  templateToSnapshot,
} from './billing-document-template.service';
import { buildCustomerDebitLines } from './billing-document-draft.service';
import {
  type DbLike,
  splitContainers,
  joinContainers,
} from './billing-document-identity.service';
import {
  type TripClaimSeed,
  tripSourceIds,
  previewRecoverableTripIds,
  persistedClaimTripIds,
  replaceActiveTripClaims,
  assertDraftDocumentLinesEditable,
  documentLedgerAdjustment,
  assertRecoverableSourcesClaimable,
  assertTripSourcesClaimable,
  renderSourceVersion,
  renderSourceChangedAt,
  lineColumnSourceVersion,
  lineColumnSourceChangedAt,
  loadLineProvenance,
  listDocumentCorrections,
} from './billing-document-invariants.service';
import { postDebitNoteDelta } from './billing-document-posting.service';

// Template CRUD, draft generation, and the shared money/checksum/VAT helpers
// were split into billing-document-template.service.ts,
// billing-document-draft.service.ts, and billing-document-shared.service.ts
// (shared is the leaf both core and draft import from). Identity/invariant/
// posting helpers live in billing-document-identity/-invariants/-posting.
// Their previously-public symbols are re-exported here so every existing
// importer of this module keeps working unchanged.
export {
  effectiveAmount,
  postingChecksum,
  calculateVatSnapshot,
  buildTripSourceVersionToken,
  buildExpenseSourceVersionToken,
} from './billing-document-shared.service';
export {
  cloneTemplateSnapshot,
  DEFAULT_DEBIT_NOTE_COLUMNS,
  DEFAULT_PAYMENT_STATEMENT_COLUMNS,
  normalizeTemplateColumns,
  getDebitNoteTemplate,
  defaultSnapshotForType,
  getDefaultDebitNoteTemplate,
  resolveDebitNoteTemplate,
  templateToSnapshot,
  resolveDebitNoteTemplateForDoc,
} from './billing-document-template.service';
export {
  containerNumbers,
  containerUnit,
  expenseDocumentCode,
  splitRouteName,
  buildTripRenderData,
  loadContainersByTrip,
  loadLegRenderDataByTrip,
  generateDraft,
} from './billing-document-draft.service';
type DebitNoteSaveInput = SaveBillingDocumentInput & { type: 'DEBIT_NOTE' };
type DebitNoteSourceRef =
  | { sourceType: 'TRIP'; sourceId: number; financialPostingId: number; financialPostingVersion: number; postingChecksum: string }
  | { sourceType: 'EXPENSE'; sourceId: number; sourceVersion: string };
type BillingDocumentServiceInput = SaveBillingDocumentInput;

async function deriveDebitNoteLines(input: DebitNoteSaveInput): Promise<BillingDocumentLine[]> {
  const generated = await buildCustomerDebitLines(input.entityId, input.rangeFrom, input.rangeTo);
  const available = generated.lines as BillingDocumentLine[];
  const secureRefs = input.sourceRefs as DebitNoteSourceRef[] | undefined;
  const persistedLines = (input.lines ?? []).map((line) => ({
    ...line,
    renderData: line.renderData ? { ...line.renderData } : null,
    containerNumbers: line.containerNumbers ? [...line.containerNumbers] : null,
  }));
  const refs: DebitNoteSourceRef[] = secureRefs ?? persistedLines.map((line) => {
    if (line.sourceType === 'ADHOC' || line.sourceId == null) {
      throw new ApiError(400, 'Dòng thủ công không thuộc luồng lưu Giấy báo nợ thông thường.');
    }
    if (line.sourceType === 'TRIP') {
      if (
        line.financialPostingId == null
        || line.financialPostingVersion == null
        || !line.postingChecksum
      ) {
        throw new ApiError(409, 'Nguồn chuyến đi thiếu dấu vết hạch toán để lưu giấy báo nợ.');
      }
      return {
        sourceType: 'TRIP' as const,
        sourceId: line.sourceId,
        financialPostingId: line.financialPostingId,
        financialPostingVersion: line.financialPostingVersion,
        postingChecksum: line.postingChecksum,
      };
    }
    const sourceVersion = renderSourceVersion(line);
    if (!sourceVersion) {
      throw new ApiError(409, 'Nguồn chi phí thiếu phiên bản nguồn để lưu giấy báo nợ.');
    }
    return {
      sourceType: 'EXPENSE' as const,
      sourceId: line.sourceId,
      sourceVersion,
    };
  });
  const seen = new Set<string>();
  return refs.map((ref, index) => {
    const key = `${ref.sourceType}:${ref.sourceId}`;
    if (seen.has(key)) throw new ApiError(409, 'Một nguồn chỉ được chọn một lần trên Giấy báo nợ.');
    seen.add(key);

    const currentLine = available.find((candidate) => {
      if (candidate.sourceType !== ref.sourceType || candidate.sourceId !== ref.sourceId) return false;
      if (ref.sourceType === 'TRIP') {
        return candidate.financialPostingId === ref.financialPostingId
          && candidate.financialPostingVersion === ref.financialPostingVersion
          && candidate.postingChecksum === ref.postingChecksum;
      }
      return renderSourceVersion(candidate) === ref.sourceVersion;
    });
    const persistedLine = secureRefs
      ? null
      : persistedLines.find((candidate) => {
          if (candidate.sourceType !== ref.sourceType || candidate.sourceId !== ref.sourceId) return false;
          if (ref.sourceType === 'TRIP') {
            return candidate.financialPostingId === ref.financialPostingId
              && candidate.financialPostingVersion === ref.financialPostingVersion
              && candidate.postingChecksum === ref.postingChecksum;
          }
          return renderSourceVersion(candidate) === ref.sourceVersion;
        });
    const line = currentLine ?? persistedLine;
    if (!line) {
      throw new ApiError(409, 'Nguồn dữ liệu đã thay đổi hoặc không còn đủ điều kiện.');
    }
    return {
      ...line,
      renderData: line.renderData ? { ...line.renderData } : null,
      containerNumbers: line.containerNumbers ? [...line.containerNumbers] : null,
      amountOverride: null,
      excluded: false,
      sortOrder: index,
    };
  });
}

async function assertActiveFinancialPostingRefs(
  tx: Tx,
  lines: readonly BillingDocumentLine[],
): Promise<void> {
  const tripLines = lines.filter((line) => line.sourceType === 'TRIP');
  if (tripLines.length === 0) return;
  const postingIds = tripLines.map((line) => line.financialPostingId as number);
  const rows = await tx.select().from(s.tripFinancialPostings)
    .where(inArray(s.tripFinancialPostings.id, postingIds))
    .orderBy(s.tripFinancialPostings.id)
    .for('update');
  if (rows.length !== postingIds.length) {
    throw new ApiError(409, 'Có nguồn hạch toán không còn tồn tại. Vui lòng tạo lại bản nháp.');
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const line of tripLines) {
    const posting = byId.get(line.financialPostingId as number);
    if (
      !posting
      || posting.status !== 'ACTIVE'
      || posting.tripId !== line.sourceId
      || posting.version !== line.financialPostingVersion
      || postingChecksum(posting) !== line.postingChecksum
    ) {
      throw new ApiError(409, 'Nguồn hạch toán của chuyến đã thay đổi. Vui lòng tạo lại bản nháp.');
    }
  }
}

export async function saveDocument(
  input: BillingDocumentServiceInput,
  userId: number | null,
  transaction?: Tx,
): Promise<BillingDocument> {
  const authoritativeLines = input.type === 'DEBIT_NOTE'
    ? await deriveDebitNoteLines(input as DebitNoteSaveInput)
    : (input.lines ?? (() => { throw new ApiError(400, 'Bảng kê thiếu dòng trình bày.'); })()) as BillingDocumentLine[];
  const totals = documentVatTotals(authoritativeLines);
  const total = totals.gross;
  const desiredAdjustment = input.type === 'DEBIT_NOTE'
    ? documentLedgerAdjustment(authoritativeLines)
    : 0;
  // Resolve the document template and freeze a render-only snapshot onto the doc
  // so re-exports stay stable after the template is edited/deleted.
  let resolvedTemplateId = input.debitNoteTemplateId ?? null;
  if (input.type === 'DEBIT_NOTE' && resolvedTemplateId == null && input.entityType === 'CUSTOMER') {
    const [cust] = await db.select({ tplId: s.customers.debitNoteTemplateId })
      .from(s.customers).where(eq(s.customers.id, input.entityId)).limit(1);
    resolvedTemplateId = cust?.tplId ?? null;
  }
  const template = await resolveDebitNoteTemplate({ templateIdOverride: resolvedTemplateId, docType: input.type });
  const snapshot = template ? templateToSnapshot(template) : defaultSnapshotForType(input.type);
  // One active document per customer/vendor + exact period. Saving the same
  // period replaces it in-place and posts only the accounting delta.
  const execute = async (tx: Tx) => {
    if (input.type === 'DEBIT_NOTE' && input.entityType === 'CUSTOMER') {
      await LedgerService.lockEntity(tx, 'CUSTOMER', input.entityId);
      await lockBillingDocumentOverlapAuthority(tx, input);
      const authority = await resolveDebitNotePeriodAuthority(tx, input.entityId, input.rangeFrom, input.rangeTo);
      await assertDebitNotePeriodWritable(tx, authority);
      const sourceLockIds = await resolveBillingDocumentSourcePeriodLocks(
        tx,
        input.entityId,
        input.rangeFrom,
        input.rangeTo,
        authoritativeLines,
      );
      const dueDateSnapshot = await resolveCustomerPaymentDueDate(tx, input.entityId, input.rangeTo);
      const [existing] = await tx.select().from(s.billingDocuments).where(and(
        eq(s.billingDocuments.type, input.type),
        eq(s.billingDocuments.entityType, input.entityType),
        eq(s.billingDocuments.entityId, input.entityId),
        eq(s.billingDocuments.rangeFrom, input.rangeFrom),
        eq(s.billingDocuments.rangeTo, input.rangeTo),
        isNull(s.billingDocuments.deletedAt),
      )).limit(1).for('update');

      const overlap = await checkBillingDocumentOverlap({
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        excludeId: existing?.id,
      }, tx);
      if (overlap.hasOverlap) {
        throw new ApiError(
          409,
          'Kỳ giấy báo nợ bị chồng lấn với tài liệu đang hoạt động. Vui lòng điều chỉnh kỳ hoặc hủy tài liệu cũ.',
        );
      }

      if (existing) {
        const currentTripIds = await persistedClaimTripIds(tx, existing.id);
        const initialTripIds = [...new Set([
          ...currentTripIds,
          ...tripSourceIds(authoritativeLines),
          ...await previewRecoverableTripIds(tx, authoritativeLines),
        ])];
        await lockTripFinancialAuthority(tx, initialTripIds);
        assertDraftDocumentLinesEditable(existing.debitNoteStatus);
        const tripClaims = await assertTripSourcesClaimable(tx, {
          customerId: input.entityId,
          rangeFrom: input.rangeFrom,
          rangeTo: input.rangeTo,
          lines: authoritativeLines,
        });
        const recoverableTripClaims = await assertRecoverableSourcesClaimable(tx, {
          documentId: existing.id,
          customerId: input.entityId,
          rangeFrom: input.rangeFrom,
          rangeTo: input.rangeTo,
          lines: authoritativeLines,
          actorUserId: userId,
        });
        const desiredTripClaims = [...new Map(
          [...tripClaims, ...recoverableTripClaims].map((claim) => [claim.tripId, claim]),
        ).values()];
        const finalTripIds = desiredTripClaims.map((claim) => claim.tripId).sort((left, right) => left - right);
        if (finalTripIds.some((tripId) => !initialTripIds.includes(tripId))) {
          await lockTripFinancialAuthority(tx, [
            ...currentTripIds,
            ...finalTripIds,
          ]);
        }
        await assertActiveFinancialPostingRefs(tx, authoritativeLines);
        const [updated] = await tx.update(s.billingDocuments).set({
          entityName: input.entityName ?? null,
          note: input.note ?? null,
          totalInclVat: String(total),
          totalNet: String(totals.net),
          totalTax: String(totals.tax),
          totalGross: String(totals.gross),
          vatTreatmentVersion: VAT_TREATMENT_VERSION,
          ledgerAdjustmentAmount: String(desiredAdjustment),
          authorityState: 'CURRENT',
          authorityWarningReason: null,
          authorityWarningAt: null,
          updatedAt: new Date(),
          debitNoteTemplateId: template?.id ?? null,
          debitNoteTemplateSnapshot: snapshot,
          version: sql`${s.billingDocuments.version} + 1`,
        }).where(and(
          eq(s.billingDocuments.id, existing.id),
          isNull(s.billingDocuments.deletedAt),
          or(
            isNull(s.billingDocuments.debitNoteStatus),
            eq(s.billingDocuments.debitNoteStatus, 'DRAFT'),
          ),
        )).returning({ id: s.billingDocuments.id });
        if (!updated) {
          throw new ApiError(
            409,
            'Giấy báo nợ vừa được xác nhận hoặc khóa — không thể chỉnh sửa. Vui lòng tải lại.',
          );
        }
        await tx.delete(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, existing.id));
        await persistLines(tx, existing.id, authoritativeLines);
        await replaceActiveTripClaims(tx, {
          documentId: existing.id,
          rangeFrom: input.rangeFrom,
          rangeTo: input.rangeTo,
          actorUserId: userId,
          desiredClaims: desiredTripClaims,
        });
        await replaceBillingDocumentSourcePeriodLocks(tx, existing.id, sourceLockIds);
        return existing.id;
      }

      const initialTripIds = [...new Set([
        ...tripSourceIds(authoritativeLines),
        ...await previewRecoverableTripIds(tx, authoritativeLines),
      ])];
      await lockTripFinancialAuthority(tx, initialTripIds);
      const [doc] = await tx.insert(s.billingDocuments).values({
        type: input.type, entityType: input.entityType, entityId: input.entityId,
        entityName: input.entityName ?? null, rangeFrom: input.rangeFrom, rangeTo: input.rangeTo,
        note: input.note ?? null, totalInclVat: String(total),
        totalNet: String(totals.net), totalTax: String(totals.tax), totalGross: String(totals.gross),
        vatTreatmentVersion: VAT_TREATMENT_VERSION, createdBy: userId,
        ledgerAdjustmentAmount: String(desiredAdjustment),
        authorityState: 'CURRENT',
        authorityWarningReason: null,
        authorityWarningAt: null,
        debitNoteTemplateId: template?.id ?? null,
        debitNoteTemplateSnapshot: snapshot,
        originalDueDate: dueDateSnapshot.originalDate,
        processingDueDate: dueDateSnapshot.processingDate,
        paymentTermDaysApplied: dueDateSnapshot.paymentTermDays,
        paymentDatePolicyApplied: dueDateSnapshot.policy,
      }).returning();
      if (!doc) throw new ApiError(500, 'Không lưu được tài liệu');
      const tripClaims = await assertTripSourcesClaimable(tx, {
        customerId: input.entityId,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        lines: authoritativeLines,
      });
      const recoverableTripClaims = await assertRecoverableSourcesClaimable(tx, {
        documentId: doc.id,
        customerId: input.entityId,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        lines: authoritativeLines,
        actorUserId: userId,
      });
      const desiredTripClaims = [...new Map(
        [...tripClaims, ...recoverableTripClaims].map((claim) => [claim.tripId, claim]),
      ).values()];
      const finalTripIds = desiredTripClaims.map((claim) => claim.tripId).sort((left, right) => left - right);
      if (finalTripIds.some((tripId) => !initialTripIds.includes(tripId))) {
        await lockTripFinancialAuthority(tx, finalTripIds);
      }
      await assertActiveFinancialPostingRefs(tx, authoritativeLines);
      await persistLines(tx, doc.id, authoritativeLines);
      await replaceActiveTripClaims(tx, {
        documentId: doc.id,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        actorUserId: userId,
        desiredClaims: desiredTripClaims,
      });
      await replaceBillingDocumentSourcePeriodLocks(tx, doc.id, sourceLockIds);
      return doc.id;
    }
    let existing: typeof s.billingDocuments.$inferSelect | undefined;

    if (existing) {
      await tx.update(s.billingDocuments).set({
        entityName: input.entityName ?? null,
        note: input.note ?? null,
        totalInclVat: String(total),
        totalNet: String(totals.net),
        totalTax: String(totals.tax),
        totalGross: String(totals.gross),
        vatTreatmentVersion: VAT_TREATMENT_VERSION,
        ledgerAdjustmentAmount: String(desiredAdjustment),
        authorityState: 'CURRENT',
        authorityWarningReason: null,
        authorityWarningAt: null,
        updatedAt: new Date(),
        debitNoteTemplateId: template?.id ?? null,
        debitNoteTemplateSnapshot: snapshot,
      }).where(eq(s.billingDocuments.id, existing.id));
      await tx.delete(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, existing.id));
      await persistLines(tx, existing.id, authoritativeLines);
      await postDebitNoteDelta(tx, {
        documentId: existing.id,
        customerId: input.entityId,
        delta: desiredAdjustment - Number(existing.ledgerAdjustmentAmount),
        originalDueDate: existing.originalDueDate,
        processingDueDate: existing.processingDueDate,
        paymentTermDaysApplied: existing.paymentTermDaysApplied,
        paymentDatePolicyApplied: existing.paymentDatePolicyApplied as PaymentDatePolicy | null,
      });
      return existing.id;
    }

    const [doc] = await tx.insert(s.billingDocuments).values({
      type: input.type, entityType: input.entityType, entityId: input.entityId,
      entityName: input.entityName ?? null, rangeFrom: input.rangeFrom, rangeTo: input.rangeTo,
      note: input.note ?? null, totalInclVat: String(total),
      totalNet: String(totals.net), totalTax: String(totals.tax), totalGross: String(totals.gross),
      vatTreatmentVersion: VAT_TREATMENT_VERSION, createdBy: userId,
      ledgerAdjustmentAmount: String(desiredAdjustment),
      authorityState: 'CURRENT',
      authorityWarningReason: null,
      authorityWarningAt: null,
      debitNoteTemplateId: template?.id ?? null,
      debitNoteTemplateSnapshot: snapshot,
      originalDueDate: null,
      processingDueDate: null,
      paymentTermDaysApplied: null,
      paymentDatePolicyApplied: null,
    }).returning();
    if (!doc) throw new ApiError(500, 'Không lưu được tài liệu');
    await persistLines(tx, doc.id, authoritativeLines);
    return doc.id;
  };
  const docId = transaction
    ? await execute(transaction)
    : await db.transaction(execute);
  return getDocument(docId, transaction ?? db);
}

export async function updateDocument(
  id: number,
  input: BillingDocumentServiceInput,
  transaction?: Tx,
): Promise<BillingDocument> {
  // Reject immutable documents before resolving or validating replacement
  // sources. The transaction below repeats this check under a row lock so a
  // concurrent confirmation remains safe.
  const preflightDb = transaction ?? db;
  const [preflight] = await preflightDb.select({
    debitNoteStatus: s.billingDocuments.debitNoteStatus,
  }).from(s.billingDocuments)
    .where(and(eq(s.billingDocuments.id, id), isNull(s.billingDocuments.deletedAt)))
    .limit(1);
  if (!preflight) throw new ApiError(404, 'Không tìm thấy tài liệu');
  assertDraftDocumentLinesEditable(preflight.debitNoteStatus);

  const authoritativeLines = input.type === 'DEBIT_NOTE'
    ? await deriveDebitNoteLines(input as DebitNoteSaveInput)
    : (input.lines ?? (() => { throw new ApiError(400, 'Bảng kê thiếu dòng trình bày.'); })()) as BillingDocumentLine[];
  const totals = documentVatTotals(authoritativeLines);
  const total = totals.gross;
  const desiredAdjustment = input.type === 'DEBIT_NOTE'
    ? documentLedgerAdjustment(authoritativeLines)
    : 0;
  // Re-snapshot on every permitted edit so the doc never shows stale template
  // styling on new line data. Confirmed/paid/canceled documents are locked.
  // Preserve the existing template link unless the builder sent an
  // explicit pick (number or null); only re-resolve the customer/default chain
  // when there is no link to carry forward.
  const [existing] = await db.select({ tplId: s.billingDocuments.debitNoteTemplateId })
    .from(s.billingDocuments).where(eq(s.billingDocuments.id, id)).limit(1);
  let resolvedTemplateId = input.debitNoteTemplateId !== undefined
    ? (input.debitNoteTemplateId ?? null)
    : (existing?.tplId ?? null);
  if (input.type === 'DEBIT_NOTE' && resolvedTemplateId == null && input.entityType === 'CUSTOMER') {
    const [cust] = await db.select({ tplId: s.customers.debitNoteTemplateId })
      .from(s.customers).where(eq(s.customers.id, input.entityId)).limit(1);
    resolvedTemplateId = cust?.tplId ?? null;
  }
  const template = await resolveDebitNoteTemplate({ templateIdOverride: resolvedTemplateId, docType: input.type });
  const snapshot = template ? templateToSnapshot(template) : defaultSnapshotForType(input.type);
  // Replace lines on an allowed edit — delete + re-insert inside one
  // transaction so a mid-way failure cannot wipe the document's lines.
  const execute = async (tx: Tx) => {
    if (input.type === 'DEBIT_NOTE' && input.entityType === 'CUSTOMER') {
      await LedgerService.lockEntity(tx, 'CUSTOMER', input.entityId);
      await lockBillingDocumentOverlapAuthority(tx, input);
      const authority = await resolveDebitNotePeriodAuthority(tx, input.entityId, input.rangeFrom, input.rangeTo);
      await assertDebitNotePeriodWritable(tx, authority);
    }
    const [current] = await tx.select().from(s.billingDocuments)
      .where(and(eq(s.billingDocuments.id, id), isNull(s.billingDocuments.deletedAt)))
      .limit(1)
      .for('update');
    if (!current) throw new ApiError(404, 'Không tìm thấy tài liệu');
    if (current.type !== input.type || current.entityType !== input.entityType || current.entityId !== input.entityId) {
      throw new ApiError(400, 'Không thể đổi khách hàng hoặc loại của tài liệu đã lưu');
    }
    if (input.type === 'DEBIT_NOTE' && input.entityType === 'CUSTOMER') {
      const overlap = await checkBillingDocumentOverlap({
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        excludeId: id,
      }, tx);
      if (overlap.hasOverlap) {
        throw new ApiError(
          409,
          'Kỳ giấy báo nợ bị chồng lấn với tài liệu đang hoạt động. Vui lòng điều chỉnh kỳ hoặc hủy tài liệu cũ.',
        );
      }
    }
    const currentTripIds = await persistedClaimTripIds(tx, id);
    const initialTripIds = [...new Set([
      ...currentTripIds,
      ...tripSourceIds(authoritativeLines),
      ...await previewRecoverableTripIds(tx, authoritativeLines),
    ])];
    await lockTripFinancialAuthority(tx, initialTripIds);
    assertDraftDocumentLinesEditable(current.debitNoteStatus);
    const sourceLockIds = input.type === 'DEBIT_NOTE' && input.entityType === 'CUSTOMER'
      ? await resolveBillingDocumentSourcePeriodLocks(
        tx,
        input.entityId,
        input.rangeFrom,
        input.rangeTo,
        authoritativeLines,
      )
      : [];
    if (input.type === 'DEBIT_NOTE' && input.entityType === 'CUSTOMER') {
      const tripClaims = await assertTripSourcesClaimable(tx, {
        customerId: input.entityId,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        lines: authoritativeLines,
      });
      const recoverableTripClaims = await assertRecoverableSourcesClaimable(tx, {
        documentId: id,
        customerId: input.entityId,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        lines: authoritativeLines,
        actorUserId: current.createdBy,
      });
      const desiredTripClaims = [...new Map(
        [...tripClaims, ...recoverableTripClaims].map((claim) => [claim.tripId, claim]),
      ).values()];
      const finalTripIds = desiredTripClaims.map((claim) => claim.tripId).sort((left, right) => left - right);
      if (finalTripIds.some((tripId) => !initialTripIds.includes(tripId))) {
        await lockTripFinancialAuthority(tx, [
          ...currentTripIds,
          ...finalTripIds,
        ]);
      }
      await replaceActiveTripClaims(tx, {
        documentId: id,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        actorUserId: current.createdBy,
        desiredClaims: desiredTripClaims,
      });
    }
    const [updated] = await tx.update(s.billingDocuments).set({
      entityName: input.entityName ?? null, rangeFrom: input.rangeFrom, rangeTo: input.rangeTo,
      note: input.note ?? null, totalInclVat: String(total), updatedAt: new Date(),
      totalNet: String(totals.net),
      totalTax: String(totals.tax),
      totalGross: String(totals.gross),
      vatTreatmentVersion: VAT_TREATMENT_VERSION,
      ledgerAdjustmentAmount: String(desiredAdjustment),
      authorityState: 'CURRENT',
      authorityWarningReason: null,
      authorityWarningAt: null,
      debitNoteTemplateId: template?.id ?? null,
      debitNoteTemplateSnapshot: snapshot,
      version: sql`${s.billingDocuments.version} + 1`,
    }).where(and(
      eq(s.billingDocuments.id, id),
      isNull(s.billingDocuments.deletedAt),
      or(
        isNull(s.billingDocuments.debitNoteStatus),
        eq(s.billingDocuments.debitNoteStatus, 'DRAFT'),
      ),
    )).returning({ id: s.billingDocuments.id });
    if (!updated) {
      throw new ApiError(
        409,
        'Giấy báo nợ vừa được xác nhận hoặc khóa — không thể chỉnh sửa. Vui lòng tải lại.',
      );
    }
    await assertActiveFinancialPostingRefs(tx, authoritativeLines);
    await tx.delete(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, id));
    await persistLines(tx, id, authoritativeLines);
    await replaceBillingDocumentSourcePeriodLocks(tx, id, sourceLockIds);
  };
  await runInTx(transaction, execute);
  return getDocument(id, transaction ?? db);
}

async function persistLines(tx: Tx, documentId: number, lines: BillingDocumentLine[]): Promise<void> {
  if (lines.length === 0) return;
  await tx.insert(s.billingDocumentLines).values(
    lines.map((l) => ({
      documentId,
      sourceType: l.sourceType, sourceId: l.sourceId ?? null, lineType: l.lineType,
      sourceVersion: renderSourceVersion(l),
      sourceChangedAt: renderSourceChangedAt(l) ? new Date(renderSourceChangedAt(l) as string) : null,
      financialPostingId: l.sourceType === 'TRIP' ? (l.financialPostingId ?? null) : null,
      financialPostingVersion: l.sourceType === 'TRIP' ? (l.financialPostingVersion ?? null) : null,
      postingChecksum: l.sourceType === 'TRIP' ? (l.postingChecksum ?? null) : null,
      typeLabel: l.typeLabel, unit: l.unit,
      description: l.description, routeName: l.routeName ?? null,
      containerNumbers: joinContainers(l.containerNumbers),
      renderData: l.renderData ? { ...l.renderData } : null,
      baseAmount: String(Number(l.baseAmount)),
      amountOverride: l.amountOverride != null ? String(Number(l.amountOverride)) : null,
      excluded: l.excluded ?? false, sortOrder: l.sortOrder ?? 0,
      vatTreatment: l.vatTreatment ?? 'EXEMPT',
      vatRate: String(l.vatRate ?? 0),
      vatTreatmentVersion: l.vatTreatmentVersion ?? VAT_TREATMENT_VERSION,
      netAmount: String(l.netAmount ?? l.baseAmount ?? 0),
      taxAmount: String(l.taxAmount ?? 0),
      grossAmount: String(l.grossAmount ?? effectiveAmount(l)),
    })),
  );
}

export async function listDocuments(entityType: BillingDocumentEntityType, entityId: number, type?: BillingDocumentType): Promise<BillingDocument[]> {
  // Filter by `type` when provided so a customer who is also an external
  // carrier doesn't see their payment-statements mixed into the debit-note
  // list (both share entityType=CUSTOMER).
  const conds: SQL<unknown>[] = [
    eq(s.billingDocuments.entityType, entityType),
    eq(s.billingDocuments.entityId, entityId),
    isNull(s.billingDocuments.deletedAt),
  ];
  if (type) conds.push(eq(s.billingDocuments.type, type));
  const docs = await db.select().from(s.billingDocuments)
    .where(and(...conds))
    .orderBy(desc(s.billingDocuments.createdAt));
  return Promise.all(docs.map((d) => hydrateDocument(d)));
}

export async function getDocument(id: number, executor: typeof db | Tx = db): Promise<BillingDocument> {
  const [doc] = await executor.select().from(s.billingDocuments)
    .where(and(eq(s.billingDocuments.id, id), isNull(s.billingDocuments.deletedAt))).limit(1);
  if (!doc) throw new ApiError(404, 'Không tìm thấy tài liệu');
  return hydrateDocument(doc, executor);
}

async function hydrateDocument(
  doc: typeof s.billingDocuments.$inferSelect,
  executor: DbLike = db,
): Promise<BillingDocument> {
  const lines = await executor.select().from(s.billingDocumentLines)
    .where(eq(s.billingDocumentLines.documentId, doc.id))
    .orderBy(s.billingDocumentLines.sortOrder);
  const hydratedLines = await Promise.all(lines.map(async (l) => {
    const explicitSourceVersion = lineColumnSourceVersion(l);
    const explicitSourceChangedAt = lineColumnSourceChangedAt(l);
    const renderData = ((l.renderData as BillingLineRenderData | null) ?? null)
      ? {
          ...((l.renderData as BillingLineRenderData | null) ?? {}),
          ...(explicitSourceVersion ? { sourceVersion: explicitSourceVersion } : {}),
          ...(explicitSourceChangedAt ? { sourceChangedAt: explicitSourceChangedAt } : {}),
        }
      : (
          explicitSourceVersion || explicitSourceChangedAt
            ? {
                ...(explicitSourceVersion ? { sourceVersion: explicitSourceVersion } : {}),
                ...(explicitSourceChangedAt ? { sourceChangedAt: explicitSourceChangedAt } : {}),
              } as BillingLineRenderData
            : null
        );
    const line: BillingDocumentLine = {
      id: l.id, documentId: l.documentId, sourceType: l.sourceType as BillingDocumentLine['sourceType'],
      sourceId: l.sourceId ?? null, lineType: l.lineType as BillingDocumentLine['lineType'],
      typeLabel: l.typeLabel, unit: l.unit,
      description: l.description, routeName: l.routeName,
      containerNumbers: splitContainers(l.containerNumbers),
      renderData,
      financialPostingId: l.financialPostingId ?? null,
      financialPostingVersion: l.financialPostingVersion ?? null,
      postingChecksum: l.postingChecksum ?? null,
      baseAmount: Number(l.baseAmount), amountOverride: l.amountOverride != null ? Number(l.amountOverride) : null,
      excluded: l.excluded, sortOrder: l.sortOrder,
      vatTreatment: l.vatTreatment as BillingDocumentLine['vatTreatment'],
      vatRate: Number(l.vatRate) as BillingDocumentLine['vatRate'],
      vatTreatmentVersion: l.vatTreatmentVersion,
      netAmount: Number(l.netAmount),
      taxAmount: Number(l.taxAmount),
      grossAmount: Number(l.grossAmount),
    };
    const normalized = { ...line, description: canonicalFreightDescription(line) };
    return {
      ...normalized,
      provenance: await loadLineProvenance(normalized, executor),
    };
  }));
  const detectedAuthorityState = hydratedLines.some((line) => line.provenance?.status && line.provenance.status !== 'CURRENT')
    ? ((doc.debitNoteStatus ?? 'DRAFT') === 'DRAFT' ? 'STALE' : 'ADJUSTMENT_REQUIRED')
    : 'CURRENT';
  const authorityState = doc.authorityState === 'CURRENT'
    ? detectedAuthorityState
    : (doc.authorityState as BillingDocument['authorityState']);
  const corrections = await listDocumentCorrections(doc.id, executor);
  return {
    id: doc.id, version: doc.version, type: doc.type as BillingDocumentType, entityType: doc.entityType as BillingDocumentEntityType,
    entityId: doc.entityId, entityName: doc.entityName ?? undefined,
    rangeFrom: doc.rangeFrom, rangeTo: doc.rangeTo, note: doc.note,
    totalInclVat: Number(doc.totalInclVat), createdBy: doc.createdBy,
    totalNet: Number(doc.totalNet),
    totalTax: Number(doc.totalTax),
    totalGross: Number(doc.totalGross),
    vatTreatmentVersion: doc.vatTreatmentVersion,
    debitNoteStatus: doc.debitNoteStatus,
    customerConfirmedAt: doc.customerConfirmedAt?.toISOString() ?? null,
    customerConfirmedBy: doc.customerConfirmedBy,
    ledgerAdjustmentAmount: Number(doc.ledgerAdjustmentAmount),
    originalDueDate: doc.originalDueDate,
    processingDueDate: doc.processingDueDate,
    paymentTermDaysApplied: doc.paymentTermDaysApplied,
    paymentDatePolicyApplied: doc.paymentDatePolicyApplied as PaymentDatePolicy | null,
    debitNoteTemplateId: doc.debitNoteTemplateId ?? null,
    debitNoteTemplateSnapshot: (doc.debitNoteTemplateSnapshot as DebitNoteTemplateSnapshot | null) ?? null,
    officialIdentitySnapshot: (
      doc.officialIdentitySnapshot as BillingDocumentOfficialIdentitySnapshot | null
    ) ?? null,
    legalInvoiceRef: doc.legalInvoiceRef ?? null,
    authorityState,
    corrections,
    createdAt: doc.createdAt.toISOString(), updatedAt: doc.updatedAt.toISOString(),
    lines: hydratedLines,
  };
}

export async function deleteDocument(id: number, transaction?: Tx): Promise<void> {
  const execute = async (tx: Tx) => {
    const [initial] = await tx.select().from(s.billingDocuments)
      .where(and(eq(s.billingDocuments.id, id), isNull(s.billingDocuments.deletedAt))).limit(1);
    if (!initial) throw new ApiError(404, 'Không tìm thấy tài liệu');
    if (initial.type === 'DEBIT_NOTE') {
      if (initial.entityType === 'CUSTOMER') {
        await LedgerService.lockEntity(tx, 'CUSTOMER', initial.entityId);
        const authority = await resolveDebitNotePeriodAuthority(tx, initial.entityId, initial.rangeFrom, initial.rangeTo);
        await assertDebitNotePeriodWritable(tx, authority);
      }
      // Re-read after acquiring the entity lock so a concurrent save cannot
      // leave us reversing a stale adjustment amount.
      const [doc] = await tx.select().from(s.billingDocuments)
        .where(and(eq(s.billingDocuments.id, id), isNull(s.billingDocuments.deletedAt))).limit(1);
      if (!doc) throw new ApiError(404, 'Không tìm thấy tài liệu');
      if (doc.debitNoteStatus != null && doc.debitNoteStatus !== 'DRAFT') {
        throw new ApiError(
          409,
          'Giấy báo nợ đã phát hành hoặc kết thúc vòng đời — không thể xóa. Tạo giấy điều chỉnh hoặc hủy theo quy trình nếu cần.',
        );
      }
      const [deleted] = await tx.update(s.billingDocuments)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(s.billingDocuments.id, id),
          isNull(s.billingDocuments.deletedAt),
          or(
            isNull(s.billingDocuments.debitNoteStatus),
            eq(s.billingDocuments.debitNoteStatus, 'DRAFT'),
          ),
        ))
        .returning({ id: s.billingDocuments.id });
      if (!deleted) {
        throw new ApiError(
          409,
          'Giấy báo nợ vừa được phát hành hoặc đổi trạng thái — không thể xóa. Vui lòng tải lại.',
        );
      }
      await tx.delete(s.billingDocumentRecoverableClaims)
        .where(eq(s.billingDocumentRecoverableClaims.documentId, id));
      return;
    }
    await tx.update(s.billingDocuments).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(s.billingDocuments.id, id));
  };
  await runInTx(transaction, execute);
}

// ── Compatibility re-exports (leaf surface, named only) ─────────────────────
export type {
  DbLike,
  OfficialBillingIdentitySnapshot,
  FrozenDebitNoteTemplateSnapshot,
} from './billing-document-identity.service';
export {
  splitContainers,
  joinContainers,
  trimIdentityValue,
  stripHonorifics,
  extractOfficialIdentitySnapshot,
  loadCompanyInfoFromExecutor,
} from './billing-document-identity.service';
export {
  assertDraftDocumentLinesEditable,
  docTotal,
  documentLedgerAdjustment,
  assertRecoverableSourcesClaimable,
} from './billing-document-invariants.service';
export { postDebitNoteDelta } from './billing-document-posting.service';
