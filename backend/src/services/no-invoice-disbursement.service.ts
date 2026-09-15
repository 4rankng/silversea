import {
  DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
  NO_INVOICE_DEFAULT_CATEGORY_ALIASES,
  NO_INVOICE_POLICY_DEFAULTS,
  NO_INVOICE_REQUIRED_SCOPE,
  type NoInvoiceEvidenceType,
  type NoInvoicePolicySnapshot,
} from '@tingting/shared';
import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
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
};

export const PER_ITEM_THRESHOLD = NO_INVOICE_POLICY_DEFAULTS.perItemLimit;

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

export function buildNoInvoicePolicySnapshot(policy: ForwarderExpenseTypePolicy): NoInvoicePolicySnapshot {
  return {
    expenseTypeCode: policy.code,
    expenseTypeName: policy.name,
    defaultCategoryAliases: [...(NO_INVOICE_DEFAULT_CATEGORY_ALIASES[policy.code] ?? [policy.name])],
    substituteEvidenceAllowed: policy.substituteEvidenceAllowed ?? true,
    allowedEvidenceTypes: normalizeEvidenceTypes(policy.noInvoiceEvidenceTypes),
    perItemLimit: String(policy.noInvoicePerItemLimit),
    perDayLimit: String(policy.noInvoicePerDayLimit),
    requiredScope: NO_INVOICE_REQUIRED_SCOPE,
    exceptionReasonRequiredWhenThresholdExceeded: true,
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
  })
    .from(s.forwarderExpenseTypes)
    .where(eq(s.forwarderExpenseTypes.code, expenseTypeCode))
    .limit(1);
  return policy ?? null;
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
  if (policy.requiresInvoice) {
    throw new ApiError(400, `Hạng mục "${input.expenseType}" bắt buộc phải có hóa đơn`);
  }
  if (!(policy.substituteEvidenceAllowed ?? true)) {
    throw new ApiError(400, `Hạng mục "${input.expenseType}" không cho phép chi hộ không hóa đơn`);
  }
  return buildNoInvoicePolicySnapshot(policy);
}

export interface NoInvoiceDisbursementItem {
  expenseId: number;
  tripId: number;
  shipmentId: number | null;
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
      inArray(s.tripExpenses.approvalStatus, ['RECORDED', 'APPROVED']),
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
    db.select({ id: s.trips.id, tripCode: s.trips.tripCode, shipmentId: s.trips.shipmentId })
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
  const tripMap = new Map(tripRows.map((row) => [row.id, row]));
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
    const itemLimit = Number(snapshot?.perItemLimit ?? PER_ITEM_THRESHOLD);
    const overThreshold = Number(row.buyAmount) > itemLimit;
    return [{
      expenseId: row.id,
      tripId: row.tripId,
      shipmentId: tripMap.get(row.tripId)?.shipmentId ?? null,
      tripCode: tripMap.get(row.tripId)?.tripCode ?? null,
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
