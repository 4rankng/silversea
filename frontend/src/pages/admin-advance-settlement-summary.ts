import { OPS_EXPENSE_TYPE_DEFAULTS } from '@tingting/shared';

export interface SettlementExpenseSummaryItem {
  tripId: number;
  containerNumber?: string | null;
  /** SIL-601 (id 702): the owning lot's mode — an LCL lot counts as 1 cont. */
  cargoMode?: 'FCL' | 'LCL' | null;
  /** The owning lot id — the LCL unit is per-LOT, not per-trip (review M1). */
  shipmentId?: number | null;
}

export interface SettlementPlanExpense extends SettlementExpenseSummaryItem {
  tripCode?: string | null;
  departureDate?: string | null;
  customerName?: string | null;
  routeName?: string | null;
  tripContainerCount?: number | null;
  expenseType: string;
  expenseTypeName?: string | null;
  buyAmount: string | number;
}

export interface SettlementPlanRow {
  tripId: number;
  tripCode: string | null;
  departureDate: string | null;
  customerName: string | null;
  routeName: string | null;
  containerCount: number;
  totalExpense: number;
  expenseBreakdown: Array<{
    code: string;
    label: string;
    amount: number;
  }>;
}

export interface SettlementExpenseSummary {
  expenseCount: number;
  tripCount: number;
  containerCount: number;
  label: string;
}

export function summarizeSettlementExpenses(
  expenses: SettlementExpenseSummaryItem[] | undefined,
): SettlementExpenseSummary {
  const items = expenses ?? [];
  const expenseCount = items.length;
  const tripCount = new Set(items.map(expense => expense.tripId)).size;
  const containerNumbers = new Set(
    items
      .map(expense => expense.containerNumber?.trim())
      .filter((containerNumber): containerNumber is string => Boolean(containerNumber)),
  );
  // SIL-601 (id 702, owner ruling 30/10/2026): one LCL lot ≡ 1-cont lot — a
  // numberless LCL lot contributes its virtual cont instead of the 0 the
  // number-only count produced. The unit is per-LOT (review M1): a lot moved
  // via several trips still counts 1. A lot whose expenses already carry a
  // cont number is counted once through that number. FCL keeps counting
  // numbered containers only.
  const lclLotKeys = new Set<number>();
  const lclLotsWithNumber = new Set<number>();
  for (const expense of items) {
    if (expense.cargoMode !== 'LCL') continue;
    const lotKey = expense.shipmentId ?? expense.tripId;
    lclLotKeys.add(lotKey);
    if (expense.containerNumber?.trim()) lclLotsWithNumber.add(lotKey);
  }
  let lclVirtualUnits = 0;
  for (const lotKey of lclLotKeys) {
    if (!lclLotsWithNumber.has(lotKey)) lclVirtualUnits += 1;
  }
  const containerCount = containerNumbers.size + lclVirtualUnits;

  return {
    expenseCount,
    tripCount,
    containerCount,
    label: expenseCount === 0
      ? '0 khoản chi · Chưa có phạm vi liên kết'
      : `${expenseCount} khoản chi · ${tripCount} chuyến · ${containerCount} container`,
  };
}

/**
 * The settlement overview is decision-oriented: one horizontal row represents
 * one transport plan (the trip), while all linked expense lines are rolled up
 * into category amounts for that row.
 */
export function groupSettlementExpensesByTrip(
  expenses: SettlementPlanExpense[] | undefined,
): SettlementPlanRow[] {
  const byTrip = new Map<number, SettlementPlanRow & {
    containers: Set<string>;
    categories: Map<string, { label: string; amount: number }>;
  }>();

  for (const expense of expenses ?? []) {
    let row = byTrip.get(expense.tripId);
    if (!row) {
      row = {
        tripId: expense.tripId,
        tripCode: expense.tripCode ?? null,
        departureDate: expense.departureDate ?? null,
        customerName: expense.customerName ?? null,
        routeName: expense.routeName ?? null,
        containerCount: 0,
        totalExpense: 0,
        expenseBreakdown: [],
        containers: new Set(),
        categories: new Map(),
      };
      byTrip.set(expense.tripId, row);
    }

    const containerNumber = expense.containerNumber?.trim();
    if (containerNumber) row.containers.add(containerNumber);

    const amount = Number(expense.buyAmount) || 0;
    row.totalExpense += amount;
    const current = row.categories.get(expense.expenseType);
    row.categories.set(expense.expenseType, {
      label: expense.expenseTypeName?.trim()
        || OPS_EXPENSE_TYPE_DEFAULTS[expense.expenseType]?.name
        || expense.expenseType,
      amount: (current?.amount ?? 0) + amount,
    });

    // SIL-601 (id 702): one LCL lot ≡ 1-cont lot — a plan row for an LCL trip
    // reads 1, never the 0 its empty container numbers produce.
    row.containerCount = expense.cargoMode === 'LCL'
      ? 1
      : Math.max(
        row.containerCount,
        expense.tripContainerCount ?? 0,
        row.containers.size,
      );
  }

  return [...byTrip.values()]
    .map(({ containers: _containers, categories, ...row }) => ({
      ...row,
      expenseBreakdown: [...categories.entries()]
        .map(([code, value]) => ({ code, ...value }))
        .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
    }))
    .sort((a, b) => {
      if (a.departureDate && b.departureDate) {
        return a.departureDate.localeCompare(b.departureDate);
      }
      if (a.departureDate) return -1;
      if (b.departureDate) return 1;
      return a.tripId - b.tripId;
    });
}
