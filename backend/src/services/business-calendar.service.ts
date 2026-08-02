import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';

export type PaymentDatePolicy = 'NEXT_BUSINESS_DAY' | 'CALENDAR_DAY';

export interface BusinessCalendarOverride {
  calendarDate: string;
  isWorkingDay: boolean;
}

export interface ResolvedBusinessDate {
  originalDate: string;
  processingDate: string;
  adjusted: boolean;
  policy: PaymentDatePolicy;
}

export interface PaymentDueDateSnapshot extends ResolvedBusinessDate {
  paymentTermDays: number;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROLL_DAYS = 370;

function parseIsoDate(value: string): Date {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error(`Ngày không hợp lệ: ${value}`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Ngày không hợp lệ: ${value}`);
  }
  return parsed;
}

export function formatIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

export function isBusinessDay(
  value: string,
  overrides: ReadonlyMap<string, boolean> = new Map(),
): boolean {
  const override = overrides.get(value);
  if (override != null) return override;
  const day = parseIsoDate(value).getUTCDay();
  return day !== 0 && day !== 6;
}

export function resolveBusinessDate(
  originalDate: string,
  policy: PaymentDatePolicy,
  calendarOverrides: readonly BusinessCalendarOverride[] = [],
): ResolvedBusinessDate {
  parseIsoDate(originalDate);
  if (policy === 'CALENDAR_DAY') {
    return { originalDate, processingDate: originalDate, adjusted: false, policy };
  }

  const overrides = new Map(
    calendarOverrides.map((entry) => [entry.calendarDate, entry.isWorkingDay]),
  );
  let processingDate = originalDate;
  for (let offset = 0; offset <= MAX_ROLL_DAYS; offset += 1) {
    if (isBusinessDay(processingDate, overrides)) {
      return {
        originalDate,
        processingDate,
        adjusted: processingDate !== originalDate,
        policy,
      };
    }
    processingDate = addCalendarDays(processingDate, 1);
  }
  throw new Error('Không tìm thấy ngày làm việc tiếp theo trong phạm vi cấu hình');
}

export async function resolvePaymentDueDate(
  originalDate: string,
  policy: PaymentDatePolicy = 'NEXT_BUSINESS_DAY',
): Promise<ResolvedBusinessDate> {
  if (policy === 'CALENDAR_DAY') return resolveBusinessDate(originalDate, policy);
  const lastCandidate = addCalendarDays(originalDate, MAX_ROLL_DAYS);
  const rows = await db.select({
    calendarDate: s.businessCalendarDays.calendarDate,
    isWorkingDay: s.businessCalendarDays.isWorkingDay,
  })
    .from(s.businessCalendarDays)
    .where(and(
      gte(s.businessCalendarDays.calendarDate, originalDate),
      lte(s.businessCalendarDays.calendarDate, lastCandidate),
    ))
    .orderBy(asc(s.businessCalendarDays.calendarDate));

  return resolveBusinessDate(originalDate, policy, rows);
}

/**
 * Freeze the customer contract and calendar used by one financial obligation.
 * All reads happen through the caller's transaction so the resulting snapshot
 * cannot mix customer/calendar states from different commits.
 */
export async function resolveCustomerPaymentDueDate(
  tx: Tx,
  customerId: number,
  basisDate: string,
): Promise<PaymentDueDateSnapshot> {
  parseIsoDate(basisDate);
  const [customer] = await tx.select({
    paymentTermDays: s.customers.paymentTermDays,
    paymentDatePolicy: s.customers.paymentDatePolicy,
  })
    .from(s.customers)
    .where(eq(s.customers.id, customerId))
    .limit(1);
  if (!customer) {
    throw new Error('Không tìm thấy khách hàng đã chọn để chốt hạn thanh toán');
  }

  const paymentTermDays = customer.paymentTermDays ?? 30;
  const policy = customer.paymentDatePolicy as PaymentDatePolicy;
  const originalDate = addCalendarDays(basisDate, paymentTermDays);
  if (policy === 'CALENDAR_DAY') {
    return {
      ...resolveBusinessDate(originalDate, policy),
      paymentTermDays,
    };
  }

  const lastCandidate = addCalendarDays(originalDate, MAX_ROLL_DAYS);
  const overrides = await tx.select({
    calendarDate: s.businessCalendarDays.calendarDate,
    isWorkingDay: s.businessCalendarDays.isWorkingDay,
  })
    .from(s.businessCalendarDays)
    .where(and(
      gte(s.businessCalendarDays.calendarDate, originalDate),
      lte(s.businessCalendarDays.calendarDate, lastCandidate),
    ))
    .orderBy(asc(s.businessCalendarDays.calendarDate));

  return {
    ...resolveBusinessDate(originalDate, policy, overrides),
    paymentTermDays,
  };
}

/**
 * O2C rev1 §B0: resolve a supplier's payment due date for ONE financial
 * obligation. Suppliers carry two distinct debt milestones (`chiHoDueDays`
 * for chi-hộ disbursements, `cuocDueDays` for freight/cước) — the caller
 * selects which via `kind`. Unlike customers, suppliers have no
 * `paymentDatePolicy` column; we default to CALENDAR_DAY (no business-day
 * rolling) to keep supplier due dates predictable.
 *
 * Returns `paymentTermDays: null` when the supplier field is unset, so the
 * ledger can leave `paymentTermDaysApplied` null and aging falls back to its
 * global default — feature is opt-in per supplier per kind.
 */
export async function resolveSupplierPaymentDueDate(
  tx: Tx,
  supplierId: number,
  kind: 'CHI_HO' | 'CUOC',
  basisDate: string,
): Promise<PaymentDueDateSnapshot | null> {
  parseIsoDate(basisDate);
  const [supplier] = await tx.select({
    chiHoDueDays: s.suppliers.chiHoDueDays,
    cuocDueDays: s.suppliers.cuocDueDays,
  })
    .from(s.suppliers)
    .where(eq(s.suppliers.id, supplierId))
    .limit(1);
  if (!supplier) {
    throw new Error(`Không tìm thấy nhà cung cấp #${supplierId} để chốt hạn thanh toán`);
  }

  const paymentTermDays = kind === 'CHI_HO' ? supplier.chiHoDueDays : supplier.cuocDueDays;
  if (paymentTermDays == null) {
    return null;  // unset → ledger leaves paymentTermDaysApplied null
  }
  const policy: PaymentDatePolicy = 'CALENDAR_DAY';
  const originalDate = addCalendarDays(basisDate, paymentTermDays);
  return {
    ...resolveBusinessDate(originalDate, policy),
    paymentTermDays,
  };
}

export function calendarDaysOverdue(processingDate: string, asOf: Date = new Date()): number {
  const due = parseIsoDate(processingDate).getTime();
  const asOfDate = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.max(0, Math.floor((asOfDate - due) / (24 * 60 * 60 * 1000)));
}
