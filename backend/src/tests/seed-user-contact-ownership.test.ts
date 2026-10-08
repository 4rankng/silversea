import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { seed } from '../seed';
import { disconnectRedis } from '../lib/redis';

test('seed preserves existing phone/email owners and stable partially populated demo accounts', async () => {
  const [phoneOwner] = await db.select().from(s.users).where(eq(s.users.phone, '0900000020'));
  assert.ok(phoneOwner, 'seed contact already has an owner');
  const [staffBefore] = await db.select().from(s.users).where(eq(s.users.username, 'thanhdc'));
  let emailHolderId: number | null = null;
  try {
    if (staffBefore?.email === 'thanhdc@silversea.vn') {
      await db.update(s.users).set({ email: null }).where(eq(s.users.id, staffBefore.id));
    }
    if (phoneOwner.id === staffBefore?.id) {
      await db.update(s.users).set({ phone: null }).where(eq(s.users.id, staffBefore.id));
    }
    const [emailHolder] = await db.insert(s.users).values({
      username: `seed-contact-owner-${Date.now()}`,
      email: 'thanhdc@silversea.vn',
      phone: phoneOwner.id === staffBefore?.id ? phoneOwner.phone : null,
      passwordHash: phoneOwner.passwordHash,
      fullName: 'Seed contact ownership regression',
      role: 'CUS',
      status: 'ACTIVE',
    }).returning();
    emailHolderId = emailHolder.id;

    await seed();
    const [staff] = await db.select().from(s.users).where(eq(s.users.username, 'thanhdc'));
    assert.ok(staff);
    assert.equal(staff.email, staffBefore?.email && staffBefore.email !== emailHolder.email ? staffBefore.email : null);
    assert.equal(staff.phone, staffBefore?.phone && staffBefore.id !== phoneOwner.id ? staffBefore.phone : null);
    if (phoneOwner.id !== staffBefore?.id) {
      assert.deepEqual((await db.select().from(s.users).where(eq(s.users.id, phoneOwner.id)))[0], phoneOwner);
    }
    assert.deepEqual((await db.select().from(s.users).where(eq(s.users.id, emailHolder.id)))[0], emailHolder);

    await seed();
    assert.deepEqual((await db.select().from(s.users).where(eq(s.users.id, staff.id)))[0], staff);
    assert.deepEqual((await db.select().from(s.users).where(eq(s.users.id, emailHolder.id)))[0], emailHolder);
  } finally {
    if (emailHolderId != null) await db.delete(s.users).where(eq(s.users.id, emailHolderId));
    if (staffBefore) {
      await db.update(s.users).set({ email: staffBefore.email, phone: staffBefore.phone, updatedAt: staffBefore.updatedAt }).where(eq(s.users.id, staffBefore.id));
    }
  }
});

after(async () => { await client.end(); await disconnectRedis(); });
