import {
  DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
  NO_INVOICE_POLICY_DEFAULTS,
  type NoInvoiceEvidenceType,
  Role,
  type NoInvoicePolicySnapshot,
} from '@tingting/shared';
import { and, desc, eq, gte, inArray, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';

type DbLike = typeof db | Tx;

type ForwarderExpenseTypePolicy = {
  code: string;
  name: string;
  requiresInvoice: boolean | null;
  substituteEvidenceAllowed: boolean | null;
  noInvoiceEvidenceTypes: string[] | null;
  noInvoicePerItemLimit: string;
  noInvoicePerDayLimit: string;
  noInvoiceFinanceLeadItemApprovalLimit: string;
  noInvoiceDirectorDayApprovalLimit: string;
  noInvoicePolicyVersion: number;
};

type TripExpenseNoInvoiceState = {
  id: number;
  tripId: number;
  expenseType: string;
  buyAmount: string;
  expenseDate: string | null;
  payeeName: string | null;
  invoiceNumber: string | null;
  note: string | null;
  approvalStatus: string;
  noInvoiceEvidenceTypes: string[] | null;
};

export type NoInvoiceApprovalOutcome =
  | { outcome: 'ALLOW'; policySnapshot: NoInvoicePolicySnapshot | null; aggregateAmount: number }
  | { outcome: 'RETURN_FOR_EVIDENCE'; policySnapshot: NoInvoicePolicySnapshot | null; returnReason: string; aggregateAmount: number };

export const PER_ITEM_THRESHOLD = NO_INVOICE_POLICY_DEFAULTS.perItemLimit;
export const DIRECTOR_THRESHOLD = NO_INVOICE_POLICY_DEFAULTS.financeLeadItemApprovalLimit;
export const DAY_AGGREGATE_THRESHOLD = NO_INVOICE_POLICY_DEFAULTS.directorDayApprovalLimit;

export function toNoInvoicePolicySnapshotValue(
  snapshot: NoInvoicePolicySnapshot | null,
): Record<string, unknown> | null {
  return snapshot as unknown as Record<string, unknown> | null;
}

function hasInvoice(invoiceNumber: string | null | undefined): boolean {
  return !!invoiceNumber?.trim();
}

function normalizeEvidenceTypes(value: string[] | null | undefined): NoInvoiceEvidenceType[] {
  const allowed = new Set(DEFAULT_NO_INVOICE_EVIDENCE_TYPES);
  return Array.from(new Set((value ?? []).filter((item): item is NoInvoiceEvidenceType => allowed.has(item as NoInvoiceEvidenceType))));
}

function buildPolicySnapshot(policy: ForwarderExpenseTypePolicy): NoInvoicePolicySnapshot {
  return {
    version: policy.noInvoicePolicyVersion,
    expenseTypeCode: policy.code,
    expenseTypeName: policy.name,
    substituteEvidenceAllowed: policy.substituteEvidenceAllowed ?? true,
    allowedEvidenceTypes: normalizeEvidenceTypes(policy.noInvoiceEvidenceTypes),
    perItemLimit: String(policy.noInvoicePerItemLimit),
    perDayLimit: String(policy.noInvoicePerDayLimit),
    financeLeadItemApprovalLimit: String(policy.noInvoiceFinanceLeadItemApprovalLimit),
    directorDayApprovalLimit: String(policy.noInvoiceDirectorDayApprovalLimit),
  };
}

async function getForwarderExpenseTypePolicy(
  txOrDb: DbLike,
  expenseTypeCode: string,
): Promise<ForwarderExpenseTypePolicy | null> {
  const [policy] = await txOrDb.select({
    code: s.forwarderExpenseTypes.code,
    name: s.forwarderExpenseTypes.name,
    requiresInvoice: s.forwarderExpenseTypes.requiresInvoice,
    substituteEvidenceAllowed: s.forwarderExpenseTypes.substituteEvidenceAllowed,
    noInvoiceEvidenceTypes: s.forwarderExpenseTypes.noInvoiceEvidenceTypes,
    noInvoicePerItemLimit: s.forwarderExpenseTypes.noInvoicePerItemLimit,
    noInvoicePerDayLimit: s.forwarderExpenseTypes.noInvoicePerDayLimit,
    noInvoiceFinanceLeadItemApprovalLimit: s.forwarderExpenseTypes.noInvoiceFinanceLeadItemApprovalLimit,
    noInvoiceDirectorDayApprovalLimit: s.forwarderExpenseTypes.noInvoiceDirectorDayApprovalLimit,
    noInvoicePolicyVersion: s.forwarderExpenseTypes.noInvoicePolicyVersion,
  })
    .from(s.forwarderExpenseTypes)
    .where(eq(s.forwarderExpenseTypes.code, expenseTypeCode))
    .limit(1);
  return policy ?? null;
}

async function getTripExpenseNoInvoiceState(
  txOrDb: DbLike,
  expenseId: number,
): Promise<TripExpenseNoInvoiceState | null> {
  const [expense] = await txOrDb.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    expenseType: s.tripExpenses.expenseType,
    buyAmount: s.tripExpenses.buyAmount,
    expenseDate: s.tripExpenses.expenseDate,
    payeeName: s.tripExpenses.payeeName,
    invoiceNumber: s.tripExpenses.invoiceNumber,
    note: s.tripExpenses.note,
    approvalStatus: s.tripExpenses.approvalStatus,
    noInvoiceEvidenceTypes: s.tripExpenses.noInvoiceEvidenceTypes,
  })
    .from(s.tripExpenses)
    .where(eq(s.tripExpenses.id, expenseId))
    .limit(1);
  return expense ?? null;
}

async function countExpensePhotos(txOrDb: DbLike, expenseId: number): Promise<number> {
  const [row] = await txOrDb.select({ count: sql<number>`count(*)::int` })
    .from(s.tripExpensePhotos)
    .where(eq(s.tripExpensePhotos.tripExpenseId, expenseId));
  return row?.count ?? 0;
}

async function sumSameDaySamePayeeCategory(
  txOrDb: DbLike,
  expense: TripExpenseNoInvoiceState,
): Promise<number> {
  if (!expense.expenseDate || !expense.payeeName?.trim()) return Number(expense.buyAmount);
  const [row] = await txOrDb.select({
    total: sql<string>`coalesce(sum(${s.tripExpenses.buyAmount}), 0)::text`,
  })
    .from(s.tripExpenses)
    .where(and(
      eq(s.tripExpenses.expenseType, expense.expenseType),
      eq(s.tripExpenses.expenseDate, expense.expenseDate),
      eq(s.tripExpenses.payeeName, expense.payeeName.trim()),
      ne(s.tripExpenses.id, expense.id),
      inArray(s.tripExpenses.approvalStatus, ['PENDING', 'APPROVED']),
      or(
        sql`${s.tripExpenses.invoiceNumber} IS NULL`,
        sql`btrim(${s.tripExpenses.invoiceNumber}) = ''`,
      ),
    ));
  return Number(row?.total ?? '0') + Number(expense.buyAmount);
}

function missingEvidenceLabels(
  expense: TripExpenseNoInvoiceState,
  policy: ForwarderExpenseTypePolicy,
  photoCount: number,
): string[] {
  const missing: string[] = [];
  if (!expense.expenseDate) missing.push('ngày chi');
  if (!expense.payeeName?.trim()) missing.push('người nhận');
  if (!expense.note?.trim()) missing.push('lý do');

  const evidenceTypes = normalizeEvidenceTypes(expense.noInvoiceEvidenceTypes);
  if (evidenceTypes.length === 0) {
    missing.push('bằng chứng');
    return missing;
  }

  const allowedEvidence = new Set(normalizeEvidenceTypes(policy.noInvoiceEvidenceTypes));
  if (allowedEvidence.size > 0) {
    const invalid = evidenceTypes.filter((item) => !allowedEvidence.has(item));
    if (invalid.length > 0) {
      throw new ApiError(
        400,
        `Chi phí #${expense.id}: bằng chứng ${invalid.join(', ')} không được phép cho hạng mục "${expense.expenseType}"`,
      );
    }
  }

  if (evidenceTypes.includes('ONSITE_PHOTO') && photoCount === 0) {
    missing.push('ảnh hiện trường');
  }
  return missing;
}

function directorRequired(actorRole: string): boolean {
  return actorRole === Role.ADMIN || actorRole === Role.MANAGER;
}

export async function buildNoInvoicePolicySnapshotForExpenseInput(
  txOrDb: DbLike,
  input: { expenseType: string; invoiceNumber?: string | null },
): Promise<NoInvoicePolicySnapshot | null> {
  if (hasInvoice(input.invoiceNumber ?? null)) return null;
  const policy = await getForwarderExpenseTypePolicy(txOrDb, input.expenseType);
  if (!policy) {
    throw new ApiError(400, `Hạng mục "${input.expenseType}" chưa được cấu hình cho chi không hóa đơn`);
  }
  if (policy.requiresInvoice) return null;
  if (!(policy.substituteEvidenceAllowed ?? true)) {
    throw new ApiError(400, `Hạng mục "${input.expenseType}" không cho phép chi hộ không hóa đơn`);
  }
  return buildPolicySnapshot(policy);
}

export async function reviewNoInvoiceDisbursementApproval(
  expenseId: number,
  actorRole: string,
  tx?: Tx,
): Promise<NoInvoiceApprovalOutcome> {
  const q = tx ?? db;
  const expense = await getTripExpenseNoInvoiceState(q, expenseId);
  if (!expense) {
    return { outcome: 'ALLOW', policySnapshot: null, aggregateAmount: 0 };
  }
  if (hasInvoice(expense.invoiceNumber)) {
    return { outcome: 'ALLOW', policySnapshot: null, aggregateAmount: Number(expense.buyAmount) };
  }

  const policy = await getForwarderExpenseTypePolicy(q, expense.expenseType);
  if (!policy) {
    throw new ApiError(400, `Chi phí #${expenseId}: hạng mục "${expense.expenseType}" chưa được cấu hình cho chi không hóa đơn`);
  }
  if (policy.requiresInvoice) {
    return { outcome: 'ALLOW', policySnapshot: null, aggregateAmount: Number(expense.buyAmount) };
  }

  const substituteAllowed = policy.substituteEvidenceAllowed ?? true;
  if (!substituteAllowed) {
    throw new ApiError(400, `Chi phí #${expenseId}: hạng mục "${expense.expenseType}" không cho phép chi hộ không hóa đơn`);
  }

  const policySnapshot = buildPolicySnapshot(policy);
  const photoCount = await countExpensePhotos(q, expenseId);
  const missing = missingEvidenceLabels(expense, policy, photoCount);
  const aggregateAmount = await sumSameDaySamePayeeCategory(q, expense);

  if (missing.length > 0) {
    return {
      outcome: 'RETURN_FOR_EVIDENCE',
      policySnapshot,
      returnReason: `Thiếu chứng từ tối thiểu: ${missing.join(', ')}`,
      aggregateAmount,
    };
  }

  const amount = Number(expense.buyAmount);
  const itemApprovalLimit = Number(policy.noInvoiceFinanceLeadItemApprovalLimit);
  const directorDayLimit = Number(policy.noInvoiceDirectorDayApprovalLimit);
  const requiresDirector = amount > itemApprovalLimit || aggregateAmount > directorDayLimit;

  if (requiresDirector && !directorRequired(actorRole)) {
    throw new ApiError(
      403,
      `Chi phí #${expenseId}: khoản ${amount.toLocaleString('vi-VN')} ₫ hoặc tổng ngày ${aggregateAmount.toLocaleString('vi-VN')} ₫ vượt thẩm quyền tài chính, cần giám đốc phê duyệt`,
    );
  }

  return { outcome: 'ALLOW', policySnapshot, aggregateAmount };
}

export interface NoInvoiceDisbursementItem {
  expenseId: number;
  tripId: number;
  tripCode: string | null;
  expenseTypeCode: string;
  expenseTypeName: string;
  buyAmount: number;
  note: string | null;
  supplierId: number | null;
  supplierName: string | null;
  approverId: number | null;
  approverName: string | null;
  approvedAt: string | null;
  overThreshold: boolean;
  createdAt: string;
}

export interface NoInvoiceDisbursementReport {
  from: string;
  to: string;
  items: NoInvoiceDisbursementItem[];
  totals: {
    count: number;
    sumBuyAmount: number;
    overThresholdCount: number;
    overThresholdSum: number;
  };
}

export async function getNoInvoiceDisbursementReport(opts: {
  from: string;
  to: string;
  approverId?: number;
  categoryCode?: string;
} = { from: '1970-01-01', to: '2999-12-31' }): Promise<NoInvoiceDisbursementReport> {
  const expenseRows = await db.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    expenseType: s.tripExpenses.expenseType,
    buyAmount: s.tripExpenses.buyAmount,
    note: s.tripExpenses.note,
    supplierId: s.tripExpenses.supplierId,
    createdAt: s.tripExpenses.createdAt,
    policySnapshot: s.tripExpenses.noInvoicePolicySnapshot,
  })
    .from(s.tripExpenses)
    .where(and(
      eq(s.tripExpenses.approvalStatus, 'APPROVED'),
      or(
        sql`${s.tripExpenses.invoiceNumber} IS NULL`,
        sql`btrim(${s.tripExpenses.invoiceNumber}) = ''`,
      ),
      gte(sql`DATE(${s.tripExpenses.createdAt})`, opts.from),
      lte(sql`DATE(${s.tripExpenses.createdAt})`, opts.to),
      opts.categoryCode ? eq(s.tripExpenses.expenseType, opts.categoryCode) : sql`TRUE`,
    ));

  if (expenseRows.length === 0) {
    return {
      from: opts.from,
      to: opts.to,
      items: [],
      totals: { count: 0, sumBuyAmount: 0, overThresholdCount: 0, overThresholdSum: 0 },
    };
  }

  const expenseIds = expenseRows.map((row) => row.id);
  const typeCodes = [...new Set(expenseRows.map((row) => row.expenseType))];
  const [typeRows, tripRows, supplierRows, auditRows] = await Promise.all([
    db.select({ code: s.forwarderExpenseTypes.code, name: s.forwarderExpenseTypes.name })
      .from(s.forwarderExpenseTypes)
      .where(inArray(s.forwarderExpenseTypes.code, typeCodes)),
    db.select({ id: s.trips.id, tripCode: s.trips.tripCode })
      .from(s.trips)
      .where(inArray(s.trips.id, [...new Set(expenseRows.map((row) => row.tripId))])),
    db.select({ id: s.suppliers.id, name: s.suppliers.name })
      .from(s.suppliers)
      .where(inArray(s.suppliers.id, [...new Set(expenseRows.map((row) => row.supplierId).filter((value): value is number => value != null))])),
    db.select({
      entityId: s.auditLogs.entityId,
      userId: s.auditLogs.userId,
      actorName: s.auditLogs.actorName,
      timestamp: s.auditLogs.timestamp,
    })
      .from(s.auditLogs)
      .where(and(
        eq(s.auditLogs.entityType, 'trip-expenses'),
        inArray(s.auditLogs.entityId, expenseIds),
        sql`${s.auditLogs.message} LIKE '%đã phê duyệt%'`,
      ))
      .orderBy(desc(s.auditLogs.timestamp)),
  ]);

  const typeMap = new Map(typeRows.map((row) => [row.code, row.name]));
  const tripMap = new Map(tripRows.map((row) => [row.id, row.tripCode]));
  const supplierMap = new Map(supplierRows.map((row) => [row.id, row.name]));
  const auditMap = new Map<number, { userId: number | null; actorName: string | null; timestamp: Date }>();
  for (const row of auditRows) {
    if (row.entityId != null && !auditMap.has(row.entityId)) {
      auditMap.set(row.entityId, { userId: row.userId, actorName: row.actorName, timestamp: row.timestamp });
    }
  }

  const items = expenseRows.flatMap<NoInvoiceDisbursementItem>((row) => {
    const audit = auditMap.get(row.id);
    if (opts.approverId != null && audit?.userId !== opts.approverId) return [];
    const snapshot = row.policySnapshot as NoInvoicePolicySnapshot | null;
    const financeLeadLimit = Number(snapshot?.financeLeadItemApprovalLimit ?? DIRECTOR_THRESHOLD);
    const overThreshold = Number(row.buyAmount) > financeLeadLimit;
    return [{
      expenseId: row.id,
      tripId: row.tripId,
      tripCode: tripMap.get(row.tripId) ?? null,
      expenseTypeCode: row.expenseType,
      expenseTypeName: typeMap.get(row.expenseType) ?? row.expenseType,
      buyAmount: Number(row.buyAmount),
      note: row.note,
      supplierId: row.supplierId,
      supplierName: row.supplierId != null ? (supplierMap.get(row.supplierId) ?? null) : null,
      approverId: audit?.userId ?? null,
      approverName: audit?.actorName ?? null,
      approvedAt: audit?.timestamp.toISOString() ?? null,
      overThreshold,
      createdAt: row.createdAt.toISOString(),
    }];
  });

  items.sort((left, right) => right.buyAmount - left.buyAmount);

  return {
    from: opts.from,
    to: opts.to,
    items,
    totals: {
      count: items.length,
      sumBuyAmount: items.reduce((sum, item) => sum + item.buyAmount, 0),
      overThresholdCount: items.filter((item) => item.overThreshold).length,
      overThresholdSum: items.filter((item) => item.overThreshold).reduce((sum, item) => sum + item.buyAmount, 0),
    },
  };
}
