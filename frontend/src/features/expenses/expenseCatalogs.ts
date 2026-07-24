import type { ExpenseCategory, Supplier } from '@tingting/shared';

export interface ExpenseCatalogs {
  suppliers: Supplier[];
  categories: ExpenseCategory[];
}

export function emptyExpenseCatalogs(): ExpenseCatalogs {
  return { suppliers: [], categories: [] };
}

export function resolveExpenseCatalogs(data: ExpenseCatalogs | undefined): ExpenseCatalogs {
  return data ?? emptyExpenseCatalogs();
}
