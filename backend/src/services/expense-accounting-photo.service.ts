import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { ExpenseSourceKind } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { sniffImageType } from '../lib/format';
import { storageService } from './storage.service';
import { ensureLegacyExpenseSource } from './expense-accounting-source.service';
import { assertExpenseActorScope, type ExpenseActor } from './expense-accounting-write.service';

export async function attachAccountingExpensePhoto(actor: ExpenseActor, kind: ExpenseSourceKind, id: number, file: Express.Multer.File) {
  const source = await db.transaction(async tx => {
    const row = await ensureLegacyExpenseSource(tx, kind, id, actor.userId);
    assertExpenseActorScope(actor, row);
    if (actor.role === 'CUS') throw new ApiError(403, 'CUS không được cập nhật chứng từ chi phí.');
    return row;
  });
  if (!sniffImageType(file.buffer)) throw new ApiError(400, 'Chọn ảnh JPG, PNG hoặc HEIC hợp lệ.');
  const buffer = await sharp(file.buffer).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  const storageKey = `accounting-expense-photos/${source.id}/${createHash('sha256').update(buffer).digest('hex')}.jpg`;
  await storageService.upload(buffer, storageKey);
  await db.insert(s.expenseAccountingEvidence).values({ expenseAccountingSourceId: source.id, storageKey, uploadedById: actor.userId }).onConflictDoNothing();
  return { storageKey, url: `/api/photos/${storageKey}` };
}
