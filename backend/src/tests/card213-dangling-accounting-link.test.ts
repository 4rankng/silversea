/**
 * Card 20260930_213 — a dangling `expense_accounting_sources` link must not
 * kill a register read.
 *
 * The table is polymorphic (`source_kind` + `source_id`), so no FK can express
 * it and a source row deleted underneath its link leaves debris. The register
 * must behave as if the link had been cascade-deleted: the broken row is
 * absent, the rest of the page still renders. Before the fix the whole read
 * died with `ApiError(404, 'Khoản chi lái xe không còn tồn tại.')` — which is
 * what made `/ops/wallet` print "Không tải được lịch sử chi phí".
 *
 * Service-level suite; fixtures prefix `card213-`, local DB :5441, announced.
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { and, eq } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { createOpsExpense, listOpsExpenses } from '../services/ops-expenses.service';
import { listExpenseAccountingEntries } from '../services/expense-accounting-reads.service';
import { withTestCleanup } from './helpers/db-isolation';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);
const cleanup = withTestCleanup();
let staffSeq = 0;
let fixtureSeq = 0;

async function mkOpsStaff() {
  staffSeq += 1;
  const [u] = await db.insert(s.users).values({
    username: `card213-${suffix}-ops-${staffSeq}`, passwordHash: 'x', role: 'OPS',
  }).returning({ id: s.users.id });
  cleanup.track(s.users, u.id);
  return u;
}

async function mkShipment() {
  fixtureSeq += 1;
  const [customer] = await db.insert(s.customers).values({ name: `card213 cust ${suffix}-${fixtureSeq}` }).returning({ id: s.customers.id });
  cleanup.track(s.customers, customer.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning({ id: s.shipments.id });
  cleanup.track(s.shipments, shipment.id);
  return shipment;
}

/** `createOpsExpense` refuses a lot the Ops staff is not assigned to. */
async function assignStaff(userId: number, shipmentId: number) {
  const [link] = await db.insert(s.userShipmentLinks).values({ userId, shipmentId })
    .onConflictDoNothing().returning({ userId: s.userShipmentLinks.userId });
  if (link) cleanup.track(s.userShipmentLinks, link.userId);
}

/** The debris: a DRIVER-kind link whose `driver_incidental_costs` row is gone. */
async function mkDanglingDriverLink(shipmentId: number) {
  const orphanSourceId = 900000000 + (Date.now() % 1000000);
  const [link] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'DRIVER', sourceId: orphanSourceId, shipmentId, status: 'RECORDED',
  }).returning({ id: s.expenseAccountingSources.id });
  cleanup.track(s.expenseAccountingSources, link.id);
  return { linkId: link.id, orphanSourceId };
}

describe('card 20260930_213 - dangling accounting link', () => {
  test('a register read survives a link whose source row is gone, and keeps live rows', async () => {
    const staff = await mkOpsStaff();
    const shipment = await mkShipment();
    await assignStaff(staff.id, shipment.id);
    const live = await createOpsExpense(staff.id, {
      shipmentId: shipment.id, expenseTypeCode: 'FEE_CLEANING', amount: 250000, paidAt: TODAY,
      costGroup: 'OPS_REGULAR', feeName: `card213 phí ${suffix}`,
      note: 'card213 fixture: khoản không thu khách — lý do bắt buộc',
    });
    cleanup.track(s.opsExpenseEntries, live.id);
    const [opsLink] = await db.select({ id: s.expenseAccountingSources.id }).from(s.expenseAccountingSources).where(and(
      eq(s.expenseAccountingSources.sourceKind, 'OPS'),
      eq(s.expenseAccountingSources.sourceId, live.id),
    ));
    cleanup.track(s.expenseAccountingSources, opsLink.id);

    const { orphanSourceId } = await mkDanglingDriverLink(shipment.id);

    const page = await listExpenseAccountingEntries({ userId: staff.id, role: Role.OPS }, { page: 1, limit: 100 });
    assert.ok(
      page.items.some((row) => row.sourceKind === 'OPS' && row.sourceId === live.id),
      'the live Ops expense is still listed',
    );
    assert.ok(
      !page.items.some((row) => row.sourceKind === 'DRIVER' && row.sourceId === orphanSourceId),
      'the dangling link is not listed',
    );
  });

  test('the Ops wallet expense list survives the same debris', async () => {
    const staff = await mkOpsStaff();
    const shipment = await mkShipment();
    await mkDanglingDriverLink(shipment.id);

    const items = await listOpsExpenses({ paidById: staff.id });
    assert.ok(Array.isArray(items), 'the wallet expense list resolves instead of 404-ing');
  });
});

after(async () => {
  try {
    await cleanup.flush();
  } finally {
    await client.end();
  }
});
