/**
 * Pure subjectKey → human-label formatting for the approval-center queue.
 *
 * subjectKey is a colon-delimited internal reference (e.g.
 * `customer:78404:receipt:REC-1787478843148`); an approver must not have to
 * decode it to know what they are approving. This module owns the parsing
 * only — the batched entity lookups live in
 * governance-subject-labels.service.ts, which feeds the context maps below.
 * Rows whose format we do not parse resolve to null and the UI falls back to
 * the raw key (bare trip codes and treasury codes are already human-readable
 * and deliberately pass through that way).
 */

export interface SubjectLabelContext {
  /** customerId → display name (shortName preferred, name as fallback). */
  customerNames: Map<number, string>;
  /** advanceSettlementId → settlement code. */
  settlementCodes: Map<number, string>;
  /** userId (driver) → full name, for salary-period keys. */
  driverNames: Map<number, string>;
}

const CUSTOMER_RECEIPT_RE = /^customer:(\d+):receipt:(.+)$/;
const ADVANCE_SETTLEMENT_RE = /^advance-settlement:(\d+)(?::|$)/;
const TRIP_EXPENSE_RE = /^trip-expense:(\d+):decision$/;
const PAYMENT_RECEIPT_REFUND_RE = /^payment-receipt:(.+):refund:v\d+$/;
const DRIVER_SALARY_RE = /^(\d+):(\d{4})-(0[1-9]|1[0-2])$/;
const SALARY_PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function subjectKeyCustomerIds(keys: Array<string | null>): Set<number> {
  const ids = new Set<number>();
  for (const key of keys) {
    const m = key?.match(CUSTOMER_RECEIPT_RE);
    if (m) ids.add(Number(m[1]));
  }
  return ids;
}

export function subjectKeySettlementIds(keys: Array<string | null>): Set<number> {
  const ids = new Set<number>();
  for (const key of keys) {
    const m = key?.match(ADVANCE_SETTLEMENT_RE);
    if (m) ids.add(Number(m[1]));
  }
  return ids;
}

export function subjectKeyDriverIds(keys: Array<string | null>): Set<number> {
  const ids = new Set<number>();
  for (const key of keys) {
    const m = key?.match(DRIVER_SALARY_RE);
    if (m) ids.add(Number(m[1]));
  }
  return ids;
}

export function resolveSubjectLabel(
  key: string | null | undefined,
  ctx: SubjectLabelContext,
): string | null {
  if (!key) return null;

  let m = key.match(CUSTOMER_RECEIPT_RE);
  if (m) {
    const name = ctx.customerNames.get(Number(m[1]));
    return name ? `Khách hàng ${name} — phiếu thu ${m[2]}` : `Phiếu thu ${m[2]}`;
  }

  m = key.match(ADVANCE_SETTLEMENT_RE);
  if (m) {
    const code = ctx.settlementCodes.get(Number(m[1]));
    return code ? `Phiếu thanh toán ${code}` : `Phiếu thanh toán #${m[1]}`;
  }

  m = key.match(TRIP_EXPENSE_RE);
  if (m) return `Chi phí chuyến đi #${m[1]}`;

  m = key.match(PAYMENT_RECEIPT_REFUND_RE);
  if (m) return `Hoàn tiền phiếu thu ${m[1]}`;

  m = key.match(DRIVER_SALARY_RE);
  if (m) {
    const name = ctx.driverNames.get(Number(m[1]));
    const period = `${m[3]}/${m[2]}`;
    return name ? `Lương ${name} — kỳ ${period}` : `Bảng lương lái xe — kỳ ${period}`;
  }

  m = key.match(SALARY_PERIOD_RE);
  if (m) return `Kỳ lương ${m[2]}/${m[1]}`;

  return null;
}
