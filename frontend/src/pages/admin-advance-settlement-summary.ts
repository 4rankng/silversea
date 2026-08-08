import { OPS_EXPENSE_TYPE_DEFAULTS } from '@tingting/shared';

export interface SettlementExpenseSummaryItem {
  tripId: number;
  containerNumber?: string | null;
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
  const containerCount = new Set(
    items
      .map(expense => expense.containerNumber?.trim())
      .filter((containerNumber): containerNumber is string => Boolean(containerNumber)),
  ).size;

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
 * The approval surface is decision-oriented: one horizontal row represents
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

    row.containerCount = Math.max(
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
