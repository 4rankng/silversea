/**
 * Card 181026185900 D.6 — an UNDATED LCL lot shows on Tổng quan (whose
 * default carries no date scope) but vanished from Chi tiết lô hàng the
 * moment the workboard's default today-filter applied: the container date
 * condition evaluates coalesce(appointment, EDD), which is NULL for a
 * container-less lot without an EDD, so the row could never match any day.
 *
 * Contract: the workboard's day triage narrows CONTAINER rows. A lot-level
 * row (card 365) has no container day of its own, so it rides outside the
 * date triage exactly like it already rides outside the dispatch triage —
 * every lot type stays visible on the board. Dated lots keep filtering by
 * their EDD (cus-workboard-lcl-parity-365 stays authoritative for that).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import {
  listCusShipmentContainers,
  listCusShipmentWorkspace,
} from '../services/cus-shipment-workspace.service';
import type { AuthUser } from '../middleware/auth';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdShipmentIds: number[] = [];
const createdFulfillmentIds: number[] = [];
const createdCustomerIds: number[] = [];

function lettersTag(length = 8): string {
  let tag = '';
  while (tag.length < length) tag += Math.random().toString(36).slice(2).replace(/[0-9]/g, '');
  return tag.slice(0, length);
}

const marker = `D6${lettersTag(8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

let undatedLclId = 0;
let adminActor: AuthUser;

before(async () => {
  const [customer] = await db.insert(s.customers).values({ name: `D6 KH ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  adminActor = {
    userId: 0,
    username: `d6-test-admin-${suffix}`,
    email: null,
    fullName: null,
    role: Role.ADMIN,
  };

  // The reported shape: an LCL lot fresh from intake — no EDD yet, no
  // container rows (LCL never owns containers), lot allocation only.
  const [lot] = await db.insert(s.shipments).values({
    customerId: customer.id,
    cargoMode: 'LCL',
    tradeDirection: 'IMPORT',
    status: 'NEW',
    blNumber: `${marker}-LCL`,
  }).returning();
  undatedLclId = lot.id;
  createdShipmentIds.push(lot.id);
  const [allocation] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: lot.id,
    shipmentContainerId: null,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: 1,
    siteSnapshot: {},
  }).returning({ id: s.shipmentFulfillments.id });
  createdFulfillmentIds.push(allocation.id);
});

after(async () => {
  if (createdFulfillmentIds.length) {
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, createdFulfillmentIds));
  }
  if (createdShipmentIds.length) {
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
  }
  if (createdCustomerIds.length) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  await client.end();
});

describe('D6 — undated LCL lot stays visible on the container workboard', () => {
  test('RED at HEAD: the undated lot shows under a today-filter on Chi tiết like it does on Tổng quan', async () => {
    const filtered = { page: 1, limit: 100, searchSuffix: marker, transportDateFrom: TODAY, transportDateTo: TODAY };

    const overviewUnfiltered = await listCusShipmentWorkspace({ page: 1, limit: 100, searchSuffix: marker }, adminActor);
    assert.ok(
      overviewUnfiltered.items.some((item) => item.id === undatedLclId),
      'Tổng quan (no date scope) shows the undated LCL lot — the reported starting point',
    );

    const detail = await listCusShipmentContainers(filtered, adminActor);
    const lotRow = detail.items.find((row) => row.shipmentId === undatedLclId);
    assert.ok(lotRow, 'Chi tiết keeps the undated lot row under the default today-filter (RED at HEAD — coalesce(appt, EDD) is NULL so the date condition dropped it)');
    assert.equal(lotRow.isLotLevel, true);
    assert.equal(lotRow.transportDate, null);
  });

  test('the undated lot is not double-counted: still exactly ONE lot row with no date filter', async () => {
    const detail = await listCusShipmentContainers({ page: 1, limit: 100, searchSuffix: marker }, adminActor);
    const lotRows = detail.items.filter((row) => row.shipmentId === undatedLclId);
    assert.equal(lotRows.length, 1);
    assert.equal(lotRows[0].id, -undatedLclId);
  });

  test('eq(cargoMode, LCL) arm is lot-scoped: container rows keep obeying the date filter', async () => {
    // An undated FCL lot owns no row here at all (pinned by card 365); the
    // LCL arm must not resurrect it.
    const [bareFcl] = await db.insert(s.shipments).values({
      cargoMode: 'FCL',
      tradeDirection: 'EXPORT',
      status: 'NEW',
      bookingRef: `${marker}-BARE`,
    }).returning();
    createdShipmentIds.push(bareFcl.id);

    const filtered = await listCusShipmentContainers(
      { page: 1, limit: 100, searchSuffix: marker, transportDateFrom: TODAY, transportDateTo: TODAY },
      adminActor,
    );
    assert.ok(
      !filtered.items.some((row) => row.shipmentId === bareFcl.id),
      'container-less FCL lots stay off the board under a date filter',
    );
  });
});
