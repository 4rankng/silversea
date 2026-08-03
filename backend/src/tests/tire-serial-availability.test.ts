import { describe, test, after } from 'node:test';
import assert from 'node:assert';
import { eq } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import {
  assertTireSerialAvailable,
  installTire,
  tireSerialConflictMessage,
} from '../services/tire.service';

const createdIds: number[] = [];

after(async () => {
  for (const id of createdIds) {
    await db.delete(s.tires).where(eq(s.tires.id, id));
  }
  await client.end();
});

describe('tire serial availability', () => {
  test('formats duplicate serial errors with status and location context', () => {
    const message = tireSerialConflictMessage({
      id: 1,
      serial: '295304044',
      status: 'IN_USE',
      truckPlate: '15C-12345',
      trailerPlate: null,
      position: 'Lốp lái đầu kéo',
      deletedAt: null,
      disposalDate: null,
    });

    assert.strictEqual(
      message,
      'Serial lốp 295304044 đã tồn tại (Đang dùng, xe 15C-12345, vị trí Lốp lái đầu kéo)',
    );
  });

  test('blocks duplicate serials while allowing the current tire id on update', async () => {
    const serial = `TIRE-DUP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [created] = await db.insert(s.tires).values({ serial, status: 'IN_STOCK' }).returning();
    createdIds.push(created.id);

    await assert.rejects(
      () => assertTireSerialAvailable(serial),
      (err: unknown) => err instanceof ApiError
        && err.statusCode === 409
        && err.message.includes(`Serial lốp ${serial} đã tồn tại`)
        && err.message.includes('kho lốp dự phòng'),
    );

    await assert.doesNotReject(() => assertTireSerialAvailable(serial, created.id));
  });

  test('rejects installing onto a missing trailer target', async () => {
    const serial = `TIRE-INSTALL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [created] = await db.insert(s.tires).values({ serial, status: 'IN_STOCK' }).returning();
    createdIds.push(created.id);

    await assert.rejects(
      () => installTire(created.id, { trailerId: 2_147_483_647, position: 'P1' }, created.updatedAt),
      (err: unknown) => err instanceof Error && /Không tìm thấy rơ-moóc/.test(err.message),
    );
  });
});
