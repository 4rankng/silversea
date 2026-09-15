import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { upsertWorkDay, confirmSalary } from '../services/attendance.service';
import {
  DURABLE_EFFECT_KIND,
  enqueueDurableEffect,
} from '../services/durable-effect.service';
import { submitGeotag } from '../services/geotag.service';
import { upsertPartnerFromTaxCode } from '../services/legal-partner.service';
import { subscribe } from '../services/push.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdTripIds: number[] = [];
const createdDriverIds: number[] = [];
const createdPartnerIds: number[] = [];
const geotagEntityIds: number[] = [];
const durableEffectDedupeKeys: string[] = [];

async function mkUser(role: Role, tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `app-owned-${tag}-${suffix}-${createdUserIds.length}`.slice(0, 50),
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

async function mkDriver(tag: string) {
  const user = await mkUser(Role.DRIVER, `${tag}-user`);
  const [driver] = await db.insert(s.drivers).values({
    name: `App Owned Driver ${tag} ${suffix}`,
    userId: user.id,
    status: 'ACTIVE',
    baseSalary: '12000000',
  }).returning();
  createdDriverIds.push(driver.id);
  return { user, driver };
}



after(async () => {
  if (durableEffectDedupeKeys.length > 0) {
    await db.delete(s.durableEffectJobs)
      .where(inArray(s.durableEffectJobs.dedupeKey, [...new Set(durableEffectDedupeKeys)]));
  }
  if (geotagEntityIds.length > 0) {
    await db.delete(s.photoGeotags).where(and(
      eq(s.photoGeotags.entityType, 'expense_photo'),
      inArray(s.photoGeotags.entityId, geotagEntityIds),
    ));
  }
  if (createdPartnerIds.length > 0) {
    await db.delete(s.partners).where(inArray(s.partners.id, createdPartnerIds));
  }
  if (createdTripIds.length > 0) {
    await db.delete(s.driverWorkDays).where(inArray(s.driverWorkDays.tripId, createdTripIds));
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdTripIds));
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdDriverIds.length > 0) {
    await db.delete(s.driverWorkDays).where(inArray(s.driverWorkDays.driverId, createdDriverIds));
    await db.delete(s.salaryConfirmations).where(inArray(s.salaryConfirmations.driverId, createdDriverIds));
    await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
  }
  if (createdRouteIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdCargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.pushSubscriptions).where(inArray(s.pushSubscriptions.userId, createdUserIds));
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  await client.end();
});

describe('application-owned uniqueness runtime paths', () => {
  test('refreshes an existing push subscription instead of duplicating it', async () => {
    const user = await mkUser(Role.ADMIN, 'push');
    const endpoint = `https://push.example/${suffix}`;

    await subscribe(user.id, {
      endpoint,
      keys: { p256dh: 'first-p256dh', auth: 'first-auth' },
      deviceType: 'web',
    });
    await subscribe(user.id, {
      endpoint,
      keys: { p256dh: 'second-p256dh', auth: 'second-auth' },
      deviceType: 'ios',
    });

    const rows = await db.select().from(s.pushSubscriptions)
      .where(and(
        eq(s.pushSubscriptions.userId, user.id),
        eq(s.pushSubscriptions.endpoint, endpoint),
      ));

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.keysP256dh, 'second-p256dh');
    assert.equal(rows[0]?.keysAuth, 'second-auth');
    assert.equal(rows[0]?.deviceType, 'ios');
  });

  test('reuses the same legal partner row for the same normalized tax code', async () => {
    const firstId = await upsertPartnerFromTaxCode('ab 12');
    const secondId = await upsertPartnerFromTaxCode('AB12');

    assert.equal(firstId, secondId);
    if (firstId != null) createdPartnerIds.push(firstId);
    const [partner] = await db.select().from(s.partners)
      .where(eq(s.partners.id, Number(firstId)))
      .limit(1);
    assert.equal(partner?.displayTaxCode, 'AB12');
  });

  test('updates a geotag in place for repeated submissions on the same entity', async () => {
    const actor = await mkUser(Role.ADMIN, 'geotag');
    const entityId = 910_000_000 + geotagEntityIds.length;
    geotagEntityIds.push(entityId);

    await submitGeotag({
      entityType: 'expense_photo',
      entityId,
      lat: 10.77,
      lng: 106.7,
      accuracy: 8,
      source: 'phone',
    }, {
      userId: actor.id,
      role: Role.ADMIN,
    });

    const updated = await submitGeotag({
      entityType: 'expense_photo',
      entityId,
      lat: 10.78,
      lng: 106.71,
      accuracy: 4,
      source: 'manual',
    }, {
      userId: actor.id,
      role: Role.ADMIN,
    });

    const rows = await db.select().from(s.photoGeotags)
      .where(and(
        eq(s.photoGeotags.entityType, 'expense_photo'),
        eq(s.photoGeotags.entityId, entityId),
      ));

    assert.equal(rows.length, 1);
    assert.equal(updated.lat, 10.78);
    assert.equal(rows[0]?.source, 'manual');
  });

  test('keeps one durable effect job for an exact replay and rejects conflicting payload reuse', async () => {
    const dedupeKey = `app-owned-durable-${suffix}`;
    durableEffectDedupeKeys.push(dedupeKey);

    await db.transaction(async (tx) => {
      await enqueueDurableEffect(tx, {
        kind: DURABLE_EFFECT_KIND.CACHE_INVALIDATE,
        payloadVersion: 1,
        dedupeKey,
        payload: { key: 'reports:overview' },
      });
      await enqueueDurableEffect(tx, {
        kind: DURABLE_EFFECT_KIND.CACHE_INVALIDATE,
        payloadVersion: 1,
        dedupeKey,
        payload: { key: 'reports:overview' },
      });
    });

    const rows = await db.select().from(s.durableEffectJobs)
      .where(eq(s.durableEffectJobs.dedupeKey, dedupeKey));
    assert.equal(rows.length, 1);

    await assert.rejects(
      () => db.transaction(async (tx) => {
        await enqueueDurableEffect(tx, {
          kind: DURABLE_EFFECT_KIND.CACHE_INVALIDATE,
          payloadVersion: 1,
          dedupeKey,
          payload: { key: 'reports:different' },
        });
      }),
      /different payload/,
    );
  });

  test('serializes attendance and salary confirmation updates onto single rows', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'attendance-accountant');
    const { driver } = await mkDriver('attendance-driver');

    await upsertWorkDay(driver.id, '2026-08-03', 'STANDBY', 'Ca dự phòng', accountant.id);
    await upsertWorkDay(driver.id, '2026-08-03', 'WEEKLY_OFF', null, accountant.id);

    const workDays = await db.select().from(s.driverWorkDays)
      .where(and(
        eq(s.driverWorkDays.driverId, driver.id),
        eq(s.driverWorkDays.date, '2026-08-03'),
      ));
    assert.equal(workDays.length, 1);
    assert.equal(workDays[0]?.status, 'WEEKLY_OFF');

    await confirmSalary(driver.id, 2026, 8, accountant.id);
    await confirmSalary(driver.id, 2026, 8, accountant.id);

    const confirmations = await db.select().from(s.salaryConfirmations)
      .where(and(
        eq(s.salaryConfirmations.driverId, driver.id),
        eq(s.salaryConfirmations.year, 2026),
        eq(s.salaryConfirmations.month, 8),
      ));
    assert.equal(confirmations.length, 1);
    assert.equal(confirmations[0]?.status, 'CONFIRMED');
    assert.equal(confirmations[0]?.confirmedBy, accountant.id);
  });
});
