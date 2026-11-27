// SIL-1088 (K2.85) — GET /api/ops/fleet phải trả đủ các mức trạng thái: mức 0
// (xe chưa có việc), mức 1 (Chờ nhận lệnh / CREATED), mức 2 (Đang vận chuyển /
// IN_TRANSIT), mức 3 (việc đã xong nhưng vẫn tra cứu được / COMPLETED trong
// tháng tra cứu) — mỗi xe kèm mốc thời gian tương ứng (updatedAt của bản ghi
// chuyến; mức 0 không có bản ghi thì null, UI gắn thời điểm kiểm).
//
// Nguyên nhân thiếu mức 0/3 từng bị QA tố: NOT the trip join (mọi xe trong
// danh sách đều map thành một row đúng mức) mà lớ lọc danh sách xe —
// scope='assigned' lấy xe từ truck_ops_assignments, bảng cấu hình admin thưa
// thớt (0 dòng ở dev DB; 1 dòng đúng chiếc xe đang chạy ở env repro) nên bare
// GET chỉ trả "1 xe đang chạy". Default nay là 'all' (một luật trong
// getOpsFleet), còn 'assigned' vẫn thu hẹp đúng phạm vi PRD §4.
//
// Same fixture shape as ops-invoice-job-scope-required.test.ts (real dev DB,
// tracked cleanup, unique suffix).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { getOpsFleet, type OpsFleetTruckItem } from '../services/ops-fleet.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
type TrackedTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: TrackedTable; id: number }> = [];
function track(table: TrackedTable, id: number) {
  cleanup.unshift({ table, id });
}

async function mkOpsUser() {
  const [user] = await db.insert(s.users).values({
    username: `s1088-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.OPS, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  return user.id;
}

async function mkTruck(tag: string, index: number) {
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `S1088-${tag}${index}-${suffix.slice(-6)}`,
  }).returning({ id: s.trucks.id, licensePlate: s.trucks.licensePlate });
  track(s.trucks, truck.id);
  return truck;
}

/** The four levels, one truck each: no trip (mức 0), CREATED, IN_TRANSIT,
 *  COMPLETED inside the lookup month (mức 3 — vẫn tra cứu được). */
async function mkFleet(tag: string) {
  const [customer] = await db.insert(s.customers).values({
    name: `S1088 ${tag} customer ${suffix}`,
  }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({
    name: `S1088 ${tag} route ${suffix}`,
  }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [driver] = await db.insert(s.drivers).values({
    name: `S1088 ${tag} tài xế ${suffix}`,
  }).returning({ id: s.drivers.id });
  track(s.drivers, driver.id);

  const idle = await mkTruck(tag, 0);
  const created = await mkTruck(tag, 1);
  const inTransit = await mkTruck(tag, 2);
  const completed = await mkTruck(tag, 3);

  const trips: Record<'created' | 'inTransit' | 'completed', { id: number; updatedAt: Date }> = {
    created: { id: 0, updatedAt: new Date('2026-11-20T01:00:00.000Z') },
    inTransit: { id: 0, updatedAt: new Date('2026-11-25T03:00:00.000Z') },
    completed: { id: 0, updatedAt: new Date('2026-11-26T09:00:00.000Z') },
  };
  const insert = async (truckId: number, status: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED', updatedAt: Date) => {
    const [trip] = await db.insert(s.trips).values({
      customerId: customer.id, routeId: route.id, departureDate: '2026-11-25',
      truckId, driverId: driver.id, status,
      // Mức 3: hoàn thành trong tháng tra cứu (mặc định = tháng VN hiện tại).
      completedAt: status === 'COMPLETED' ? new Date() : null,
      updatedAt,
    }).returning({ id: s.trips.id });
    track(s.trips, trip.id);
    return trip.id;
  };
  trips.created.id = await insert(created.id, 'CREATED', trips.created.updatedAt);
  trips.inTransit.id = await insert(inTransit.id, 'IN_TRANSIT', trips.inTransit.updatedAt);
  trips.completed.id = await insert(completed.id, 'COMPLETED', trips.completed.updatedAt);

  return { idle, created, inTransit, completed, trips };
}

after(async () => {
  for (const { table, id } of cleanup) await db.delete(table).where(eq(table.id, id));
  await disconnectRedis();
});

describe('SIL-1088 — GET /api/ops/fleet trả đủ 4 mức kèm updatedAt (K2.85)', () => {
  test('bare call (scope default = cả đội xe) trả đủ mức 0/1/2/3, mỗi xe một mốc thời gian', async () => {
    const userId = await mkOpsUser();
    const fleet = await mkFleet('A');

    // Không truyền scope — đúng cú pháp QA re-pro: GET /api/ops/fleet.
    const items = await getOpsFleet(userId);
    const rows = new Map<string, OpsFleetTruckItem>(items.map((item) => [item.licensePlate, item]));
    // Mọi xe trong đội lên bảng — kể cả xe chưa có việc (mức 0) và xe đã xong
    // (mức 3); đội xe fixture nằm giữa cả đội xe thật của DB nên khẳng định
    // theo sự hiện diện của từng xe, không theo tổng số.
    for (const truck of [fleet.idle, fleet.created, fleet.inTransit, fleet.completed]) {
      assert.ok(rows.has(truck.licensePlate), `thiếu xe ${truck.licensePlate} trên bảng theo dõi`);
    }

    // Mức 0 — xe chưa có việc: không chuyến, không bản ghi → không có updatedAt.
    const idle = rows.get(fleet.idle.licensePlate)!;
    assert.equal(idle.status, null);
    assert.equal(idle.tripId, null);
    assert.equal(idle.updatedAt, null);

    // Mức 1 — Chờ nhận lệnh.
    const created = rows.get(fleet.created.licensePlate)!;
    assert.equal(created.status, 'CREATED');
    assert.equal(created.tripId, fleet.trips.created.id);
    assert.equal(created.updatedAt, fleet.trips.created.updatedAt.toISOString());

    // Mức 2 — Đang vận chuyển.
    const inTransit = rows.get(fleet.inTransit.licensePlate)!;
    assert.equal(inTransit.status, 'IN_TRANSIT');
    assert.equal(inTransit.tripId, fleet.trips.inTransit.id);
    assert.equal(inTransit.updatedAt, fleet.trips.inTransit.updatedAt.toISOString());

    // Mức 3 — việc đã xong nhưng vẫn tra cứu được trong tháng.
    const completed = rows.get(fleet.completed.licensePlate)!;
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.tripId, fleet.trips.completed.id);
    assert.equal(completed.updatedAt, fleet.trips.completed.updatedAt.toISOString());
    assert.equal(completed.driverName, `S1088 A tài xế ${suffix}`);
  });

  test("scope='assigned' vẫn thu hẹp đúng phạm vi PRD §4 (xe Ops phụ trách)", async () => {
    const userId = await mkOpsUser();
    const fleet = await mkFleet('B');
    const [assignment] = await db.insert(s.truckOpsAssignments).values({
      truckId: fleet.inTransit.id, opsUserId: userId, isActive: true,
    }).returning({ id: s.truckOpsAssignments.id });
    track(s.truckOpsAssignments, assignment.id);

    const items = await getOpsFleet(userId, 'assigned');
    assert.equal(items.length, 1);
    assert.equal(items[0].licensePlate, fleet.inTransit.licensePlate);
    assert.equal(items[0].status, 'IN_TRANSIT');
  });
});
