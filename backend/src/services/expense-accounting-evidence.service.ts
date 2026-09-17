import { and, eq } from 'drizzle-orm';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import type { ExpenseAccountingSource } from './expense-accounting-source.service';
import type { ExpenseActor } from './expense-accounting-write.service';
import { ApiError } from '../errors';

export async function assertExpenseEvidenceAttachments(tx: Tx, actor: ExpenseActor, source: ExpenseAccountingSource, keys: string[]) {
  for (const key of keys) {
    if (source.photoStorageKeys.includes(key)) continue;
    const [attachment] = await tx.select({ id: s.expenseAccountingEvidence.id }).from(s.expenseAccountingEvidence)
      .where(and(eq(s.expenseAccountingEvidence.storageKey, key), eq(s.expenseAccountingEvidence.expenseAccountingSourceId, source.id)));
    if (attachment) continue;
    if (source.sourceKind === 'OPS') {
      // OPS uploads are scoped by authenticated uploader in their storage key.
      if (!new RegExp(`^ops-expense-photos/${actor.userId}/[0-9a-f]{32}\\.(jpg|png)$`).test(key)) throw new ApiError(400, 'Ảnh phải do bạn tải lên từ khoản chi này.');
    } else if (source.sourceKind === 'DRIVER') {
      const [photo] = await tx.select({ id: s.tripPhotos.id }).from(s.tripPhotos).where(and(
        eq(s.tripPhotos.storageKey, key), eq(s.tripPhotos.tripId, source.tripId!), eq(s.tripPhotos.uploadedBy, actor.userId)));
      if (!photo) throw new ApiError(400, 'Ảnh phải do bạn tải lên cho đúng chuyến.');
    } else throw new ApiError(400, 'Bổ sung chứng từ từ màn hình nguồn chi phí.');
  }
  if (new Set(keys).size !== keys.length) throw new ApiError(400, 'Ảnh chứng từ bị trùng.');
}
