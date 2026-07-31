import { and, count, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import { requestTripExpenseDecision, type ApprovalTransition, type TripExpenseDecisionEvidence } from './approval.service';
import {
  assertClerkCanAccessShipment,
  buildShipmentScopeWhere,
  isClerkScopedUser,
  loadClerkShipmentScope,
} from './clerk-shipment-scope.service';
import type { Tx } from './trip-shared';

export type RecoverableEligibilityState =
  | 'READY_FOR_REVIEW'
  | 'ELIGIBLE'
  | 'BLOCKED'
  | 'ALREADY_CLAIMED'
  | 'ADJUSTMENT_REQUIRED';

export interface RecoverableEligibilityInput {
  approvalStatus: string;
  sellAmount: number;
  recoverablePrincipalAmount: number | null;
  serviceFeeAmount: number | null;
  expenseDate: string | null;
  requiresInvoice: boolean;
  substituteEvidenceAllowed: boolean;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  noInvoiceEvidenceTypes: readonly string[];
  claimDocumentId: number | null;
  claimDocumentStatus: string | null;
  claimSourceVersion: string | null;
  currentSourceVersion: string;
}

export interface RecoverableCostFilters {
  page: number;
  limit: number;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  customerId?: number;
}

export function evaluateRecoverableEligibility(
  input: RecoverableEligibilityInput,
): { state: RecoverableEligibilityState; blockedReason: string | null } {
  if (input.claimDocumentId != null) {
    if (
      input.claimDocumentStatus !== 'DRAFT'
      && input.claimSourceVersion !== input.currentSourceVersion
    ) {
      return {
        state: 'ADJUSTMENT_REQUIRED',
        blockedReason: 'Chi phí đã thay đổi sau khi Giấy báo nợ được phát hành; cần lập điều chỉnh.',
      };
    }
    return {
      state: 'ALREADY_CLAIMED',
      blockedReason: `Chi phí đã thuộc Giấy báo nợ #${input.claimDocumentId}.`,
    };
  }
  if (input.approvalStatus === 'PENDING') {
    return { state: 'READY_FOR_REVIEW', blockedReason: null };
  }
  if (input.approvalStatus !== 'APPROVED') {
    return { state: 'BLOCKED', blockedReason: 'Chi phí chưa được phê duyệt.' };
  }
  if (!Number.isFinite(input.sellAmount) || input.sellAmount <= 0) {
    return { state: 'BLOCKED', blockedReason: 'Khoản thu lại khách hàng phải lớn hơn 0.' };
  }
  if (input.recoverablePrincipalAmount == null || input.serviceFeeAmount == null) {
    return {
      state: 'BLOCKED',
      blockedReason: 'Chưa phân loại riêng tiền chi hộ và phí dịch vụ.',
    };
  }
  if (input.recoverablePrincipalAmount + input.serviceFeeAmount !== input.sellAmount) {
    return {
      state: 'BLOCKED',
      blockedReason: 'Tổng tiền chi hộ và phí dịch vụ không khớp khoản thu khách hàng.',
    };
  }
  if (!input.expenseDate) {
    return { state: 'BLOCKED', blockedReason: 'Thiếu ngày phát sinh chi phí.' };
  }
  if (input.requiresInvoice && (!input.invoiceNumber?.trim() || !input.invoiceDate)) {
    return { state: 'BLOCKED', blockedReason: 'Loại chi phí này yêu cầu đủ số và ngày hóa đơn.' };
  }
  if (
    !input.requiresInvoice
    && !input.invoiceNumber?.trim()
    && (!input.substituteEvidenceAllowed || input.noInvoiceEvidenceTypes.length === 0)
  ) {
    return {
      state: 'BLOCKED',
      blockedReason: 'Chi phí không hóa đơn chưa có chứng từ thay thế hợp lệ.',
    };
  }
  return { state: 'ELIGIBLE', blockedReason: null };
}

function currentExpenseSourceVersion(row: {
  updatedAt: Date;
  approvalStatus: string;
  sellAmount: string;
}): string {
  return `expense:${row.updatedAt.toISOString()}:${row.approvalStatus}:${Number(row.sellAmount)}`;
}

function toRecoverableCost(row: RecoverableCostRow) {
  const sourceVersion = currentExpenseSourceVersion(row);
  const eligibility = evaluateRecoverableEligibility({
    approvalStatus: row.approvalStatus,
    sellAmount: Number(row.sellAmount),
    recoverablePrincipalAmount: row.recoverablePrincipalAmount == null
      ? null
      : Number(row.recoverablePrincipalAmount),
    serviceFeeAmount: row.serviceFeeAmount == null ? null : Number(row.serviceFeeAmount),
    expenseDate: row.expenseDate,
    requiresInvoice: row.requiresInvoice ?? false,
    substituteEvidenceAllowed: row.substituteEvidenceAllowed ?? true,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    noInvoiceEvidenceTypes: row.noInvoiceEvidenceTypes,
    claimDocumentId: row.claimDocumentId,
    claimDocumentStatus: row.claimDocumentStatus,
    claimSourceVersion: row.claimSourceVersion,
    currentSourceVersion: sourceVersion,
  });
  return {
    id: row.id,
    version: row.version,
    tripId: row.tripId,
    tripCode: row.tripCode,
    shipmentId: row.shipmentId,
    shipmentCode: row.shipmentCode,
    customerId: row.customerId,
    customerName: row.customerName,
    expenseType: row.expenseType,
    expenseTypeName: row.expenseTypeName,
    expenseDate: row.expenseDate,
    buyAmount: Number(row.buyAmount),
    sellAmount: Number(row.sellAmount),
    recoverablePrincipalAmount: row.recoverablePrincipalAmount == null
      ? null
      : Number(row.recoverablePrincipalAmount),
    serviceFeeAmount: row.serviceFeeAmount == null ? null : Number(row.serviceFeeAmount),
    approvalStatus: row.approvalStatus,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    declarationNumber: row.declarationNumber,
    noInvoiceEvidenceTypes: row.noInvoiceEvidenceTypes,
    sourceVersion,
    claim: row.claimDocumentId == null ? null : {
      documentId: row.claimDocumentId,
      documentStatus: row.claimDocumentStatus,
      sourceVersion: row.claimSourceVersion,
    },
    eligibility,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const recoverableSelection = {
  id: s.tripExpenses.id,
  version: s.tripExpenses.version,
  tripId: s.tripExpenses.tripId,
  tripCode: s.trips.tripCode,
  shipmentId: s.trips.shipmentId,
  shipmentCode: s.shipments.shipmentCode,
  customerId: s.trips.customerId,
  customerName: s.customers.name,
  expenseType: s.tripExpenses.expenseType,
  expenseTypeName: s.forwarderExpenseTypes.name,
  expenseDate: s.tripExpenses.expenseDate,
  buyAmount: s.tripExpenses.buyAmount,
  sellAmount: s.tripExpenses.sellAmount,
  recoverablePrincipalAmount: s.tripExpenses.recoverablePrincipalAmount,
  serviceFeeAmount: s.tripExpenses.serviceFeeAmount,
  approvalStatus: s.tripExpenses.approvalStatus,
  invoiceNumber: s.tripExpenses.invoiceNumber,
  invoiceDate: s.tripExpenses.invoiceDate,
  declarationNumber: s.tripExpenses.declarationNumber,
  noInvoiceEvidenceTypes: s.tripExpenses.noInvoiceEvidenceTypes,
  requiresInvoice: s.forwarderExpenseTypes.requiresInvoice,
  substituteEvidenceAllowed: s.forwarderExpenseTypes.substituteEvidenceAllowed,
  claimDocumentId: s.billingDocumentRecoverableClaims.documentId,
  claimSourceVersion: s.billingDocumentRecoverableClaims.sourceVersion,
  claimDocumentStatus: s.billingDocuments.debitNoteStatus,
  updatedAt: s.tripExpenses.updatedAt,
};

type RecoverableCostRow = {
  id: number;
  version: number;
  tripId: number;
  tripCode: string | null;
  shipmentId: number | null;
  shipmentCode: string | null;
  customerId: number;
  customerName: string;
  expenseType: string;
  expenseTypeName: string | null;
  expenseDate: string | null;
  buyAmount: string;
  sellAmount: string;
  recoverablePrincipalAmount: string | null;
  serviceFeeAmount: string | null;
  approvalStatus: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  declarationNumber: string | null;
  noInvoiceEvidenceTypes: string[];
  requiresInvoice: boolean | null;
  substituteEvidenceAllowed: boolean | null;
  claimDocumentId: number | null;
  claimSourceVersion: string | null;
  claimDocumentStatus: string | null;
  updatedAt: Date;
};

function baseRecoverableQuery() {
  return db.select(recoverableSelection)
    .from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .innerJoin(s.shipments, eq(s.trips.shipmentId, s.shipments.id))
    .innerJoin(s.customers, eq(s.trips.customerId, s.customers.id))
    .leftJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
    .leftJoin(
      s.billingDocumentRecoverableClaims,
      eq(s.billingDocumentRecoverableClaims.expenseId, s.tripExpenses.id),
    )
    .leftJoin(
      s.billingDocuments,
      and(
        eq(s.billingDocuments.id, s.billingDocumentRecoverableClaims.documentId),
        isNull(s.billingDocuments.deletedAt),
      ),
    );
}

async function recoverableConditions(
  actor: Pick<AuthUser, 'userId' | 'role'>,
  filters: Pick<RecoverableCostFilters, 'approvalStatus' | 'customerId'>,
): Promise<SQL[]> {
  const conditions: SQL[] = [
    isNull(s.trips.deletedAt),
    isNull(s.shipments.deletedAt),
    isNull(s.customers.deletedAt),
  ];
  if (filters.approvalStatus) conditions.push(eq(s.tripExpenses.approvalStatus, filters.approvalStatus));
  if (filters.customerId) conditions.push(eq(s.trips.customerId, filters.customerId));
  if (isClerkScopedUser(actor)) {
    conditions.push(buildShipmentScopeWhere(await loadClerkShipmentScope(actor.userId)));
  }
  return conditions;
}

export async function listRecoverableCosts(
  actor: Pick<AuthUser, 'userId' | 'role'>,
  filters: RecoverableCostFilters,
) {
  const conditions = await recoverableConditions(actor, filters);
  const [rows, totalRows] = await Promise.all([
    baseRecoverableQuery()
      .where(and(...conditions))
      .orderBy(desc(s.tripExpenses.updatedAt), desc(s.tripExpenses.id))
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit),
    db.select({ value: count() })
      .from(s.tripExpenses)
      .innerJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
      .innerJoin(s.shipments, eq(s.trips.shipmentId, s.shipments.id))
      .innerJoin(s.customers, eq(s.trips.customerId, s.customers.id))
      .where(and(...conditions)),
  ]);
  return {
    items: rows.map(toRecoverableCost),
    total: Number(totalRows[0]?.value ?? 0),
    page: filters.page,
    limit: filters.limit,
  };
}

export async function getRecoverableCost(
  actor: Pick<AuthUser, 'userId' | 'role'>,
  expenseId: number,
  transaction?: Tx,
) {
  const client = transaction ?? db;
  const [row] = await client.select(recoverableSelection)
    .from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .innerJoin(s.shipments, eq(s.trips.shipmentId, s.shipments.id))
    .innerJoin(s.customers, eq(s.trips.customerId, s.customers.id))
    .leftJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
    .leftJoin(
      s.billingDocumentRecoverableClaims,
      eq(s.billingDocumentRecoverableClaims.expenseId, s.tripExpenses.id),
    )
    .leftJoin(
      s.billingDocuments,
      and(
        eq(s.billingDocuments.id, s.billingDocumentRecoverableClaims.documentId),
        isNull(s.billingDocuments.deletedAt),
      ),
    )
    .where(and(
      eq(s.tripExpenses.id, expenseId),
      isNull(s.trips.deletedAt),
      isNull(s.shipments.deletedAt),
      isNull(s.customers.deletedAt),
    ))
    .limit(1);
  if (!row) throw new ApiError(404, 'Không tìm thấy chi phí thu hộ');
  if (row.shipmentId == null) throw new ApiError(404, 'Không tìm thấy chi phí thu hộ');
  if (isClerkScopedUser(actor)) {
    const scope = await loadClerkShipmentScope(actor.userId, transaction);
    assertClerkCanAccessShipment(scope, {
      id: row.shipmentId,
      customerId: row.customerId,
      responsibleUnitId: await loadShipmentResponsibleUnit(row.shipmentId, transaction),
    });
  }
  return toRecoverableCost(row);
}

async function loadShipmentResponsibleUnit(shipmentId: number, transaction?: Tx) {
  const client = transaction ?? db;
  const [shipment] = await client.select({ responsibleUnitId: s.shipments.responsibleUnitId })
    .from(s.shipments)
    .where(eq(s.shipments.id, shipmentId))
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
  return shipment.responsibleUnitId;
}

export async function requestRecoverableCostDecision(input: {
  expenseId: number;
  decision: ApprovalTransition;
  reason: string;
  evidence: TripExpenseDecisionEvidence;
  expectedVersion: number;
  actor: Pick<AuthUser, 'userId' | 'role'>;
  transaction: Tx;
}) {
  const [source] = await input.transaction.select({
    expenseId: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    shipmentId: s.trips.shipmentId,
    customerId: s.trips.customerId,
    responsibleUnitId: s.shipments.responsibleUnitId,
  })
    .from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .innerJoin(s.shipments, eq(s.trips.shipmentId, s.shipments.id))
    .where(and(
      eq(s.tripExpenses.id, input.expenseId),
      isNull(s.trips.deletedAt),
      isNull(s.shipments.deletedAt),
    ))
    .limit(1)
    .for('update');
  if (!source || source.shipmentId == null) throw new ApiError(404, 'Không tìm thấy chi phí thu hộ');
  if (input.actor.role === Role.CLERK) {
    const scope = await loadClerkShipmentScope(input.actor.userId, input.transaction);
    assertClerkCanAccessShipment(scope, {
      id: source.shipmentId,
      customerId: source.customerId,
      responsibleUnitId: source.responsibleUnitId,
    });
  }
  return requestTripExpenseDecision({
    tripId: source.tripId,
    expenseId: source.expenseId,
    decision: input.decision,
    reason: input.reason,
    evidence: input.evidence,
    expectedExpenseVersion: input.expectedVersion,
    makerId: input.actor.userId,
    makerRole: input.actor.role,
    transaction: input.transaction,
  });
}
