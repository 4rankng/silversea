import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { OPS_EXPENSE_TYPE_DEFAULTS, recoverableCostListQuerySchema } from '@tingting/shared';
import type { z } from 'zod';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';

/** Sort keys accepted by the list endpoint (mirrors RECOVERABLE_COST_SORT_KEYS
 * in the shared query schema — keep the two lists in sync). */
export type RecoverableCostSortKey = NonNullable<
  z.infer<typeof recoverableCostListQuerySchema>['sortBy']
>;

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
  approvalStatus?: 'DRAFT' | 'RECORDED' | 'VOIDED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  customerId?: number;
  sortBy?: RecoverableCostSortKey;
  sortDir?: 'asc' | 'desc';
}

// ─── Server-side column sorting ──────────────────────────────────────────────
//
// One expression per sortable column; all are single-valued per expense row
// (no row-multiplying joins — claim/type joins are already 1:1 in the base
// query). NULLs sort last in both directions via the `nulls last` wrapper at
// the call site, with the expense id as the stable tiebreaker.

/** Mirrors the page's expenseLabel(): catalog name → shared OPS default name
 * (generated from the same shared map) → fixed fallback. */
function expenseNameSortSql(): SQL {
  const fallbacks = Object.entries(OPS_EXPENSE_TYPE_DEFAULTS).map(
    ([code, def]) => sql`when ${s.tripExpenses.expenseType} = ${code} then ${def.name}`,
  );
  return sql`coalesce(
    nullif(btrim(${s.forwarderExpenseTypes.name}), ''),
    case ${sql.join(fallbacks, sql` `)} end,
    'Khoản chi khác'
  )`;
}

/** Mirrors the page's variance(): sell − buy, computed numerically in SQL. */
const varianceSortSql = sql`(${s.tripExpenses.sellAmount} - ${s.tripExpenses.buyAmount})`;

/** Mirrors the page's evidenceLabel(): invoice > substitute evidence > none. */
const evidenceRankSql = sql`case
  when nullif(btrim(${s.tripExpenses.invoiceNumber}), '') is not null then 2
  when jsonb_array_length(${s.tripExpenses.noInvoiceEvidenceTypes}) > 0 then 1
  else 0
end`;

/**
 * Mirrors currentExpenseSourceVersion() exactly: the JS builder stringifies the
 * driver-parsed Date via toISOString(). The driver reads the naive `updated_at`
 * column in the Node process timezone, so the SQL counterpart shifts the
 * stored UTC wall time by the same live offset before formatting. Microseconds
 * are truncated to milliseconds because JS Dates carry millisecond precision.
 * numeric(15,0)::text matches Number() stringification at this scale.
 */
function currentSourceVersionSortSql(): SQL {
  const offsetMinutesEast = -new Date().getTimezoneOffset();
  return sql`'expense:' || to_char(
    (date_trunc('milliseconds', ${s.tripExpenses.updatedAt}) - (${offsetMinutesEast} * interval '1 minute'))
      at time zone 'UTC' at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) || ':' || ${s.tripExpenses.approvalStatus} || ':' || ${s.tripExpenses.sellAmount}::text`;
}

/**
 * Eligibility rank as SQL, replicating evaluateRecoverableEligibility's branch
 * order over the same inputs. Rank = the frontend state order
 * (READY_FOR_REVIEW 0, ELIGIBLE 1, BLOCKED 2, ALREADY_CLAIMED 3,
 * ADJUSTMENT_REQUIRED 4) so asc puts the review queue first. A recoverable-cost
 * test asserts SQL and JS agree on every branch, including the version-string
 * comparison.
 */
function eligibilityRankSortSql(): SQL {
  const claimed = s.billingDocumentRecoverableClaims;
  return sql`case
    when ${claimed.expenseId} is not null then case
      when coalesce(${s.billingDocuments.debitNoteStatus}, '') <> 'DRAFT'
        and ${claimed.sourceVersion} is distinct from ${currentSourceVersionSortSql()}
        then 4
      else 3
    end
    when ${s.tripExpenses.approvalStatus} not in ('RECORDED', 'APPROVED') then 2
    when ${s.tripExpenses.sellAmount} <= 0 then 2
    when ${s.tripExpenses.recoverablePrincipalAmount} is null
      or ${s.tripExpenses.serviceFeeAmount} is null then 2
    when (${s.tripExpenses.recoverablePrincipalAmount} + ${s.tripExpenses.serviceFeeAmount}) <> ${s.tripExpenses.sellAmount} then 2
    when ${s.tripExpenses.expenseDate} is null then 2
    when coalesce(${s.forwarderExpenseTypes.requiresInvoice}, false)
      and (nullif(btrim(${s.tripExpenses.invoiceNumber}), '') is null or ${s.tripExpenses.invoiceDate} is null) then 2
    when not coalesce(${s.forwarderExpenseTypes.requiresInvoice}, false)
      and nullif(btrim(${s.tripExpenses.invoiceNumber}), '') is null
      and (not coalesce(${s.forwarderExpenseTypes.substituteEvidenceAllowed}, true)
        or jsonb_array_length(${s.tripExpenses.noInvoiceEvidenceTypes}) = 0) then 2
    else 1
  end`;
}

/** Sort expression whitelist; keys mirror RECOVERABLE_COST_SORT_KEYS in the
 * shared query schema. */
function recoverableSortSql(key: RecoverableCostSortKey): SQL {
  switch (key) {
    case 'customerName': return sql`${s.customers.name}`;
    case 'shipmentCode': return sql`${s.shipments.shipmentCode}`;
    case 'tripCode': return sql`${s.trips.tripCode}`;
    case 'expenseName': return expenseNameSortSql();
    case 'buyAmount': return sql`${s.tripExpenses.buyAmount}`;
    case 'recoverablePrincipalAmount': return sql`${s.tripExpenses.recoverablePrincipalAmount}`;
    case 'serviceFeeAmount': return sql`${s.tripExpenses.serviceFeeAmount}`;
    case 'sellAmount': return sql`${s.tripExpenses.sellAmount}`;
    case 'variance': return varianceSortSql;
    case 'evidence': return evidenceRankSql;
    case 'eligibility': return eligibilityRankSortSql();
  }
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
      blockedReason: 'Chi phí đã thuộc một giấy báo nợ.',
    };
  }
  if (input.approvalStatus !== 'RECORDED' && input.approvalStatus !== 'APPROVED') {
    return { state: 'BLOCKED', blockedReason: 'Khoản chi chưa được ghi nhận hợp lệ. Mở khoản chi để hoàn thiện dữ liệu và chứng từ.' };
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
      and(
        eq(s.billingDocumentRecoverableClaims.expenseId, s.tripExpenses.id),
        isNull(s.billingDocumentRecoverableClaims.releasedAt),
      ),
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
  return conditions;
}

export async function listRecoverableCosts(
  actor: Pick<AuthUser, 'userId' | 'role'>,
  filters: RecoverableCostFilters,
) {
  const conditions = await recoverableConditions(actor, filters);
  // Absent sort params keep the historical newest-first order exactly.
  const sortOrder = filters.sortBy
    ? [
        sql`${recoverableSortSql(filters.sortBy)} ${filters.sortDir === 'desc' ? sql`desc` : sql`asc`} nulls last`,
        asc(s.tripExpenses.id),
      ]
    : [desc(s.tripExpenses.updatedAt), desc(s.tripExpenses.id)];
  const [rows, totalRows] = await Promise.all([
    baseRecoverableQuery()
      .where(and(...conditions))
      .orderBy(...sortOrder)
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
      and(
        eq(s.billingDocumentRecoverableClaims.expenseId, s.tripExpenses.id),
        isNull(s.billingDocumentRecoverableClaims.releasedAt),
      ),
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
  return toRecoverableCost(row);
}
