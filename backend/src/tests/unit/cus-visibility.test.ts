// Team-based visibility cho vai CUS (18/11) — pure law tests, không database.
// 4 nhánh arms trên shipments.created_by; vai khác → []; per-lot decision
// qua fake executor (assertCusLotVisible).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import { Role } from '@tingting/shared';
import {
  cusVisibilityArms,
  cusVisibilityCondition,
  cusLotVisibleFor,
  assertCusLotVisible,
  CUS_LOT_NOT_FOUND_MESSAGE,
} from '../../services/cus-visibility.service';
import { ApiError } from '../../errors';

const dialect = new PgDialect();

function render(chunk: SQL): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(chunk);
}

function actor(role: Role, userId = 7): { userId: number; role: Role } {
  return { userId, role };
}

// Minimal executor shape for assertCusLotVisible. The guard runs (1) the
// shipment select (where().limit()), (2) the creator-role select
// (where().limit()), (3) the group-members join select awaited straight at
// .where() — drizzle builders are thenable, so the fake's where() must be
// awaitable too. Per-call results come from the three arrays in order.
function sequentialExecutor(
  shipments: Array<{ createdBy: number | null }>,
  users: Array<{ role: string }>,
  members: Array<{ userId: number }> = [],
) {
  const calls: number[] = [];
  const next = (fallback: unknown) => {
    calls.push(1);
    const n = calls.length;
    return n === 1 ? shipments : n === 2 ? users : fallback;
  };
  const chain = {
    innerJoin: () => chain,
    where: () => ({
      limit: async () => next([]),
      then: (resolve: (rows: unknown) => unknown, reject: (err: unknown) => unknown) =>
        Promise.resolve(members).then(resolve, reject),
    }),
  };
  return {
    select: () => ({
      from: () => chain,
    }),
  } as never;
}

describe('cusVisibilityArms — vai CUS', () => {
  it('trả đúng 1 điều kiện OR với 3 nhánh khi không có nhóm (mình, NULL, non-CUS creator)', () => {
    const [condition] = cusVisibilityArms(actor(Role.CUS), []);
    assert.ok(condition);
    const { sql } = render(condition);
    // Arm 1: lô của chính mình
    assert.match(sql, /"shipments"\."created_by" = \$1/);
    // Arm co-members absent — không có nhánh in-array khi mảng rỗng
    assert.doesNotMatch(sql, /= any\(/);
    // Arm 3: created_by NULL
    assert.match(sql, /"shipments"\."created_by" is null/);
    // Arm 4: creator không phải vai CUS
    assert.match(sql, /not in \(select id from users where role = 'CUS'\)/);
  });

  it('thêm nhánh co-members khi actor có người cùng nhóm ACTIVE', () => {
    const [condition] = cusVisibilityArms(actor(Role.CUS), [11, 12]);
    const { sql, params } = render(condition!);
    // $1 = chính mình (arm 1), $2/$3 = co-members (arm 2).
    assert.match(sql, /"shipments"\."created_by" in \(\$2, \$3\)/);
    assert.deepEqual(params, [7, 11, 12]);
  });

  it('vai không phải CUS (kể cả ACCOUNTANT/ADMIN) không bao giờ bị scope', () => {
    for (const role of [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.DISPATCHER, Role.CUSTOMER, Role.DRIVER]) {
      assert.deepEqual(cusVisibilityArms(actor(role), [11]), [], `${role} phải trả []`);
    }
  });
});

describe('cusLotVisibleFor — per-lot decision', () => {
  const cus = actor(Role.CUS);

  it('lô của chính mình: pass', () => {
    assert.equal(cusLotVisibleFor(cus, [], 7, 'CUS'), true);
  });

  it('lô của người cùng nhóm: pass', () => {
    assert.equal(cusLotVisibleFor(cus, [11, 12], 12, 'CUS'), true);
  });

  it('created_by NULL: pass (fallback vận hành)', () => {
    assert.equal(cusLotVisibleFor(cus, [], null, null), true);
  });

  it('creator không phải CUS (dispatcher/admin): pass (fallback)', () => {
    assert.equal(cusLotVisibleFor(cus, [], 30, 'DISPATCHER'), true);
  });

  it('creator là CUS khác ngoài nhóm: 404 — không thấy', () => {
    assert.equal(cusLotVisibleFor(cus, [], 99, 'CUS'), false);
  });

  it('creator đã bị xóa khỏi users (role null): pass như fallback non-CUS', () => {
    assert.equal(cusLotVisibleFor(cus, [], 55, null), true);
  });

  it('vai khác luôn pass bất kể creator', () => {
    assert.equal(cusLotVisibleFor(actor(Role.ACCOUNTANT), [], 99, 'CUS'), true);
  });
});

describe('assertCusLotVisible — fake executor', () => {
  it('lô ngoài nhóm của CUS khác → 404 đúng thông điệp (không tiết lộ sự tồn tại)', async () => {
    await assert.rejects(
      assertCusLotVisible(1, actor(Role.CUS), sequentialExecutor([{ createdBy: 99 }], [{ role: 'CUS' }])),
      (err: unknown) => err instanceof ApiError
        && err.statusCode === 404
        && err.message === CUS_LOT_NOT_FOUND_MESSAGE,
    );
  });

  it('lô của người cùng nhóm → pass', async () => {
    await assert.doesNotReject(
      assertCusLotVisible(1, actor(Role.CUS), sequentialExecutor([{ createdBy: 11 }], [{ role: 'CUS' }], [{ userId: 11 }])),
    );
  });

  it('created_by NULL → pass', async () => {
    await assert.doesNotReject(
      assertCusLotVisible(1, actor(Role.CUS), sequentialExecutor([{ createdBy: null }], [])),
    );
  });

  it('lô do DISPATCHER tạo → pass', async () => {
    await assert.doesNotReject(
      assertCusLotVisible(1, actor(Role.CUS), sequentialExecutor([{ createdBy: 30 }], [{ role: 'DISPATCHER' }])),
    );
  });

  it('vai ACCOUNTANT → pass ngay không đụng DB', async () => {
    const neverExecutor = {
      select: () => { throw new Error('must not query for non-CUS'); },
    } as never;
    await assert.doesNotReject(assertCusLotVisible(1, actor(Role.ACCOUNTANT), neverExecutor));
  });
});

describe('cusVisibilityCondition — team toggle (ticket 18/11 Task 1.2)', () => {
  it('includeTeam:false bỏ nhánh arm 2 — KHÔNG đụng DB tra nhóm', async () => {
    const neverExecutor = {
      select: () => { throw new Error('includeTeam:false must not resolve group membership'); },
    } as never;
    const conditions = await cusVisibilityCondition(neverExecutor, actor(Role.CUS), { includeTeam: false });
    assert.equal(conditions.length, 1);
    const { sql } = render(conditions[0]!);
    // Mặc định chỉ thấy lô của mình: không có nhánh co-members.
    assert.match(sql, /"shipments"\."created_by" = \$1/);
    assert.doesNotMatch(sql, /= any\(/);
    assert.doesNotMatch(sql, /in \(\$2/);
    // Fallback arms vẫn giữ ở CẢ HAI chế độ (fallback dữ liệu, không phải mở rộng team).
    assert.match(sql, /"shipments"\."created_by" is null/);
    assert.match(sql, /not in \(select id from users where role = 'CUS'\)/);
  });

  it('includeTeam:true giữ arm 2 co-members từ nhóm ACTIVE', async () => {
    const executor = sequentialExecutor([], [], [{ userId: 11 }, { userId: 12 }]);
    const conditions = await cusVisibilityCondition(executor, actor(Role.CUS), { includeTeam: true });
    const { sql, params } = render(conditions[0]!);
    assert.match(sql, /"shipments"\."created_by" in \(\$2, \$3\)/);
    assert.deepEqual(params, [7, 11, 12]);
  });

  it('includeTeam:true với người không thuộc nhóm nào → cùng 3 nhánh mặc định', async () => {
    const executor = sequentialExecutor([], [], []);
    const conditions = await cusVisibilityCondition(executor, actor(Role.CUS), { includeTeam: true });
    const { sql } = render(conditions[0]!);
    assert.doesNotMatch(sql, /in \(\$2/);
    assert.match(sql, /"shipments"\."created_by" = \$1/);
  });

  it('vai không phải CUS: team toggle không scope gì cả', async () => {
    const neverExecutor = {
      select: () => { throw new Error('must not query for non-CUS'); },
    } as never;
    assert.deepEqual(await cusVisibilityCondition(neverExecutor, actor(Role.ADMIN), { includeTeam: true }), []);
  });

  // Ticket 18/11 — drill-down law: per-lot asserts stay team-open in BOTH
  // toggle modes (list OFF vẫn mở được lô của người cùng nhóm từ link/debit).
  it('assertCusLotVisible luôn mở theo nhóm, bất kể list toggle', async () => {
    // Creator là người cùng nhóm ACTIVE → pass (cơ chế assert không nhận
    // toggle — luật drill-down cố ý, không theo state của list).
    await assert.doesNotReject(
      assertCusLotVisible(1, actor(Role.CUS), sequentialExecutor([{ createdBy: 11 }], [{ role: 'CUS' }], [{ userId: 11 }])),
    );
    // Creator CUS ngoài nhóm vẫn 404 ở cả hai chế độ.
    await assert.rejects(
      assertCusLotVisible(1, actor(Role.CUS), sequentialExecutor([{ createdBy: 99 }], [{ role: 'CUS' }])),
      (err: unknown) => err instanceof ApiError && err.statusCode === 404,
    );
  });
});
