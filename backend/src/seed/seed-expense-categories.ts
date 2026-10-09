import { db } from '../db';
import * as schema from '../db/schema';
import { normalizeSeedText } from './seed-identity';

export interface DefaultExpenseCategoryDef {
  name: string;
  isRenewable?: boolean;
  reminderLeadDays?: number;
  requiresInvoice?: boolean;
  substituteEvidenceAllowed?: boolean;
  status?: string;
}

/** Card 091026225710 (FB-033 verify-fail) — standard expense categories for vendor
 *  expenses (/expenses/new). FILLS, never overwrites: a missing category inserts
 *  with defaults; existing categories (and any admin changes) survive untouched. */
export const DEFAULT_EXPENSE_CATEGORIES: readonly DefaultExpenseCategoryDef[] = [
  { name: 'Sửa chữa', isRenewable: false, status: 'ACTIVE' },
  { name: 'Phụ tùng', isRenewable: false, status: 'ACTIVE' },
  { name: 'Vật tư', isRenewable: false, status: 'ACTIVE' },
  { name: 'Bảo hiểm', isRenewable: true, reminderLeadDays: 30, status: 'ACTIVE' },
  { name: 'Đăng kiểm', isRenewable: true, reminderLeadDays: 30, status: 'ACTIVE' },
  { name: 'Phí đường bộ', isRenewable: true, reminderLeadDays: 30, status: 'ACTIVE' },
  {
    name: 'Phí nhiên liệu / dầu',
    isRenewable: false,
    requiresInvoice: false,
    substituteEvidenceAllowed: true,
    status: 'ACTIVE',
  },
] as const;

export async function seedExpenseCategories(): Promise<{ inserted: number }> {
  let inserted = 0;
  const existing = await db.select({
    id: schema.expenseCategories.id,
    name: schema.expenseCategories.name,
    deletedAt: schema.expenseCategories.deletedAt,
  }).from(schema.expenseCategories);

  const byNormalizedName = new Map(
    existing.map((row) => [normalizeSeedText(row.name), row] as const),
  );

  for (const cat of DEFAULT_EXPENSE_CATEGORIES) {
    const key = normalizeSeedText(cat.name);
    const hit = byNormalizedName.get(key);
    if (!hit) {
      await db.insert(schema.expenseCategories).values({
        name: cat.name,
        isRenewable: cat.isRenewable ?? false,
        reminderLeadDays: cat.reminderLeadDays ?? 30,
        requiresInvoice: cat.requiresInvoice ?? false,
        substituteEvidenceAllowed: cat.substituteEvidenceAllowed ?? true,
        status: cat.status ?? 'ACTIVE',
      });
      inserted += 1;
    }
  }

  return { inserted };
}
