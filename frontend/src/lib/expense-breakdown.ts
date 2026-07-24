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

/** An expense that also carries its container + trip departure date, so it can
 *  be grouped by container and ordered chronologically (feedback202606 C3). */
interface ContainerExpenseLike extends ExpenseLike {
  containerNumber?: string | null;
  departureDate?: string | null;
}

/** Fallback label for expenses with no resolved container number. */
const NO_CONTAINER = 'Không rõ container';

/** One container's grouped expenses: total + per-type breakdown + the earliest
 *  trip departure date (used to order containers chronologically). */
export interface ContainerExpenseGroup {
  containerNumber: string;
  total: number;
  minDepartureDate: string | null;
  byType: Map<string, number>;
}

/**
 * Group expenses by container number, each with a per-type sub-breakdown.
 * Containers are returned sorted by earliest trip departure date ascending
 * (chronological, matching the print/export path). Mirrors the print grouping so
 * the on-screen list and the printed settlement read identically.
 */
export function groupExpensesByContainer(
  expenses: readonly ContainerExpenseLike[],
  expenseTypeOptions: readonly ExpenseTypeOption[],
): ContainerExpenseGroup[] {
  const byContainer = new Map<string, ContainerExpenseGroup>();
  const typeLabel = (code: string) =>
    expenseTypeOptions.find(t => t.code === code)?.name ?? EXPENSE_TYPE_VI[code] ?? code;

  for (const exp of expenses) {
    const key = exp.containerNumber?.trim() || NO_CONTAINER;
    let group = byContainer.get(key);
    if (!group) {
      group = { containerNumber: key, total: 0, minDepartureDate: exp.departureDate ?? null, byType: new Map() };
      byContainer.set(key, group);
    }
    const amount = Number(exp.buyAmount);
    group.total += amount;
    const label = typeLabel(exp.expenseType);
    group.byType.set(label, (group.byType.get(label) ?? 0) + amount);
    if (exp.departureDate && (!group.minDepartureDate || exp.departureDate < group.minDepartureDate)) {
      group.minDepartureDate = exp.departureDate;
    }
  }

  return [...byContainer.values()].sort((a, b) => {
    if (a.minDepartureDate && b.minDepartureDate) return a.minDepartureDate < b.minDepartureDate ? -1 : 1;
    if (a.minDepartureDate) return -1;
    if (b.minDepartureDate) return 1;
    return 0;
  });
}
