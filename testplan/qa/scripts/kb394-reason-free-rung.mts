// Card 20261007_394 — AC1 rung (EXECUTION COPY: run from backend/, e.g.
//   cp testplan/qa/scripts/kb394-reason-free-rung.mts backend/kb394-rung-exec.mts
//   cd backend && npx tsx kb394-rung-exec.mts
// — the ./src imports resolve only inside the backend package; testplan has
// no node_modules for @tingting/shared / puppeteer's sibling deps).
// Card 20261007_394 — AC1 rung: the COMPLETED-trip edit page no longer shows
// the 'Lý do *' box, and Lưu → Áp dụng saves without any reason rejection.
// Fixture: a self-named KB394 completed trip via the composite service.
import assert from 'node:assert';
import puppeteer from 'puppeteer';
import { eq, inArray } from 'drizzle-orm';
import { db } from './src/db/index.ts';
import * as s from './src/db/schema/index.ts';
import { TripStatus, Role } from '@tingting/shared';
import { insertTripComposite } from './src/services/trip-composite.service.ts';

const suffix = `KB394-${Date.now()}`;
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const step = (s2: string, o: object) => { console.log(JSON.stringify({ at: new Date().toISOString(), step: s2, ...o })); };
const created = { customerIds: [] as number[], routeIds: [] as number[], cargoIds: [] as number[], tripIds: [] as number[] };

try {
  const [customer] = await db.insert(s.customers).values({ name: `KB394 customer ${suffix}` }).returning();
  created.customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `KB394 route ${suffix}` }).returning();
  created.routeIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `KB394 cargo ${suffix}`, isBulk: false }).returning();
  created.cargoIds.push(cargoType.id);
  const [admin] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.role, Role.ADMIN)).limit(1);
  const trip = await insertTripComposite(db, {
    tripCode: `KB394-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: TripStatus.COMPLETED,
    departureDate: '2026-09-20',
    revenue: '5000000',
    revenueEmptyReturn: '5000000',
    revenueCombine: '0',
    twoPointDeliveryBonus: '0',
    vehicleShiftAllowance: '0',
    pricingSource: 'MANUAL',
    carrierType: 'OWN',
  } as never);
  created.tripIds.push(trip.id);
  await db.update(s.trips).set({ completedAt: new Date(Date.now() - 18 * 86400_000) }).where(eq(s.trips.id, trip.id));
  step('fixture', { tripId: trip.id, status: 'COMPLETED' });

  const login = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
  const session = await login.json();
  const token = session.token ?? session.accessToken ?? session?.data?.token;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => { void req.continue(); });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`http://localhost:7175/trips/${trip.id}/edit`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes('Lưu cập nhật'), { timeout: 90000 });
    const probe = await page.evaluate(() => ({
      reasonBoxPresent: Boolean(document.querySelector('#governanceReason')),
      labelPresent: document.body.innerText.includes('Lý do điều chỉnh'),
    }));
    step('probe-page', probe);
    assert(!probe.reasonBoxPresent, 'the reason textarea still renders');
    assert(!probe.labelPresent, 'the reason label still renders');
    // Submit: Lưu → Áp dụng → must NOT reject for a missing reason.
    await page.click('button[form="trip-edit-form"]');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Áp dụng'), { timeout: 20000 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Áp dụng')?.click());
    await new Promise((r) => setTimeout(r, 3000));
    const verdict = await page.evaluate(() => {
      const alertEl = document.querySelector('[role="alert"]');
      const alertText = alertEl ? (alertEl.textContent || '') : '';
      return { url: location.pathname, reasonRejected: alertText.includes('lý do điều chỉnh'), alertText: alertText.slice(0, 140) };
    });
    step('verdict', verdict);
    assert(!verdict.reasonRejected, 'the save was rejected for a missing reason — the gate still lives');
    await page.screenshot({ path: `${QA}/2026-10-07_card394_ui-reason-free-save.png` });
    step('screenshot', { path: 'qa/2026-10-07_card394_ui-reason-free-save.png' });
    step('verdict-final', { result: 'PASS — no reason box, save proceeds past the old gate' });
  } finally { await browser.close(); }
} finally {
  try {
    if (created.tripIds.length) await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, created.tripIds));
    if (created.tripIds.length) await db.delete(s.trips).where(inArray(s.trips.id, created.tripIds));
    if (created.cargoIds.length) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, created.cargoIds));
    if (created.routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, created.routeIds));
    if (created.customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, created.customerIds));
    step('cleanup', { purged: true });
  } catch (e) { step('cleanup-error', { message: String(e) }); }
}
