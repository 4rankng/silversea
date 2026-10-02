import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { authorizeExpensePhoto } from '../services/photo-authz.service';
const ids: { users: number[]; customer?: number; shipment?: number; cost?: number; photo?: number; source?: number; evidence?: number } = { users: [] };
const key = `ops-photo-scope-${Date.now()}-${Math.random().toString(36).slice(2)}`;
test('OPS receipt access matches own saved expense scope without granting other users', async () => {
  for (const role of [Role.OPS, Role.OPS, Role.DRIVER]) {
    const [u] = await db.insert(s.users).values({ username: `${key}-${ids.users.length}`, passwordHash: 'x', role, status: 'ACTIVE' }).returning(); ids.users.push(u.id);
  }
  const [owner, other, driver] = ids.users;
  const [customer] = await db.insert(s.customers).values({ name: key }).returning(); ids.customer = customer.id;
  const [shipment] = await db.insert(s.shipments).values({ customerId: customer.id, cargoMode: 'FCL', status: 'PENDING_DATE' }).returning(); ids.shipment = shipment.id;
  const [cost] = await db.insert(s.opsExpenseEntries).values({ shipmentId: shipment.id, paidById: owner, expenseTypeCode: 'OTHER', amount: '1000', paidAt: '2026-09-22', approvalStatus: 'RECORDED' }).returning(); ids.cost = cost.id;
  const storageKey = `ops-expense-photos/${owner}/${key}.jpg`;
  const [photo] = await db.insert(s.opsExpensePhotos).values({ opsExpenseId: cost.id, storageKey, uploadedById: owner }).returning(); ids.photo = photo.id;
  const [source] = await db.insert(s.expenseAccountingSources).values({ sourceKind: 'OPS', sourceId: cost.id, shipmentId: shipment.id, recordedById: owner }).returning(); ids.source = source.id;
  const evidenceKey = `ops-expense-photos/${owner}/${key}-evidence.jpg`;
  const [evidence] = await db.insert(s.expenseAccountingEvidence).values({ expenseAccountingSourceId: source.id, storageKey: evidenceKey, uploadedById: owner }).returning(); ids.evidence = evidence.id;
  await db.insert(s.userShipmentLinks).values({ userId: other, shipmentId: shipment.id });
  for (const receipt of [storageKey, evidenceKey]) {
    assert.equal((await authorizeExpensePhoto(receipt, { userId: owner, role: Role.OPS })).allow, true, 'Saved own expense grants its receipt without a manual link');
    assert.equal((await authorizeExpensePhoto(receipt, { userId: other, role: Role.OPS })).allow, false, 'Same shipment assignment never grants another author receipt');
    assert.equal((await authorizeExpensePhoto(receipt, { userId: driver, role: Role.DRIVER })).allow, false);
  }
  await db.update(s.users).set({ status: 'DISABLED' }).where(eq(s.users.id, owner));
  for (const receipt of [storageKey, evidenceKey]) assert.equal((await authorizeExpensePhoto(receipt, { userId: owner, role: Role.OPS })).allow, false, 'Disabled owner denied');
  await db.update(s.users).set({ status: 'ACTIVE' }).where(eq(s.users.id, owner));
  await db.update(s.opsExpenseEntries).set({ approvalStatus: 'VOIDED' }).where(eq(s.opsExpenseEntries.id, cost.id));
  for (const receipt of [storageKey, evidenceKey]) assert.equal((await authorizeExpensePhoto(receipt, { userId: owner, role: Role.OPS })).allow, false, 'Voided-only expense without another grant denied');
});
after(async () => { try {
  if (ids.evidence) await db.delete(s.expenseAccountingEvidence).where(eq(s.expenseAccountingEvidence.id, ids.evidence));
  if (ids.source) await db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, ids.source));
  if (ids.photo) await db.delete(s.opsExpensePhotos).where(eq(s.opsExpensePhotos.id, ids.photo));
  if (ids.cost) await db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, ids.cost));
  if (ids.shipment) { await db.delete(s.userShipmentLinks).where(eq(s.userShipmentLinks.shipmentId, ids.shipment)); await db.delete(s.shipments).where(eq(s.shipments.id, ids.shipment)); }
  if (ids.customer) await db.delete(s.customers).where(eq(s.customers.id, ids.customer));
  if (ids.users.length) await db.delete(s.users).where(inArray(s.users.id, ids.users));
} finally { await client.end(); } });
