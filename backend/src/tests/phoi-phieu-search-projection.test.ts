import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { Role } from '@tingting/shared';
import { ApiError } from '../errors';
import { billBookingTitle } from '../lib/business-keys';
import { insertTripComposite } from '../services/trip-composite.service';
import { readTripExternalCarrier } from '../services/trip-external-carrier-read.service';
import { createPhoiPhieuVoucher, getPhoiPhieuChiHo, getPhoiPhieuReport, listPhoiPhieuRows } from '../services/phoi-phieu-control.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const ids = { shipments: [] as number[], trips: [] as number[], sources: [] as number[], ops: [] as number[], driver: [] as number[] };

async function boardFixture(carrierType: 'OWN' | 'EXTERNAL', externalPlateNumber: string | null, tradeDirection: 'IMPORT' | 'EXPORT' = 'IMPORT') {
  const [customer] = await db.select().from(s.customers).limit(1);
  const [route] = await db.select().from(s.routes).limit(1);
  const [cargo] = await db.select().from(s.cargoTypes).limit(1);
  const [truck] = await db.select().from(s.trucks).limit(1);
  const [driver] = await db.select().from(s.drivers).limit(1);
  const [payer] = await db.select({ id: s.users.id }).from(s.users).limit(1);
  assert.ok(customer); assert.ok(route); assert.ok(cargo); assert.ok(truck); assert.ok(driver); assert.ok(payer);
  const ordinal = ids.shipments.length;
  const bill = `PHOI-BILL-${suffix}-${ordinal}`;
  const booking = `PHOI-BOOKING-${suffix}-${ordinal}`;
  const [shipment] = await db.insert(s.shipments).values({ customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: '2026-10-01', blNumber: tradeDirection === 'IMPORT' ? bill : null, bookingRef: tradeDirection === 'EXPORT' ? booking : null, tradeDirection }).returning();
  ids.shipments.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({ shipmentId: shipment.id }).returning();
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({ shipmentId: shipment.id, shipmentContainerId: container.id, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1 }).returning();
  const trip = await insertTripComposite(db, { shipmentId: shipment.id, fulfillmentId: fulfillment.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargo.id, truckId: truck.id, driverId: driver.id, tripCode: `PHOI-TRIP-${suffix}-${ordinal}`, departureDate: '2026-10-01', status: 'IN_TRANSIT', carrierType, externalPlateNumber });
  ids.trips.push(trip.id);
  return { trip, shipment, container, bill, booking, truck, driver, payer };
}

test('PHOI01 searches both business references and recorded OPS/DRIVER fee/invoice facts without duplicate rows', async () => {
  const fixture = await boardFixture('OWN', null);
  const invoice = `PHOI-INVOICE-${suffix}`;
  const opsFee = `PHOI-OPS-FEE-${suffix}`;
  const driverFee = `PHOI-DRIVER-FEE-${suffix}`;
  const [entry] = await db.insert(s.opsExpenseEntries).values({ shipmentId: fixture.shipment.id, expenseTypeCode: 'OTHER', feeName: opsFee, invoiceNumber: invoice, amount: '250000', customerChargeAmount: '100000', costGroup: 'OPS_INCIDENTAL', payerKind: 'USER', paidById: fixture.payer.id, paidAt: '2026-10-01' }).returning();
  ids.ops.push(entry.id);
  const [cost] = await db.insert(s.driverIncidentalCosts).values({ tripId: fixture.trip.id, driverId: fixture.driver.id, costType: 'OTHER', feeName: driverFee, invoiceNumber: invoice, amount: '50000', occurredAt: '2026-10-01' }).returning();
  ids.driver.push(cost.id);
  const sources = await db.insert(s.expenseAccountingSources).values([
    { sourceKind: 'OPS', sourceId: entry.id, shipmentId: fixture.shipment.id, tripId: fixture.trip.id, confirmedAt: new Date() },
    { sourceKind: 'DRIVER', sourceId: cost.id, shipmentId: fixture.shipment.id, tripId: fixture.trip.id, confirmedAt: new Date() },
  ]).returning();
  ids.sources.push(...sources.map(source => source.id));
  const exported = await boardFixture('OWN', null, 'EXPORT');
  assert.deepEqual((await listPhoiPhieuRows({ search: exported.booking })).map(row => row.tripId), [exported.trip.id], 'EXPORT Booking finds its owning trip');
  for (const search of [fixture.bill, opsFee, driverFee, invoice, fixture.trip.tripCode!]) {
    const rows = await listPhoiPhieuRows({ search: ` ${search} `, dateFrom: '2026-10-01', dateTo: '2026-10-01', status: 'IN_TRANSIT' });
    assert.deepEqual(rows.map(row => row.tripId), [fixture.trip.id], `search ${search} finds its single owning trip`);
    assert.equal(rows[0].chiHoTra, 250000);
    assert.equal(rows[0].chiHoThu, 100000);
    assert.equal(rows[0].tienDuong, 50000);
  }
  await db.update(s.expenseAccountingSources).set({ status: 'VOIDED' }).where(inArray(s.expenseAccountingSources.id, sources.map(source => source.id)));
  for (const search of [opsFee, driverFee, invoice]) assert.equal((await listPhoiPhieuRows({ search })).length, 0, 'voided source must not make a search match');
  assert.equal((await listPhoiPhieuRows({ search: fixture.bill })).length, 1, 'voided costs do not erase the business-reference row');
});

test('PHOI02 reads OWN truck and EXTERNAL persisted plate independently, preserving missing plate and row window', async () => {
  const own = await boardFixture('OWN', 'STALE-EXTERNAL');
  const external = await boardFixture('EXTERNAL', '15H-154.98');
  const missing = await boardFixture('EXTERNAL', null);
  const query = { search: `PHOI-TRIP-${suffix}` };
  const grouped = await listPhoiPhieuRows(query);
  const byDate = await listPhoiPhieuRows({ ...query, sortBy: 'date' });
  assert.equal(grouped.find(row => row.tripId === own.trip.id)?.plateNumber, own.truck.licensePlate);
  assert.equal(grouped.find(row => row.tripId === external.trip.id)?.plateNumber, '15H-154.98');
  assert.equal(grouped.find(row => row.tripId === missing.trip.id)?.plateNumber, null, 'missing EXTERNAL plate never substitutes a stale OWN truck');
  assert.deepEqual(grouped.map(row => row.tripId).sort((a, b) => a - b), byDate.map(row => row.tripId).sort((a, b) => a - b));
});

test('PHOI09 carrier/driver facts follow typed carrier ownership without changing row money or membership', async () => {
  const [carrier] = await db.select().from(s.customers).where(eq(s.customers.isCarrier, true)).limit(1);
  assert.ok(carrier);
  const suppliers = await db.select().from(s.suppliers).limit(30);
  let collision: typeof suppliers[number] | undefined;
  for (const supplier of suppliers) {
    const [sameIdCustomer] = await db.select({ name: s.customers.name }).from(s.customers).where(eq(s.customers.id, supplier.id)).limit(1);
    const resolved = await readTripExternalCarrier(supplier.id, 'SUPPLIER');
    if (sameIdCustomer && resolved.externalCarrierName !== sameIdCustomer.name && supplier.id !== supplier.linkedCustomerId) { collision = supplier; break; }
  }
  assert.ok(collision, 'seeded supplier/customer numeric collision is a real retained boundary');
  const own = await boardFixture('OWN', null), external = await boardFixture('EXTERNAL', '15H-154.98');
  const missing = await boardFixture('EXTERNAL', null), legacy = await boardFixture('EXTERNAL', '15H-154.98');
  await db.update(s.tripCarrierInfo).set({ externalEntityType: 'CUSTOMER', externalEntityId: carrier.id, externalDriverName: 'STALE EXTERNAL' }).where(eq(s.tripCarrierInfo.tripId, own.trip.id));
  await db.update(s.tripCarrierInfo).set({ externalEntityType: 'CUSTOMER', externalEntityId: carrier.id, externalDriverName: 'Tài xế nhà vận tải' }).where(eq(s.tripCarrierInfo.tripId, external.trip.id));
  await db.update(s.tripCarrierInfo).set({ externalEntityType: 'CUSTOMER', externalEntityId: null, externalDriverName: null }).where(eq(s.tripCarrierInfo.tripId, missing.trip.id));
  await db.update(s.tripCarrierInfo).set({ externalEntityType: 'SUPPLIER', externalEntityId: collision.id, externalDriverName: 'Tài xế NCC' }).where(eq(s.tripCarrierInfo.tripId, legacy.trip.id));
  const ownIds = [own.trip.id, external.trip.id, missing.trip.id, legacy.trip.id];
  const before = await db.select().from(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, ownIds)).orderBy(s.tripCarrierInfo.tripId);
  const financialBefore = await db.select().from(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, ownIds)).orderBy(s.tripFinancialState.tripId);
  const grouped = (await listPhoiPhieuRows({ search: `PHOI-TRIP-${suffix}` })).filter(row => ownIds.includes(row.tripId));
  const carrierOf = (id: number) => { const row = grouped.find(row => row.tripId === id)!; return 'carrierName' in row ? row.carrierName : undefined; };
  assert.equal(carrierOf(own.trip.id), 'Xe nhà'); assert.equal(grouped.find(row => row.tripId === own.trip.id)?.driverName, own.driver.name);
  assert.equal(carrierOf(external.trip.id), carrier.shortName.trim() || carrier.name);
  assert.equal(grouped.find(row => row.tripId === external.trip.id)?.driverName, 'Tài xế nhà vận tải');
  assert.equal(carrierOf(missing.trip.id), null); assert.equal(grouped.find(row => row.tripId === missing.trip.id)?.driverName, null);
  assert.equal(carrierOf(legacy.trip.id), (await readTripExternalCarrier(collision.id, 'SUPPLIER')).externalCarrierName);
  assert.equal(grouped.find(row => row.tripId === legacy.trip.id)?.driverName, 'Tài xế NCC');
  const dated = (await listPhoiPhieuRows({ search: `PHOI-TRIP-${suffix}`, sortBy: 'date' })).filter(row => ownIds.includes(row.tripId));
  assert.deepEqual(grouped.map(row => row.tripId).sort(), dated.map(row => row.tripId).sort());
  assert.ok(grouped.every(row => row.chiHoThu === null && row.chiHoTra === null && row.tienDuong === null));
  assert.deepEqual(await db.select().from(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, ownIds)).orderBy(s.tripCarrierInfo.tripId), before);
  assert.deepEqual(await db.select().from(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, ownIds)).orderBy(s.tripFinancialState.tripId), financialBefore);

  const period = { dateFrom: '2026-10-01', dateTo: '2026-10-01' };
  const previousTra = await getPhoiPhieuReport({ ...period, kind: 'TRA' });
  const previousThu = await getPhoiPhieuReport({ ...period, kind: 'THU' });
  const fixtures = [own, external, missing, legacy];
  const expectedParties = ['XE NHÀ — SILVER SEA', carrier.shortName.trim() || carrier.name, 'Chưa xác định', (await readTripExternalCarrier(collision.id, 'SUPPLIER')).externalCarrierName!];
  const expectedAmounts = new Map<string, number>();
  for (const [index, fixture] of fixtures.entries()) {
    const amount = (index + 1) * 10101;
    const [entry] = await db.insert(s.opsExpenseEntries).values({ shipmentId: fixture.shipment.id, expenseTypeCode: 'OTHER', feeName: `PHOI-PARTY-${suffix}-${index}`, amount: String(amount), customerChargeAmount: String(amount), costGroup: 'OPS_INCIDENTAL', payerKind: 'USER', paidById: fixture.payer.id, paidAt: '2026-10-01' }).returning();
    ids.ops.push(entry.id);
    const [source] = await db.insert(s.expenseAccountingSources).values({ sourceKind: 'OPS', sourceId: entry.id, shipmentId: fixture.shipment.id, tripId: fixture.trip.id, confirmedAt: new Date() }).returning();
    ids.sources.push(source.id);
    expectedAmounts.set(expectedParties[index], (expectedAmounts.get(expectedParties[index]) ?? 0) + amount);
  }
  const sourceBefore = await db.select().from(s.expenseAccountingSources).where(inArray(s.expenseAccountingSources.tripId, ownIds)).orderBy(s.expenseAccountingSources.id);
  const tra = await getPhoiPhieuReport({ ...period, kind: 'TRA' });
  for (const [party, amount] of expectedAmounts) {
    assert.equal((tra.rows.find(row => row.party === party)?.tongPhaiThuTra ?? 0) - (previousTra.rows.find(row => row.party === party)?.tongPhaiThuTra ?? 0), amount, `TRA party ${party} retains only its typed carrier sources`);
  }
  const thu = await getPhoiPhieuReport({ ...period, kind: 'THU' });
  for (const report of [tra, thu]) {
    const previous = report === tra ? previousTra : previousThu;
    assert.equal(report.grand.tongPhaiThuTra - previous.grand.tongPhaiThuTra, 101010);
    assert.equal(report.grand.psKhac - previous.grand.psKhac, 101010);
    assert.equal(report.grand.soLuong - previous.grand.soLuong, 4);
    for (const key of ['tienNang', 'tienHa', 'daThuTra', 'phaiThu', 'phaiTra'] as const) assert.equal(report.grand[key], previous.grand[key]);
  }
  assert.deepEqual(await db.select().from(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, ownIds)).orderBy(s.tripCarrierInfo.tripId), before);
  assert.deepEqual(await db.select().from(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, ownIds)).orderBy(s.tripFinancialState.tripId), financialBefore);
  assert.deepEqual(await db.select().from(s.expenseAccountingSources).where(inArray(s.expenseAccountingSources.tripId, ownIds)).orderBy(s.expenseAccountingSources.id), sourceBefore);
});

test('PHOI09 voucher refusal displays Bill/Booking or honest missing reference without internal codes or writes', async () => {
  const [account] = await db.select({ id: s.treasuryAccounts.id }).from(s.treasuryAccounts).limit(1);
  assert.ok(account);
  for (const mode of ['IMPORT', 'EXPORT', 'MISSING', 'NO_CUSTOMER'] as const) {
    const fixture = await boardFixture('OWN', null, mode === 'EXPORT' ? 'EXPORT' : 'IMPORT');
    if (mode === 'MISSING') await db.update(s.shipments).set({ blNumber: null, bookingRef: null }).where(eq(s.shipments.id, fixture.shipment.id));
    if (mode === 'NO_CUSTOMER') {
      await db.update(s.shipments).set({ customerId: null }).where(eq(s.shipments.id, fixture.shipment.id));
      const [entry] = await db.insert(s.opsExpenseEntries).values({ shipmentId: fixture.shipment.id, expenseTypeCode: 'OTHER', amount: '10000', customerChargeAmount: '10000', costGroup: 'OPS_INCIDENTAL', payerKind: 'USER', paidById: fixture.payer.id, paidAt: '2026-10-01' }).returning();
      ids.ops.push(entry.id);
      const [source] = await db.insert(s.expenseAccountingSources).values({ sourceKind: 'OPS', sourceId: entry.id, shipmentId: fixture.shipment.id, tripId: fixture.trip.id, confirmedAt: new Date() }).returning();
      ids.sources.push(source.id);
    }
    const reference = mode === 'MISSING' ? billBookingTitle(null) : mode === 'EXPORT' ? fixture.booking : fixture.bill;
    const movementsBefore = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, account.id));
    await assert.rejects(() => createPhoiPhieuVoucher({ tripIds: [fixture.trip.id], direction: 'IN', treasuryAccountId: account.id, actor: { userId: fixture.payer.id, role: Role.ACCOUNTANT, username: null, email: null, fullName: null } }), error => {
      assert.ok(error instanceof ApiError); assert.equal(error.statusCode, 409);
      assert.equal(error.message, `Lô ${reference} ${mode === 'NO_CUSTOMER' ? 'chưa có khách hàng.' : 'chưa có khoản chi hộ để lập phiếu.'}`);
      assert.ok(!error.message.includes(fixture.trip.tripCode!));
      return true;
    });
    assert.deepEqual(await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, account.id)), movementsBefore);
  }
});

test('PHOI09 report retains recorded trip-less corrections in a period with no live trips', async () => {
  const day = '2099-12-30';
  assert.equal((await db.select({ id: s.trips.id }).from(s.trips).where(eq(s.trips.departureDate, day))).length, 0, 'isolated exact date has no pre-existing trip');
  const fixture = await boardFixture('OWN', null);
  await db.update(s.trips).set({ departureDate: day, status: 'CANCELED' }).where(eq(s.trips.id, fixture.trip.id));
  for (const [amount, paidAt, status, tripId] of [
    ['43700', day, 'RECORDED', null],
    ['22500', day, 'RECORDED', fixture.trip.id],
    ['9010', day, 'VOIDED', null],
    ['7010', '2099-12-29', 'RECORDED', null],
  ] as const) {
    const [entry] = await db.insert(s.opsExpenseEntries).values({ shipmentId: fixture.shipment.id, expenseTypeCode: 'OTHER', amount, customerChargeAmount: amount, costGroup: 'OPS_INCIDENTAL', payerKind: 'USER', paidById: fixture.payer.id, paidAt }).returning();
    ids.ops.push(entry.id);
    const [source] = await db.insert(s.expenseAccountingSources).values({ sourceKind: 'OPS', sourceId: entry.id, shipmentId: fixture.shipment.id, tripId, status }).returning();
    ids.sources.push(source.id);
  }
  const before = await db.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.shipmentId, fixture.shipment.id)).orderBy(s.expenseAccountingSources.id);
  for (const kind of ['THU', 'TRA'] as const) {
    const report = await getPhoiPhieuReport({ kind, dateFrom: day, dateTo: day });
    assert.equal(report.rows.length, 1); assert.equal(report.rows[0].party, 'Chưa xác định');
    assert.equal(report.grand.psKhac, 43700); assert.equal(report.grand.tongPhaiThuTra, 43700);
    assert.equal(report.grand.conLai, 43700); assert.equal(report.grand.soLuong, 1);
    assert.equal(report.grand.daThuTra, 0); assert.equal(report.grand.phaiThu, 0); assert.equal(report.grand.phaiTra, 0);
  }
  assert.deepEqual(await db.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.shipmentId, fixture.shipment.id)).orderBy(s.expenseAccountingSources.id), before);
});

test('PHOI04 display and exact-day filter use Vietnam appointment, existing root fallback and honest null', async () => {
  const first = await boardFixture('OWN', null);
  const nextDay = await boardFixture('OWN', null);
  const fallback = await boardFixture('OWN', null);
  const missing = await boardFixture('OWN', null);
  await db.update(s.trips).set({ departureDate: '2026-09-30' }).where(inArray(s.trips.id, [first.trip.id, nextDay.trip.id, fallback.trip.id, missing.trip.id]));
  await db.update(s.shipments).set({ expectedDeliveryDate: '2026-10-03' }).where(inArray(s.shipments.id, [first.shipment.id, nextDay.shipment.id, fallback.shipment.id]));
  await db.update(s.shipments).set({ expectedDeliveryDate: null }).where(eq(s.shipments.id, missing.shipment.id));
  await db.update(s.shipmentContainers).set({ customerAppointmentAt: new Date('2026-09-30T18:30:00Z') }).where(eq(s.shipmentContainers.id, first.container.id));
  await db.update(s.shipmentContainers).set({ customerAppointmentAt: new Date('2026-10-01T17:00:00Z') }).where(eq(s.shipmentContainers.id, nextDay.container.id));
  const ownIds = [first.trip.id, nextDay.trip.id, fallback.trip.id, missing.trip.id];
  const rows = (await listPhoiPhieuRows({ search: `PHOI-TRIP-${suffix}`, sortBy: 'date' })).filter(row => ownIds.includes(row.tripId));
  const dateOf = (id: number) => { const row = rows.find(value => value.tripId === id)!; return 'transportDate' in row ? row.transportDate : undefined; };
  assert.equal(dateOf(first.trip.id), '2026-10-01');
  assert.equal(dateOf(nextDay.trip.id), '2026-10-02');
  assert.equal(dateOf(fallback.trip.id), '2026-10-03');
  assert.equal(dateOf(missing.trip.id), null);
  assert.ok(rows.every(row => row.departureDate === '2026-09-30'), 'legacy departure data is retained');
  for (const [day, id] of [['2026-10-01', first.trip.id], ['2026-10-02', nextDay.trip.id], ['2026-10-03', fallback.trip.id]] as const) {
    const exact = (await listPhoiPhieuRows({ search: `PHOI-TRIP-${suffix}`, dateFrom: day, dateTo: day })).filter(row => ownIds.includes(row.tripId));
    assert.deepEqual(exact.map(row => row.tripId), [id]);
  }
  assert.equal((await listPhoiPhieuRows({ search: missing.bill, dateFrom: '2026-09-30', dateTo: '2026-09-30' })).length, 0, 'missing schedule never falls back to departure');
});

test('PHOI05 board and Chi hộ detail scope the same confirmed source amounts without changing Tiền đường', async () => {
  const fixture = await boardFixture('OWN', null);
  const rows = await db.insert(s.opsExpenseEntries).values([
    { shipmentId: fixture.shipment.id, expenseTypeCode: 'OTHER', feeName: 'Phí nâng', amount: '100000', customerChargeAmount: '60000', costGroup: 'OPS_INCIDENTAL', payerKind: 'USER', paidById: fixture.payer.id, paidAt: '2026-10-01' },
    { shipmentId: fixture.shipment.id, expenseTypeCode: 'OTHER', feeName: 'Phí hạ', amount: '200000', customerChargeAmount: '120000', costGroup: 'OPS_INCIDENTAL', payerKind: 'USER', paidById: fixture.payer.id, paidAt: '2026-10-01' },
  ]).returning();
  ids.ops.push(...rows.map(row => row.id));
  const sources = await db.insert(s.expenseAccountingSources).values(rows.map((row, index) => ({ sourceKind: 'OPS' as const, sourceId: row.id, shipmentId: fixture.shipment.id, tripId: fixture.trip.id, confirmedAt: index === 0 ? new Date() : null }))).returning();
  ids.sources.push(...sources.map(source => source.id));
  const [road] = await db.insert(s.driverIncidentalCosts).values({ tripId: fixture.trip.id, driverId: fixture.driver.id, costType: 'OTHER', amount: '75000', occurredAt: '2026-10-01' }).returning();
  ids.driver.push(road.id);
  const [roadSource] = await db.insert(s.expenseAccountingSources).values({ sourceKind: 'DRIVER', sourceId: road.id, shipmentId: fixture.shipment.id, tripId: fixture.trip.id, confirmedAt: new Date() }).returning();
  ids.sources.push(roadSource.id);
  const search = fixture.bill;
  const [all] = await listPhoiPhieuRows({ search });
  assert.equal(all.chiHoTra, 300000); assert.equal(all.chiHoThu, 180000);
  for (const [confirmation, index, amount, charge] of [['CONFIRMED', 0, 100000, 60000], ['UNCONFIRMED', 1, 200000, 120000]] as const) {
    const query = { search, confirmation };
    const [board] = await listPhoiPhieuRows(query);
    assert.ok(board);
    assert.equal(board.chiHoTra, amount);
    assert.equal(board.chiHoThu, charge);
    assert.equal(board.tienDuong, 75000, 'document filter never changes the agreed road allowance');
    assert.equal(board.confirmable, confirmation === 'CONFIRMED');
    assert.equal(board.eligibleOut, confirmation === 'CONFIRMED' ? 1 : 0);
    const detail = await getPhoiPhieuChiHo(fixture.trip.id, confirmation);
    assert.deepEqual(detail.rows.map(row => row.sourceId), [sources[index].id]);
    assert.deepEqual(detail.totals, { thu: charge, tra: amount });
    assert.equal(detail.rows[0].confirmed, confirmation === 'CONFIRMED');
  }
  const unmatchedFee = { search: 'Phí hạ', confirmation: 'CONFIRMED' as const };
  assert.ok(!(await listPhoiPhieuRows(unmatchedFee)).some(row => row.tripId === fixture.trip.id), 'confirmed search never matches this trip through an unconfirmed fee');
  await db.update(s.expenseAccountingSources).set({ status: 'VOIDED' }).where(eq(s.expenseAccountingSources.id, sources[0].id));
  const confirmedQuery = { search, confirmation: 'CONFIRMED' as const };
  assert.deepEqual(await listPhoiPhieuRows(confirmedQuery), []);
  assert.deepEqual((await getPhoiPhieuChiHo(fixture.trip.id, 'CONFIRMED')).rows, []);
  assert.equal((await listPhoiPhieuRows({ search }))[0].chiHoTra, 200000, 'voided amount is excluded from all scope');
});

test('PHOI06 factory snapshot and live site fallbacks stay distinct from customer and route', async () => {
  const sites = await db.select({ id: s.operationalSites.id, name: s.operationalSites.name, shortName: s.operationalSites.shortName, address: s.operationalSites.address }).from(s.operationalSites).limit(2);
  assert.equal(sites.length, 2, 'existing seeded operational sites are required');
  const expectedName = (site: typeof sites[number]) => site.shortName?.trim() || site.name;
  const snapshot = await boardFixture('OWN', null);
  const container = await boardFixture('OWN', null);
  const root = await boardFixture('OWN', null);
  const freeText = await boardFixture('OWN', null);
  const missing = await boardFixture('OWN', null);
  const addressOnly = await boardFixture('OWN', null);
  await db.update(s.trips).set({ factorySiteName: sites[0].name }).where(eq(s.trips.id, snapshot.trip.id));
  await db.update(s.shipmentContainers).set({ operationalSiteId: sites[1].id }).where(inArray(s.shipmentContainers.id, [snapshot.container.id, container.container.id]));
  await db.update(s.shipments).set({ operationalSiteId: sites[0].id, factoryName: sites[1].name }).where(inArray(s.shipments.id, [container.shipment.id, root.shipment.id]));
  await db.update(s.shipments).set({ factoryName: ` ${sites[1].name} ` }).where(eq(s.shipments.id, freeText.shipment.id));
  await db.update(s.trips).set({ factorySiteName: null, factorySiteAddress: sites[0].address }).where(eq(s.trips.id, addressOnly.trip.id));
  await db.update(s.shipmentContainers).set({ operationalSiteId: sites[1].id }).where(eq(s.shipmentContainers.id, addressOnly.container.id));
  const expectations = new Map([[snapshot.trip.id, sites[0].name], [container.trip.id, expectedName(sites[1])], [root.trip.id, expectedName(sites[0])], [freeText.trip.id, sites[1].name], [missing.trip.id, null], [addressOnly.trip.id, null]]);
  const rows = await listPhoiPhieuRows({ search: `PHOI-TRIP-${suffix}` });
  for (const [id, name] of expectations) {
    const row = rows.find(row => row.tripId === id)!;
    assert.ok(row);
    assert.equal('factoryName' in row ? row.factoryName : undefined, name);
  }
  const customer = await db.select({ name: s.customers.name }).from(s.customers).where(eq(s.customers.id, missing.shipment.customerId!));
  const route = await db.select({ name: s.routes.name }).from(s.routes).where(eq(s.routes.id, missing.trip.routeId));
  assert.equal(rows.find(row => row.tripId === missing.trip.id)!.customerName, customer[0].name);
  assert.equal(rows.find(row => row.tripId === missing.trip.id)!.routeName, route[0].name);
});

test('PHOI04 newest bounded window keeps dated work ahead of missing schedules in both sort modes', async () => {
  const anchor = await boardFixture('OWN', null);
  const prefix = `PHOI-WIN-${suffix}`;
  const shipments = await db.insert(s.shipments).values(Array.from({ length: 303 }, (_, index) => ({ customerId: anchor.shipment.customerId, routeId: anchor.trip.routeId, cargoMode: 'FCL' as const, status: 'DISPATCHED' as const, expectedDeliveryDate: index < 2 ? `2026-10-0${index + 1}` : null }))).returning({ id: s.shipments.id });
  ids.shipments.push(...shipments.map(row => row.id));
  const trips = await db.insert(s.trips).values(shipments.map((shipment, index) => ({ customerId: anchor.trip.customerId, routeId: anchor.trip.routeId, shipmentId: shipment.id, truckId: anchor.truck.id, tripCode: `${prefix}-${index}`, departureDate: '2026-09-30', status: 'CREATED' as const }))).returning({ id: s.trips.id });
  ids.trips.push(...trips.map(row => row.id));
  const byDate = await listPhoiPhieuRows({ search: prefix, sortBy: 'date' });
  const grouped = await listPhoiPhieuRows({ search: prefix, sortBy: 'grouped' });
  assert.equal(byDate.length, 300);
  assert.deepEqual(byDate.slice(0, 2).map(row => row.tripId), [trips[1].id, trips[0].id], 'known newest schedule dates precede missing legacy dates');
  const expected = [trips[1].id, trips[0].id, ...trips.slice(2).map(row => row.id).sort((a, b) => b - a).slice(0, 298)];
  assert.deepEqual(byDate.map(row => row.tripId), expected);
  assert.deepEqual(grouped.map(row => row.tripId).sort((a, b) => a - b), expected.slice().sort((a, b) => a - b));
  assert.ok(byDate.slice(2).every(row => row.transportDate === null && row.departureDate === '2026-09-30'));
});

after(async () => {
  try {
    if (ids.sources.length) await db.delete(s.expenseAccountingSources).where(inArray(s.expenseAccountingSources.id, ids.sources));
    if (ids.ops.length) await db.delete(s.opsExpenseEntries).where(inArray(s.opsExpenseEntries.id, ids.ops));
    if (ids.driver.length) await db.delete(s.driverIncidentalCosts).where(inArray(s.driverIncidentalCosts.id, ids.driver));
    for (const id of ids.trips) {
      await db.delete(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.tripId, id));
      await db.delete(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, id));
      await db.delete(s.trips).where(eq(s.trips.id, id));
    }
    for (const id of ids.shipments) {
      await db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.shipmentId, id));
      await db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, id));
      await db.delete(s.shipments).where(eq(s.shipments.id, id));
    }
  } finally { await disconnectRedis(); await client.end(); }
});
