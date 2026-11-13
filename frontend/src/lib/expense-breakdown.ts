import { coveredSettlementIdentity, mergedContainerLabel, settlementLotIdentityTitle } from '@tingting/shared';

interface ExpenseTypeOption {
  code: string;
  name: string;
}

interface ExpenseLike {
  expenseType: string;
  buyAmount: string | number;
}

/** Vietnamese fallback labels for expense type codes */
const EXPENSE_TYPE_VI: Record<string, string> = {
  LIFTING: 'Nâng container',
  LOWERING: 'Hạ container',
  CUSTOMS: 'Hải quan',
  WEIGHING: 'Cân hàng',
  INFRASTRUCTURE: 'Hạ tầng',
  INSPECTION: 'Kiểm tra',
  INSPECTION_SVC: 'Dịch vụ kiểm tra',
  PORT_STORAGE: 'Lưu bãi',
  CLEANING: 'Vệ sinh container',
  OTHER: 'Khác',
};

/**
 * Group expenses by their human-readable type label,
 * accumulating total amounts per category.
 */
export function groupExpensesByType(
  expenses: readonly ExpenseLike[],
  expenseTypeOptions: readonly ExpenseTypeOption[],
): Map<string, number> {
  const groups = new Map<string, number>();
  for (const exp of expenses) {
    const label = expenseTypeOptions.find(t => t.code === exp.expenseType)?.name ?? EXPENSE_TYPE_VI[exp.expenseType] ?? exp.expenseType;
    groups.set(label, (groups.get(label) ?? 0) + Number(exp.buyAmount));
  }
  return groups;
}

/** SIL-811 — one expense row as the slip grouping sees it: its lot identity
 *  (customer shorthand, Bill/Booking, tờ khai) plus the container scope it was
 *  declared on (a specific cont, or the whole lot = 'Phí chung lô'). */
export interface SettlementExpenseLike extends ExpenseLike {
  containerNumber?: string | null;
  departureDate?: string | null;
  invoiceNumber?: string | null;
  shipmentId?: number | null;
  tripId?: number | null;
  customerName?: string | null;
  billRef?: string | null;
  tradeDirection?: string | null;
  /** Tờ khai of THIS row's container (null on lot-wide rows). */
  declarationNumber?: string | null;
  /** Every named container of the lot (id-asc) — the merged roll-call source. */
  lotContainerNumbers?: readonly string[] | null;
  /** Every non-empty tờ khai of the lot's containers (id-asc, deduped). */
  lotDeclarationNumbers?: readonly string[] | null;
}

/** One per-lot expense block of the slip, headed by its identity title. */
export interface SettlementExpenseBlock {
  /** React key — stable per (lot, container scope). */
  key: string;
  /** `LONGMINH · Bill: R8B-472 · TK: 10859073650 · 2 cont: MSKU1234570, MSKU1234565`. */
  identityTitle: string;
  total: number;
  minDepartureDate: string | null;
  byType: Map<string, number>;
  expenses: SettlementExpenseLike[];
}

/**
 * The row's own container cell: the assigned cont, else the lot's merged
 * roll-call ('2 cont: …'), else the honest lot-wide scope label. Never
 * 'Không rõ container'.
 */
export function rowContainerLabel(exp: SettlementExpenseLike): string {
  return exp.containerNumber?.trim()
    || mergedContainerLabel(exp.lotContainerNumbers ?? [])
    || 'Phí chung lô';
}

function identityOf(rows: readonly SettlementExpenseLike[]): string {
  const covered = coveredSettlementIdentity(rows);
  const first = rows[0];
  return settlementLotIdentityTitle({
    customerName: first?.customerName,
    billRef: first?.billRef,
    tradeDirection: first?.tradeDirection,
    declarationNumbers: covered.declarationNumbers,
    containerNumbers: covered.containerNumbers,
  });
}

/**
 * SIL-811 — group the slip's expenses into per-lot blocks headed by the
 * identity title (customer shorthand · Bill/Booking + tờ khai · Số cont).
 *
 * Block granularity: one block per container scope inside a lot — a row
 * assigned one cont heads under that cont; 'Phí chung lô' rows head under the
 * lot's merged roll-call. The scopes COALESCE into a single lot block when the
 * lot is single-container or when Ops picked ALL its conts ("cộng gộp nếu Ops
 * chọn tất cả số cont của lô hàng"). Blocks travel chronologically by their
 * earliest trip departure date (the print/export order, feedback202606 C3).
 */
export function groupExpensesForSettlementSlip(
  expenses: readonly SettlementExpenseLike[],
  expenseTypeOptions: readonly ExpenseTypeOption[],
): SettlementExpenseBlock[] {
  const typeLabel = (code: string) =>
    expenseTypeOptions.find(t => t.code === code)?.name ?? EXPENSE_TYPE_VI[code] ?? code;

  // Dynamic multi-key bucketing (lot × scope) → Map.
  const byLot = new Map<number, SettlementExpenseLike[]>();
  for (const exp of expenses) {
    const lotKey = exp.shipmentId ?? exp.tripId ?? 0;
    const rows = byLot.get(lotKey);
    if (rows) rows.push(exp); else byLot.set(lotKey, [exp]);
  }

  const blocks: SettlementExpenseBlock[] = [];
  for (const [lotKey, rows] of byLot) {
    const lotContainers = [...new Set((rows[0]?.lotContainerNumbers ?? []).map((name) => name.trim()).filter(Boolean))];
    const assigned = new Set(rows.map((row) => row.containerNumber?.trim()).filter(Boolean));
    const coalesce = lotContainers.length <= 1
      || (assigned.size > 0 && lotContainers.every((name) => assigned.has(name)));

    const byScope = new Map<string, SettlementExpenseLike[]>();
    for (const row of rows) {
      const scopeKey = coalesce ? 'lot' : (row.containerNumber?.trim() ? `c:${row.containerNumber.trim()}` : 'lot');
      const scopeRows = byScope.get(scopeKey);
      if (scopeRows) scopeRows.push(row); else byScope.set(scopeKey, [row]);
    }

    for (const [scopeKey, scopeRows] of byScope) {
      let total = 0;
      let minDepartureDate: string | null = null;
      const byType = new Map<string, number>();
      for (const exp of scopeRows) {
        const amount = Number(exp.buyAmount);
        total += amount;
        const label = typeLabel(exp.expenseType);
        byType.set(label, (byType.get(label) ?? 0) + amount);
        if (exp.departureDate && (!minDepartureDate || exp.departureDate < minDepartureDate)) {
          minDepartureDate = exp.departureDate;
        }
      }
      blocks.push({
        key: `${lotKey}:${scopeKey}`,
        identityTitle: identityOf(scopeRows),
        total,
        minDepartureDate,
        byType,
        expenses: scopeRows,
      });
    }
  }

  return blocks.sort((a, b) => {
    if (a.minDepartureDate && b.minDepartureDate && a.minDepartureDate !== b.minDepartureDate) {
      return a.minDepartureDate < b.minDepartureDate ? -1 : 1;
    }
    if (a.minDepartureDate && !b.minDepartureDate) return -1;
    if (!a.minDepartureDate && b.minDepartureDate) return 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}
