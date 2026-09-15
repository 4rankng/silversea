import bcrypt from 'bcryptjs';
import { db } from './db';
import * as schema from './db/schema';
import {
  DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
  OPS_EXPENSE_TYPE_DEFAULTS,
  NO_INVOICE_POLICY_DEFAULTS,
  Role,
} from '@tingting/shared';
import { eq, and, desc, isNotNull, isNull, sql } from 'drizzle-orm';
import { COMPANY_INFO_SETTING_KEYS, COMPANY_INFO_DEFAULTS } from './services/company-info.service';
import { reassignTruckDriverInTx } from './services/truck-driver-assignment.service';
import {
  createShipment,
  transitionShipmentStatus,
  batchUpsertShipmentContainers,
  attachShipmentDocument,
} from './services/shipment.service';
import {
  normalizeSeedText,
  normalizedNullableTextEquals,
  normalizedTextEquals,
} from './seed/seed-identity';
import { seedCustomers } from './seed/seed-customers';
import { seedReference } from './seed/seed-reference';
import { seedLiftPricing } from './seed/seed-lift-pricing';
import { seedPricingTables } from './seed/seed-pricing-tables';
import { seedDemoFreightPricing } from './seed/seed-demo-freight-pricing';
import { seedOperationalSites } from './seed/seed-operational-sites';
import { seedFactories } from './seed/seed-factories';
import { seedPorts } from './seed/seed-ports';
import { seedVehiclesFromExcel } from './seed/seed-vehicles-from-excel';
import { resolveSeedActors, seedTrips } from './seed/seed-trips';
import { seedVendorFinancials } from './seed/seed-vendor-financials';
import { seedForwarderMoney } from './seed/seed-forwarder-money';
import { seedCustomerAr } from './seed/seed-customer-ar';
import { seedBulkData } from './seed/seed-bulk-data';

export async function seed() {
  const passwordHash = await bcrypt.hash('Abc123', 10);

  const users = [
    { username: 'admin', email: 'admin@nepo.vn', phone: '0900000000', passwordHash, role: Role.ADMIN, fullName: 'Trần Văn Admin' },
    { username: 'giamdoc', email: 'giamdoc@nepo.vn', phone: '0900000001', passwordHash, role: Role.MANAGER, fullName: 'Lê Văn Tỉnh' },
    { username: 'ketoan', email: 'ketoan@nepo.vn', phone: '0900000002', passwordHash, role: Role.ACCOUNTANT, fullName: 'Nguyễn Thị Mai' },
    { username: 'cus', email: 'cus@nepo.vn', phone: '0900000005', passwordHash, role: Role.CUS, fullName: 'Nhân viên CUS Demo' },
    { username: 'dieuvan', email: 'dieuvan@nepo.vn', phone: '0900000006', passwordHash, role: Role.DISPATCHER, fullName: 'Nhân viên Điều vận Demo' },
    { username: 'laixe', email: 'laixe@nepo.vn', phone: '0900000003', passwordHash, role: Role.DRIVER, fullName: 'Phạm Văn Hùng' },
    { username: 'giaonhan', email: 'giaonhan@nepo.vn', phone: '0900000004', passwordHash, role: Role.OPS, fullName: 'Nguyễn Văn Giao' },
    { username: 'thu', email: 'thu@nepo.vn', phone: '0900000010', passwordHash, role: Role.DRIVER, fullName: 'Nguyễn Văn Thụ' },
    { username: 'pho', email: 'pho@nepo.vn', phone: '0900000011', passwordHash, role: Role.DRIVER, fullName: 'Nguyễn Văn Phố' },
    { username: 'quyet', email: 'quyet@nepo.vn', phone: '0900000012', passwordHash, role: Role.DRIVER, fullName: 'Lê Văn Quyết' },
  ];

  const existingUsers = await db.select({
    id: schema.users.id,
    username: schema.users.username,
    email: schema.users.email,
    phone: schema.users.phone,
    passwordHash: schema.users.passwordHash,
  }).from(schema.users);
  const existingUserByUsername = new Map<string, (typeof existingUsers)[number]>();
  for (const existingUser of existingUsers) {
    const key = existingUser.username;
    if (!key) continue;
    existingUserByUsername.set(key, existingUser);
  }

  for (const user of users) {
    const canonicalUser = { ...user, status: 'ACTIVE' as const };
    const existingUser = existingUserByUsername.get(user.username);
    if (existingUser) {
      // Legacy rows (e.g. a pre-wipe `laixe` with NULL email/phone) keep
      // their account but must carry the canonical contact identity so the
      // driver↔user phone backfill below can link them.
      // Also ensure password hash is current — staging-synced DBs may carry
      // a different hash that prevents demo login.
      const needsUpdate: Record<string, unknown> = {};
      if (!existingUser.email || !existingUser.phone) {
        needsUpdate.email = canonicalUser.email;
        needsUpdate.phone = canonicalUser.phone;
      }
      // Sync the password hash only when the stored one fails to authenticate
      // the demo password (e.g. a devdb-synced DB carrying prod hashes) — a
      // verifiable hash must stay byte-stable across seed runs.
      const storedHashVerifies = existingUser.passwordHash
        ? await bcrypt.compare('Abc123', existingUser.passwordHash)
        : false;
      if (!storedHashVerifies) {
        needsUpdate.passwordHash = canonicalUser.passwordHash;
      }
      if (Object.keys(needsUpdate).length > 0) {
        await db.update(schema.users).set(needsUpdate).where(eq(schema.users.id, existingUser.id));
      }
      continue;
    }
    await db.insert(schema.users).values(canonicalUser);
  }

  console.log('✅ Users seeded!');
  for (const u of users) {
    console.log(`  ${u.username} / Abc123 (${u.role})`);
  }

  // ─── Drivers — linked to user accounts via user_id ─────────────────────
  // The driver portal (/my-trips, /my-earnings, etc.) relies on
  // drivers.user_id pointing to users.id. Without this link, getDriverByUserId()
  // throws NoDriverProfileError (404) and the portal is unusable.
  //
  // Look up user IDs by username (canonical demo identity — survives DBs
  // where the account was synced with a different email/phone), falling
  // back to the demo email for pre-wipe databases.
  const userAccounts = await db.select({ id: schema.users.id, username: schema.users.username, email: schema.users.email })
    .from(schema.users)
    .where(isNull(schema.users.deletedAt));
  const userByEmail = new Map(userAccounts.map(u => [u.email, u.id]));
  const userByUsername = new Map(userAccounts.map(u => [u.username, u.id]));

  const driverSeeds = [
    { username: 'laixe', email: 'laixe@nepo.vn', name: 'Phạm Văn Hùng',  phone: '0900000003', baseSalary: '5000000', status: 'ACTIVE' as const },
    { username: 'thu',   email: 'thu@nepo.vn',   name: 'Nguyễn Văn Thụ', phone: '0900000010', baseSalary: '4500000', status: 'ACTIVE' as const },
    { username: 'quyet', email: 'quyet@nepo.vn', name: 'Lê Văn Quyết',   phone: '0900000012', baseSalary: '4500000', status: 'ACTIVE' as const },
    { username: 'pho',   email: 'pho@nepo.vn',   name: 'Nguyễn Văn Phố', phone: '0900000011', baseSalary: '5000000', status: 'ACTIVE' as const },
  ].map((d) => ({
    userId: userByUsername.get(d.username) ?? userByEmail.get(d.email) ?? null,
    name: d.name,
    phone: d.phone,
    baseSalary: d.baseSalary,
    status: d.status,
  }));

  // Use onConflictDoNothing with a unique constraint on (name) if it exists,
  // otherwise check by name before inserting to stay idempotent. The
  // user_id check matters on prod-synced DBs: the linked DRIVER user may
  // already own an ACTIVE driver row under a different name, and
  // drivers_active_user_uniq_idx (one active driver per user) would reject
  // the demo insert — skip it, the user already has a driver profile.
  const existingDrivers = await db.select({
    name: schema.drivers.name,
    userId: schema.drivers.userId,
  }).from(schema.drivers)
    .where(isNull(schema.drivers.deletedAt));
  const existingDriverNames = new Set(existingDrivers.map(d => d.name));
  const existingDriverUserIds = new Set(
    existingDrivers.map(d => d.userId).filter((id): id is number => id != null),
  );

  let driverCount = 0;
  for (const driver of driverSeeds) {
    if (existingDriverNames.has(driver.name)) continue;
    if (driver.userId != null && existingDriverUserIds.has(driver.userId)) continue;
    await db.insert(schema.drivers).values(driver);
    driverCount++;
  }
  if (driverCount > 0) {
    console.log(`✅ Drivers seeded! (${driverCount} new)`);
    for (const d of driverSeeds) {
      console.log(`  ${d.name}${d.userId ? ` ← user_id=${d.userId}` : ''}`);
    }
  } else {
    console.log('✅ Drivers already exist, skipping.');
  }

  // Link same-named unlinked driver rows to the resolved demo accounts —
  // drivers created by an earlier run (or a roster whose phones diverged
  // from the demo users') stay functional for the driver portal and the
  // dispatch driver-validity check (userId + ACTIVE DRIVER user).
  // A user can hold only ONE ACTIVE driver (drivers_active_user_uniq_idx) —
  // skip users whose link is already taken by an earlier pass.
  const takenUserIds = new Set((await db.select({ userId: schema.drivers.userId })
    .from(schema.drivers)
    .where(and(isNotNull(schema.drivers.userId), isNull(schema.drivers.deletedAt))))
    .map((d) => d.userId));
  for (const d of driverSeeds) {
    if (d.userId == null || takenUserIds.has(d.userId)) continue;
    const [candidate] = await db.select({ id: schema.drivers.id })
      .from(schema.drivers)
      .where(and(
        eq(schema.drivers.name, d.name),
        isNull(schema.drivers.userId),
        isNull(schema.drivers.deletedAt),
      ))
      .orderBy(schema.drivers.id)
      .limit(1);
    if (!candidate) continue;
    await db.update(schema.drivers)
      .set({ userId: d.userId })
      .where(eq(schema.drivers.id, candidate.id));
    takenUserIds.add(d.userId);
    console.log(`  🔗 driver "${d.name}" ← user_id=${d.userId}`);
  }

  // ─── Backfill drivers.user_id by phone ─────────────────────────────────
  // The block above is a no-op against prod-like DBs where drivers were
  // seeded with real Vietnamese names (Nguyễn Văn Thụ, etc.) — the
  // `existingDriverNames.has(driver.name)` guard prevents inserts, so the
  // user_id link never gets written. Backfill explicitly by phone, which
  // is the de-facto identity for DRIVER users (their username, e.g. 'thu',
  // doesn't appear on the drivers row but the phone does).
  const driverUsers = await db.select({ id: schema.users.id, phone: schema.users.phone })
    .from(schema.users)
    .where(and(eq(schema.users.role, Role.DRIVER), isNull(schema.users.deletedAt)));

  // A user can hold only ONE ACTIVE driver (drivers_active_user_uniq_idx):
  // skip users whose link is already held — by a previous pass here, by the
  // name pass above, or by an earlier seed run — or the update collides.
  const takenUserIdsPhone = new Set((await db.select({ userId: schema.drivers.userId })
    .from(schema.drivers)
    .where(and(isNotNull(schema.drivers.userId), isNull(schema.drivers.deletedAt))))
    .map((d) => d.userId));

  let linkedCount = 0;
  for (const u of driverUsers) {
    if (!u.phone || takenUserIdsPhone.has(u.id)) continue;
    const [candidate] = await db.select({ id: schema.drivers.id })
      .from(schema.drivers)
      .where(and(
        eq(schema.drivers.phone, u.phone),
        isNull(schema.drivers.userId),
        isNull(schema.drivers.deletedAt),
      ))
      .orderBy(schema.drivers.id)
      .limit(1);
    if (!candidate) continue;
    await db.update(schema.drivers)
      .set({ userId: u.id })
      .where(eq(schema.drivers.id, candidate.id));
    takenUserIdsPhone.add(u.id);
    linkedCount += 1;
  }
  if (linkedCount > 0) {
    console.log(`✅ Drivers linked to user accounts! (${linkedCount} linked by phone)`);
  } else {
    console.log('✅ Driver↔user links already in place.');
  }

  const supplierSeeds = [
    { name: 'Petrolimex', contactPerson: 'Nguyễn Văn Hải', phone: '0901234567', taxCode: '0100100746', note: 'Nhà cung cấp xăng dầu chính', isFuelSupplier: true, chiHoDueDays: 15, cuocDueDays: 30 },
    { name: 'PV Oil', contactPerson: 'Trần Thị Thảo', phone: '0907654321', taxCode: '0102716892', note: 'Nhà cung cấp xăng dầu dự phòng', isFuelSupplier: true, chiHoDueDays: 15, cuocDueDays: 30 },
    { name: 'Gara Thành Đông', contactPerson: 'Lê Văn Đông', phone: '0912345678', taxCode: '0304567890', note: 'Xưởng sửa chữa xe chính', isFuelSupplier: false, chiHoDueDays: 15 },
    { name: 'Trạm Đăng kiểm 15-01S', contactPerson: 'Nguyễn Văn Đăng', phone: '02253888888', taxCode: '0304123456', note: 'Trung tâm đăng kiểm Hải Phòng', isFuelSupplier: false, chiHoDueDays: 15 },
    { name: 'Bảo hiểm Bảo Việt', contactPerson: 'Phạm Minh Việt', phone: '1900558899', taxCode: '0100111307', note: 'Công ty bảo hiểm', isFuelSupplier: false, chiHoDueDays: 15 },
  ];

  const existingSuppliers = await db.select({ name: schema.suppliers.name }).from(schema.suppliers);
  const existingSupplierNames = new Set(existingSuppliers.map(s => s.name));
  const newSuppliers = supplierSeeds.filter(s => !existingSupplierNames.has(s.name));

  if (newSuppliers.length > 0) {
    for (const sup of newSuppliers) {
      await db.insert(schema.suppliers).values(sup);
    }
    console.log(`✅ Suppliers seeded! (${newSuppliers.length} new)`);
  } else {
    console.log('✅ Suppliers already exist, skipping.');
  }

  // Wave 3 M6.2 — classify the seed suppliers into the type taxonomy.
  // Idempotent: classifySuppliersByName skips rows that already match.
  const { classifySuppliersByName, SupplierType } = await import('./services/supplier-types.service.js');
  const classifiedCount = await classifySuppliersByName([
    { namePattern: 'Petrolimex', types: [SupplierType.FUEL] },
    { namePattern: 'PV Oil', types: [SupplierType.FUEL] },
    { namePattern: 'Gara Thành Đông', types: [SupplierType.SERVICE] },
    { namePattern: 'Trạm Đăng kiểm 15-01S', types: [SupplierType.SERVICE] },
    { namePattern: 'Bảo hiểm Bảo Việt', types: [SupplierType.SERVICE] },
  ]);
  if (classifiedCount > 0) {
    console.log(`✅ Supplier type taxonomy applied (${classifiedCount} updated).`);
  } else {
    console.log('✅ Supplier types already classified.');
  }

  const categories = [
    { name: 'Sửa chữa', isRenewable: false, status: 'ACTIVE' },
    { name: 'Phụ tùng', isRenewable: false, status: 'ACTIVE' },
    { name: 'Vật tư', isRenewable: false, status: 'ACTIVE' },
    { name: 'Bảo hiểm', isRenewable: true, reminderLeadDays: 30, status: 'ACTIVE' },
    { name: 'Đăng kiểm', isRenewable: true, reminderLeadDays: 30, status: 'ACTIVE' },
    { name: 'Phí đường bộ', isRenewable: true, reminderLeadDays: 30, status: 'ACTIVE' },
  ];

  // Deduplicate existing categories
  const allCats = await db.select().from(schema.expenseCategories);
  const nameToIds = new Map<string, number[]>();
  for (const c of allCats) {
    const ids = nameToIds.get(c.name) || [];
    ids.push(c.id);
    nameToIds.set(c.name, ids);
  }

  for (const [name, ids] of nameToIds.entries()) {
    if (ids.length > 1) {
      const keepId = ids[0];
      const dupIds = ids.slice(1);
      for (const dupId of dupIds) {
        await db.update(schema.expenses)
          .set({ categoryId: keepId })
          .where(eq(schema.expenses.categoryId, dupId));
        await db.delete(schema.expenseCategories)
          .where(eq(schema.expenseCategories.id, dupId));
      }
      console.log(`  Deduplicated category "${name}": kept ID ${keepId}, removed duplicates [${dupIds.join(', ')}]`);
    }
  }

  const existingCats = await db.select({ name: schema.expenseCategories.name })
    .from(schema.expenseCategories);
  const existingCatNames = new Set(existingCats.map(c => c.name));
  const newCats = categories.filter(c => !existingCatNames.has(c.name));
  if (newCats.length > 0) {
    for (const cat of newCats) {
      await db.insert(schema.expenseCategories).values(cat);
    }
    console.log(`✅ Expense categories seeded! (${newCats.length} new)`);
  } else {
    console.log('✅ Expense categories already exist, skipping.');
  }

  const trucks = [
    { licensePlate: '60C-12345', trailerPlateNumber: '70C-12345', trailerType: '40FT' as const, status: 'ACTIVE' as const },
    { licensePlate: '60C-23456', trailerPlateNumber: '70C-67890', trailerType: '20FT' as const, status: 'ACTIVE' as const },
    { licensePlate: '60C-34567', status: 'ACTIVE' as const },
    { licensePlate: '60C-45678', status: 'ACTIVE' as const },
    { licensePlate: '60C-56789', trailerPlateNumber: '70C-11111', trailerType: '40FT' as const, status: 'MAINTENANCE' as const },
  ];

  const existingTrucks = await db.select({
    id: schema.trucks.id,
    licensePlate: schema.trucks.licensePlate,
    deletedAt: schema.trucks.deletedAt,
  }).from(schema.trucks);
  const truckByPlateKey = new Map<string, { id: number; deletedAt: Date | null }>();
  for (const existingTruck of existingTrucks) {
    const key = normalizeSeedText(existingTruck.licensePlate);
    if (!key) continue;
    const current = truckByPlateKey.get(key);
    if (!current || (current.deletedAt != null && existingTruck.deletedAt == null)) {
      truckByPlateKey.set(key, existingTruck);
    }
  }

  for (const truck of trucks) {
    const existingTruck = truckByPlateKey.get(normalizeSeedText(truck.licensePlate));
    if (existingTruck) {
      await db.update(schema.trucks).set({
        ...truck,
        deletedAt: null,
        updatedAt: new Date(),
      }).where(eq(schema.trucks.id, existingTruck.id));
      continue;
    }
    await db.insert(schema.trucks).values(truck);
  }

  const seededTrucks = await db.select({ id: schema.trucks.id, licensePlate: schema.trucks.licensePlate })
    .from(schema.trucks);
  const truckIdByPlate = new Map(seededTrucks.map(t => [t.licensePlate, t.id]));
  const driverAssignments = [
    ['Phạm Văn Hùng', '60C-12345'],
    ['Nguyễn Văn Thụ', '60C-23456'],
    ['Lê Văn Quyết', '60C-34567'],
    ['Nguyễn Văn Phố', '60C-45678'],
  ] as const;
  for (const [name, plate] of driverAssignments) {
    const assignedTruckId = truckIdByPlate.get(plate);
    if (assignedTruckId) {
      const [driver] = await db.select({ id: schema.drivers.id }).from(schema.drivers)
        .where(eq(schema.drivers.name, name)).limit(1);
      if (driver) {
        await db.transaction((tx) => reassignTruckDriverInTx(tx, {
          truckId: assignedTruckId,
          driverId: driver.id,
          createdBy: null,
        }));
      }
    }
  }

  console.log('✅ Trucks seeded!');
  for (const t of trucks) {
    console.log(`  ${t.licensePlate}${t.trailerPlateNumber ? ` → rơ moóc ${t.trailerPlateNumber} (${t.trailerType})` : ''}`);
  }

  const penaltyReasons = [
    { reasonText: 'Đi trễ', defaultAmount: '100000' },
    { reasonText: 'Vi phạm tốc độ', defaultAmount: '200000' },
    { reasonText: 'Sử dụng điện thoại khi lái xe', defaultAmount: '300000' },
    { reasonText: 'Không tuân thủ tuyến đường', defaultAmount: '200000' },
    { reasonText: 'Xe không sạch sẽ', defaultAmount: '50000' },
    { reasonText: 'Thiếu giấy tờ', defaultAmount: '150000' },
    { reasonText: 'Không đội mũ bảo hiểm', defaultAmount: '100000' },
    { reasonText: 'Lái xe khi say xỉn', defaultAmount: '1000000' },
  ];

  const existingReasons = await db.select({ reasonText: schema.penaltyReasons.reasonText })
    .from(schema.penaltyReasons);
  const existingReasonTexts = new Set(existingReasons.map(r => r.reasonText));
  const newReasons = penaltyReasons.filter(r => !existingReasonTexts.has(r.reasonText));
  if (newReasons.length > 0) {
    for (const reason of newReasons) {
      await db.insert(schema.penaltyReasons).values(reason);
    }
    console.log(`✅ Penalty reasons seeded! (${newReasons.length} new)`);
  } else {
    console.log('✅ Penalty reasons already exist, skipping.');
  }

  // Fix typo in existing penalty reasons (CFG3)
  const typoRows = await db.select().from(schema.penaltyReasons)
    .where(eq(schema.penaltyReasons.reasonText, 'Không chùy mũ bảo hiểm'));
  if (typoRows.length > 0) {
    await db.update(schema.penaltyReasons)
      .set({ reasonText: 'Không đội mũ bảo hiểm' })
      .where(eq(schema.penaltyReasons.reasonText, 'Không chùy mũ bảo hiểm'));
    console.log(`✅ Penalty reason typo fixed (${typoRows.length} row(s)).`);
  } else {
    console.log('✅ No penalty reason typo found, skipping fix.');
  }

  // Seed cap table (CAP1, CAP2)
  // Previous version did insert-only-if-empty, so an earlier broken seed run
  // (5 rows all "Ông Thương" 0%) couldn't be corrected without manual SQL.
  // Now we detect bad seed data (all rows have 0% or only one partner) and
  // reset to the canonical 60/40 split.
  const existingCap = await db.select().from(schema.capTableHistory);
  const distinctPartners = new Set(existingCap.map(r => r.partnerName));
  const hasNonZeroPct = existingCap.some(r => parseFloat(r.percentage) > 0);
  const needsReset =
    existingCap.length === 0 ||
    distinctPartners.size < 2 ||
    !hasNonZeroPct;
  if (needsReset) {
    if (existingCap.length > 0) {
      await db.delete(schema.capTableHistory);
      console.log(`⚠️  Cap table had ${existingCap.length} stale row(s) — clearing and reseeding.`);
    }
    const now = new Date();
    await db.insert(schema.capTableHistory).values([
      {
        partnerName: 'Ông Thương',
        contributionAmount: '0',
        percentage: '60.00',
        effectiveDate: `${now.getFullYear()}-01-01`,
      },
      {
        partnerName: 'Bà Hạnh',
        contributionAmount: '0',
        percentage: '40.00',
        effectiveDate: `${now.getFullYear()}-01-01`,
      },
    ]);
    console.log('✅ Cap table seeded! (60/40 split)');
  } else {
    console.log(`✅ Cap table OK (${existingCap.length} row(s), ${distinctPartners.size} partner(s)), skipping.`);
  }

  // Backfill ledger entries for UNPAID expenses that never posted (PAY1)
  // -------------------------------------------------------------------
  // We've seen UNPAID expenses created via API end up in `expenses` but
  // miss the matching `ledger` row (entityType=VENDOR), so /payables
  // displays 0đ even though the company genuinely owes the supplier.
  // For every UNPAID, non-deleted expense, ensure a VENDOR_EXPENSE
  // ledger row exists; if not, post one.
  const unpaidExpenses = await db.select({
    id: schema.expenses.id,
    supplierId: schema.expenses.supplierId,
    amount: schema.expenses.amount,
    categoryId: schema.expenses.categoryId,
    createdAt: schema.expenses.createdAt,
  }).from(schema.expenses)
    .where(eq(schema.expenses.paymentStatus, 'UNPAID'));

  let backfilledLedger = 0;
  for (const exp of unpaidExpenses) {
    const amount = parseFloat(exp.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const existingLedger = await db.select({ id: schema.ledger.id })
      .from(schema.ledger)
      .where(and(
        eq(schema.ledger.entityType, 'VENDOR'),
        eq(schema.ledger.entityId, exp.supplierId),
        eq(schema.ledger.credit, exp.amount),
      ))
      .limit(1);
    if (existingLedger.length > 0) continue;
    // Compute running balance for this vendor and post the entry directly
    // (skip the LedgerService since we're outside its tx contract).
    const [lastEntry] = await db.select({ balance: schema.ledger.balance })
      .from(schema.ledger)
      .where(and(
        eq(schema.ledger.entityType, 'VENDOR'),
        eq(schema.ledger.entityId, exp.supplierId),
      ))
      .orderBy(desc(schema.ledger.id))
      .limit(1);
    const prevBalance = lastEntry ? parseFloat(lastEntry.balance) : 0;
    // Vendor: credit increases payable balance.
    const newBalance = prevBalance + amount;
    await db.insert(schema.ledger).values({
      txnType: 'VENDOR_EXPENSE',
      entityType: 'VENDOR',
      entityId: exp.supplierId,
      debit: '0',
      credit: String(amount),
      balance: String(newBalance),
      timestamp: exp.createdAt ?? new Date(),
      note: 'Bổ sung dữ liệu chi phí cũ',
    });
    backfilledLedger++;
  }
  if (backfilledLedger > 0) {
    console.log(`✅ Backfilled ${backfilledLedger} VENDOR ledger entr${backfilledLedger === 1 ? 'y' : 'ies'} for orphan UNPAID expenses.`);
  } else {
    console.log('✅ No orphan UNPAID expenses found, ledger is in sync.');
  }

  // ─── Container types (Pete's request: 20DC/20OT/20RF/40DC/40HC) ────────────
  const containerTypeSeeds = [
    { code: '20DC',  name: "20'DC",  notes: 'Container khô tiêu chuẩn 20 feet' },
    { code: '20OT',  name: "20'OT",  notes: 'Container mở nóc (Open Top) 20 feet' },
    { code: '20RF',  name: "20'RF",  notes: 'Container lạnh (Reefer) 20 feet' },
    { code: '40DC',  name: "40'DC",  notes: 'Container khô tiêu chuẩn 40 feet' },
    { code: '40HC',  name: "40'HC",  notes: 'Container khô cao (High Cube) 40 feet' },
    { code: '40RF',  name: "40'RF",  notes: 'Container lạnh (Reefer) 40 feet' },
    { code: '45HC',  name: "45'HC",  notes: 'Container khô cao 45 feet' },
  ];
  const existingCtTypes = await db.select({ code: schema.containerTypes.code })
    .from(schema.containerTypes);
  const existingCtCodes = new Set(existingCtTypes.map(c => c.code));
  const newCtTypes = containerTypeSeeds.filter(c => !existingCtCodes.has(c.code));
  let containerTypeUpdates = 0;
  for (const ct of containerTypeSeeds) {
    const [existingContainerType] = await db.select({ id: schema.containerTypes.id })
      .from(schema.containerTypes)
      .where(normalizedTextEquals(schema.containerTypes.code, ct.code))
      .limit(1);
    if (existingContainerType) {
      await db.update(schema.containerTypes).set({
        ...ct,
        deletedAt: null,
        updatedAt: new Date(),
      }).where(eq(schema.containerTypes.id, existingContainerType.id));
      containerTypeUpdates += 1;
      continue;
    }
    await db.insert(schema.containerTypes).values(ct);
  }
  if (newCtTypes.length > 0) {
    console.log(`✅ Container types seeded! (${newCtTypes.length} new, ${containerTypeUpdates} refreshed)`);
  } else {
    console.log(`✅ Container types already exist, refreshed ${containerTypeUpdates} canonical rows.`);
  }

  // ─── Dispatch zones (taxonomy authority, DB-owned) ────────────────────────
  // Codes are stable cross-environment keys; the taxonomy lives in data so a
  // new cluster is a seed row, not a deploy. Insert-missing only: once a zone
  // exists, ADMIN owns its label/order/status — a re-run must never revert
  // operator edits.
  const dispatchZoneSeeds = [
    { code: 'LACH_HUYEN', label: 'Lạch Huyện', sortOrder: 10 },
    { code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 20 },
  ];
  let zoneInsertCount = 0;
  for (const zone of dispatchZoneSeeds) {
    const [existing] = await db.select({ id: schema.dispatchZones.id })
      .from(schema.dispatchZones)
      .where(eq(schema.dispatchZones.code, zone.code))
      .limit(1);
    if (!existing) {
      await db.insert(schema.dispatchZones).values(zone);
      zoneInsertCount += 1;
    }
  }
  console.log(`✅ Dispatch zones verified! (${zoneInsertCount} new, ${dispatchZoneSeeds.length} ensured)`);

  // ─── Hai Phong ports/yards (Pete's request) ────────────────────────────────
  // Two clusters: Lạch Huyện deep-water terminals (Cát Hải, far) and the main
  // Cấm river-mouth cluster (near). Names mirror the live ops rows exactly —
  // seed never renames an ops-created port; a matching row only gets a NULL
  // dispatch_zone filled in below. Zone is the dispatch taxonomy authority.
  const portSeeds = [
    // Lạch Huyện cluster (LACH_HUYEN)
    { name: 'TC - HICT',                          shortName: 'HICT',        code: 'HICT', city: 'Hải Phòng', address: 'Lạch Huyện, Cát Hải, Hải Phòng', dispatchZone: 'LACH_HUYEN' },
    { name: 'TIL - HTIT',                         shortName: 'HTIT',        code: 'HTIT', city: 'Hải Phòng', address: 'Lạch Huyện, Cát Hải, Hải Phòng', dispatchZone: 'LACH_HUYEN' },
    { name: 'Hateco - HHIT',                      shortName: 'HHIT',        code: 'HHIT', city: 'Hải Phòng', address: 'Lạch Huyện, Cát Hải, Hải Phòng', dispatchZone: 'LACH_HUYEN' },
    // Hải Phòng cluster — Cấm river mouth, ICDs and yards (HAI_PHONG)
    { name: 'Cảng Hải Phòng',                    shortName: 'Hải Phòng',    code: 'HPH',  city: 'Hải Phòng', address: 'Quận Hồng Bàng, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Cảng Đình Vũ',                      shortName: 'Đình Vũ',      code: 'DVU',  city: 'Hải Phòng', address: 'Đông Hải 2, Hải An, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Cảng Tân Vũ',                       shortName: 'Tân Vũ',       code: 'TVU',  city: 'Hải Phòng', address: 'Đông Hải 2, Hải An, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Cảng Nam Hải Đình Vũ',              shortName: 'Nam Hải ĐV',   code: 'NHDV', city: 'Hải Phòng', address: 'Đông Hải 2, Hải An, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Cảng Nam Đình Vũ',                  shortName: 'Nam ĐV',       code: 'NDVU', city: 'Hải Phòng', address: 'Đông Hải 2, Hải An, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Cảng Tân Cảng 128 Hải Phòng',       shortName: 'TC128',        code: 'TC128', city: 'Hải Phòng', address: 'Hùng Vương, Hồng Bàng, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Cảng VIP Greenport',                shortName: 'VIP Green',    code: 'VIPG', city: 'Hải Phòng', address: 'Đông Hải 2, Hải An, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Cảng Xanh - Green port',            shortName: 'Cảng Xanh',    code: 'GPH',  city: 'Hải Phòng', address: 'Đông Hải 2, Hải An, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Cảng Xanh Vip - Vip Green Port',    shortName: 'Xanh VIP',     code: 'XVIP', city: 'Hải Phòng', address: 'Đông Hải 2, Hải An, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'ICD Hoàng Thành',                   shortName: 'Hoàng Thành',  code: 'HTHA', city: 'Hải Phòng', address: 'An Dương, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Cảng Hải An',                       shortName: 'Hải An',       code: 'HAAN', city: 'Hải Phòng', address: 'Hải An, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Cảng Hoàng Diệu',                   shortName: 'Hoàng Diệu',   code: 'HDU',  city: 'Hải Phòng', address: 'Ngô Quyền, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Bãi SITC',                          shortName: 'SITC',         code: 'SITC', city: 'Hải Phòng', address: 'Đông Hải 2, Hải An, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Bãi GFT',                           shortName: 'GFT',          code: 'GFT',  city: 'Hải Phòng', address: 'Đông Hải 2, Hải An, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Bãi Minh Phương',                   shortName: 'Minh Phương',  code: 'MPH',  city: 'Hải Phòng', address: 'An Dương, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Bãi Liên Việt',                     shortName: 'Liên Việt',    code: 'LV',   city: 'Hải Phòng', address: 'An Dương, Hải Phòng', dispatchZone: 'HAI_PHONG' },
    { name: 'Bãi Chân Thật - THT',               shortName: 'Chân Thật',    code: 'CT',   city: 'Hải Phòng', address: 'An Dương, Hải Phòng', dispatchZone: 'HAI_PHONG' },
  ];
  const existingPorts = await db.select({
    id: schema.ports.id,
    code: schema.ports.code,
    name: schema.ports.name,
    shortName: schema.ports.shortName,
    deletedAt: schema.ports.deletedAt,
  })
    .from(schema.ports);
  const portByCodeKey = new Map<string, { id: number; deletedAt: Date | null; shortName: string | null }>();
  const portByNameKey = new Map<string, { id: number; deletedAt: Date | null; shortName: string | null }>();
  for (const existingPort of existingPorts) {
    const codeKey = normalizeSeedText(existingPort.code);
    const nameKey = normalizeSeedText(existingPort.name);
    if (codeKey) {
      const current = portByCodeKey.get(codeKey);
      if (!current || (current.deletedAt != null && existingPort.deletedAt == null)) {
        portByCodeKey.set(codeKey, existingPort);
      }
    }
    if (nameKey) {
      const current = portByNameKey.get(nameKey);
      if (!current || (current.deletedAt != null && existingPort.deletedAt == null)) {
        portByNameKey.set(nameKey, existingPort);
      }
    }
  }
  let newPorts = 0;
  let zoneFilled = 0;
  let shortNameFilled = 0;
  for (const port of portSeeds) {
    const existingPort = portByCodeKey.get(normalizeSeedText(port.code))
      ?? portByNameKey.get(normalizeSeedText(port.name));
    if (existingPort) {
      // Ops may have edited address/city/zone on live rows (and soft-deleted
      // dupes must stay deleted): only backfill a NULL dispatch_zone or an
      // empty short_name, never overwrite other fields.
      if (port.dispatchZone && existingPort.deletedAt == null) {
        const filled = await db.update(schema.ports).set({
          dispatchZone: port.dispatchZone,
          updatedAt: new Date(),
        }).where(and(
          eq(schema.ports.id, existingPort.id),
          isNull(schema.ports.dispatchZone),
        )).returning({ id: schema.ports.id });
        zoneFilled += filled.length;
      }
      if (port.shortName && existingPort.deletedAt == null && !existingPort.shortName?.trim()) {
        const filled = await db.update(schema.ports).set({
          shortName: port.shortName,
          updatedAt: new Date(),
        }).where(eq(schema.ports.id, existingPort.id)).returning({ id: schema.ports.id });
        shortNameFilled += filled.length;
      }
      continue;
    }
    await db.insert(schema.ports).values(port);
    newPorts += 1;
  }
  if (newPorts > 0) {
    console.log(`✅ Hai Phong ports/yards seeded! (${newPorts} new, ${zoneFilled} zone backfilled, ${shortNameFilled} short name backfilled)`);
  } else {
    console.log(`✅ Ports already exist, ${zoneFilled} zone backfilled, ${shortNameFilled} short name backfilled.`);
  }

  // ─── Forwarder expense types (user-configurable) ─────────────────────────
  // Upsert all 8 fee types with defaultMarkup, billingLabel, vatRate so that
  // re-running seed is safe and always brings the table up to date.
  const defaultNoInvoiceCodes = new Set([
    'LIFTING',
    'LOWERING',
    'WEIGHING',
    'INFRASTRUCTURE',
    'INSPECTION',
    'INSPECTION_SVC',
    'OTHER',
  ]);
  let fetUpsertCount = 0;
  const existingForwarderExpenseTypes = await db.select({
    id: schema.forwarderExpenseTypes.id,
    code: schema.forwarderExpenseTypes.code,
  }).from(schema.forwarderExpenseTypes);
  const forwarderExpenseTypeByCode = new Map(
    existingForwarderExpenseTypes
      .filter((row) => row.code)
      .map((row) => [normalizeSeedText(row.code), row.id] as const),
  );
  for (const [code, meta] of Object.entries(OPS_EXPENSE_TYPE_DEFAULTS)) {
    const substituteEvidenceAllowed = defaultNoInvoiceCodes.has(code);
    const values = {
      code,
      name: meta.name,
      requiresInvoice: false,
      substituteEvidenceAllowed,
      noInvoiceEvidenceTypes: substituteEvidenceAllowed ? [...DEFAULT_NO_INVOICE_EVIDENCE_TYPES] : [],
      noInvoicePerItemLimit: String(NO_INVOICE_POLICY_DEFAULTS.perItemLimit),
      noInvoicePerDayLimit: String(NO_INVOICE_POLICY_DEFAULTS.perDayLimit),
      defaultMarkup: meta.defaultMarkup,
      billingLabel: meta.billingLabel,
      vatRate: '0.080',
    } as const;
    const existingId = forwarderExpenseTypeByCode.get(normalizeSeedText(code));
    if (existingId != null) {
      await db.update(schema.forwarderExpenseTypes)
        .set({ ...values, deletedAt: null, updatedAt: new Date() })
        .where(eq(schema.forwarderExpenseTypes.id, existingId));
    } else {
      await db.insert(schema.forwarderExpenseTypes).values(values);
    }
    fetUpsertCount++;
  }
  console.log(`✅ Forwarder expense types upserted! (${fetUpsertCount} codes)`);

  // ─── Own company info (used on config/document surfaces) ─────────────────
  // Seeds empty placeholder rows from COMPANY_INFO_DEFAULTS (white-label — no
  // company identity is baked in). The admin fills the real profile on
  // /config/company-info. Idempotent (onConflictDoNothing) so it never clobbers
  // an admin-configured profile.
  for (const field of Object.keys(COMPANY_INFO_SETTING_KEYS) as Array<keyof typeof COMPANY_INFO_SETTING_KEYS>) {
    await db.insert(schema.appSettings)
      .values({ key: COMPANY_INFO_SETTING_KEYS[field], value: COMPANY_INFO_DEFAULTS[field] ?? '' })
      .onConflictDoNothing();
  }
  console.log('✅ Company information defaults seeded!');

  const [existingFuelConfig] = await db.select({ id: schema.fuelConfig.id })
    .from(schema.fuelConfig)
    .where(isNull(schema.fuelConfig.deletedAt))
    .limit(1);
  if (!existingFuelConfig) {
    await db.insert(schema.fuelConfig).values({
      loadedNorm: '35',
      emptyNorm: '22',
      supplement: '3',
      unitPrice: '23000',
      baseUnitPrice: '23000',
      warningThreshold: '37',
      criticalThreshold: '40',
    });
    console.log('✅ Fuel config seeded with neutral surcharge baseline.');
  }

  // Install the customer-owned operational master data and the Long Minh
  // Debit Note authority as part of every supported setup/seed path. These
  // seeders are idempotent and deliberately run after generic defaults so the
  // approved Silver Sea identity is the final configured export identity.
  const reference = await seedReference();
  await seedLiftPricing(reference);
  const seededCustomers = await seedCustomers();
  await seedPricingTables(reference, seededCustomers);
  // DEMO freight-pricing chain — dev/staging only, runs AFTER the customer
  // matrix seeder so the withheld (blank-Excel) 15T rungs converge to demo
  // prices instead of staying soft-deleted. seed-prod excludes this module.
  await seedDemoFreightPricing();
  // Seed operational sites (factories + warehouses) after customers so the
  // shipment intake "Nhà máy"/"Kho lấy hàng" dropdowns are never empty.
  await seedOperationalSites();

  // Seed data from Excel files (ports, vehicles, factories)
  await seedPorts();
  await seedVehiclesFromExcel();
  await seedFactories();

  await seedShipments(passwordHash);
  await seedClerkScope();

  // Trips flow through the real dispatch chain (carrier allocation → handoff
  // → dispatch order → status transitions), so dispatch/ops screens show
  // production-shaped rows.
  const seedActors = await resolveSeedActors();
  const opsUser = await db.select().from(schema.users)
    .where(eq(schema.users.username, 'giaonhan')).limit(1);
  const { opsExpenseIds } = await seedTrips({ ...seedActors, ops: opsUser[0] });
  const adminUser = await db.select({ id: schema.users.id }).from(schema.users)
    .where(eq(schema.users.username, 'admin')).limit(1);
  await seedVendorFinancials(seedActors.manager.userId, adminUser[0]!.id);

  await seedForwarderMoney({ ops: opsUser[0]!.id, approver: adminUser[0]!.id }, opsExpenseIds);

  // e-POD acceptance + debit note + payment receipt close the O2C loop.
  await seedCustomerAr({
    cus: seedActors.cus as never,
    accountant: seedActors.accountant as never,
    manager: seedActors.manager as never,
  });

  // Bulk synthetic dataset (≈250 shipments, ≈200 trips, ≈30 customers,
  // ≈60 expenses). Idempotent: a single `BULK-MARKER-DO-NOT-DELETE` row
  // marks the bulk seed and is probed on every run. Runs after the
  // canonical O2C chain so the canonical rows still pass their existing
  // shape assertions; the bulk rows are additive and use the `BULK-`
  // prefix on every ref so existing tests continue to assert on the
  // small canonical set.
  await seedBulkData();
}

export async function seedClerkScope(): Promise<void> {
  const [clerk] = await db.select({ id: schema.users.id }).from(schema.users)
    .where(and(eq(schema.users.username, 'cus'), eq(schema.users.role, Role.CUS), isNull(schema.users.deletedAt)))
    .limit(1);
  if (!clerk) throw new Error('Không tìm thấy tài khoản CUS demo sau khi seed');

  const businessUnitValues = {
    code: 'CUS-DEMO',
    name: 'Đơn vị CUS Demo',
    status: 'ACTIVE',
  } as const;
  const [existingUnit] = await db.select({ id: schema.businessUnits.id })
    .from(schema.businessUnits)
    .where(sql`
      ${normalizedNullableTextEquals(schema.businessUnits.code, businessUnitValues.code)}
      or ${normalizedTextEquals(schema.businessUnits.name, businessUnitValues.name)}
    `)
    .limit(1);
  let unitId: number;
  if (existingUnit) {
    await db.update(schema.businessUnits).set({
      ...businessUnitValues,
      updatedAt: new Date(),
    }).where(eq(schema.businessUnits.id, existingUnit.id));
    unitId = existingUnit.id;
  } else {
    const [createdUnit] = await db.insert(schema.businessUnits)
      .values(businessUnitValues)
      .returning({ id: schema.businessUnits.id });
    unitId = createdUnit!.id;
  }

  const [existingBusinessUnitLink] = await db.select({ id: schema.userBusinessUnitLinks.id })
    .from(schema.userBusinessUnitLinks)
    .where(and(
      eq(schema.userBusinessUnitLinks.userId, clerk.id),
      eq(schema.userBusinessUnitLinks.businessUnitId, unitId),
    ))
    .limit(1);
  if (existingBusinessUnitLink) {
    await db.update(schema.userBusinessUnitLinks)
      .set({ updatedAt: new Date() })
      .where(eq(schema.userBusinessUnitLinks.id, existingBusinessUnitLink.id));
  } else {
    await db.insert(schema.userBusinessUnitLinks).values({
      userId: clerk.id,
      businessUnitId: unitId,
    });
  }

  // Scope the demo CUS unit to every seed shipment so the clerk can act on
  // all of them (dispatch allocation is a CUS responsibility).
  await db.update(schema.shipments)
    .set({ responsibleUnitId: unitId, updatedAt: new Date() })
    .where(sql`(
      ${schema.shipments.blNumber} in ('105254544125', '105254544198', '137465191612', '137465191698',
        '105254549001', '105254549088', '137465192255', '105254550147')
      or ${schema.shipments.bookingRef} in ('DNKM13333', 'DNKM13334', 'DNKM13335', 'DNKM13336', 'DNKM13337', 'DNKM13338', 'DNKM13339')
    )`);

  const scopedCustomers = await db.select({ id: schema.customers.id }).from(schema.customers)
    .where(and(isNull(schema.customers.deletedAt), sql`${schema.customers.taxCode} in ('0101234567', '0107654321', '1100987654', '1100456789', '0700321654', '2300540419')`));
  for (const customer of scopedCustomers) {
    const [existingCustomerLink] = await db.select({ id: schema.userCustomerLinks.id })
      .from(schema.userCustomerLinks)
      .where(and(
        eq(schema.userCustomerLinks.userId, clerk.id),
        eq(schema.userCustomerLinks.customerId, customer.id),
      ))
      .limit(1);
    if (existingCustomerLink) {
      await db.update(schema.userCustomerLinks)
        .set({ updatedAt: new Date() })
        .where(eq(schema.userCustomerLinks.id, existingCustomerLink.id));
      continue;
    }
    await db.insert(schema.userCustomerLinks).values({
      userId: clerk.id,
      customerId: customer.id,
    });
  }

  console.log(`✅ CUS demo scope seeded! (${scopedCustomers.length} customers, 1 business unit)`);
}

// ─── Wave 0: shipments + CUSTOMER demo user ──────────────────────────────────
//
// Seeds a CUSTOMER-role demo login + sample shipments in mixed statuses so
// the Wave 0 ShipmentsPage has something to render during QA and the
// eventual Wave 2 customer portal has a login to test all the screens.
//
// Idempotency contract:
//   - CUSTOMER user:               onConflictDoNothing on unique username.
//   - Sample customers:            existence check by stable taxCode.
//   - Sample shipments:            existence check by stable document ref
//                                  (blNumber for IMPORT, bookingRef for
//                                  EXPORT — the one-ref invariant) BEFORE
//                                  calling createShipment (which would
//                                  otherwise generate a new shipmentCode +
//                                  row each invocation).
//   - Status transitions + children: only attached when the shipment is
//                                  first created (gated by the same
//                                  existence check).
//
// Exported so the test in tests/seed-shipments.test.ts can exercise it
// directly without re-running the full `pnpm seed` flow.

// Stable reference IDs resolved by name/code at seed runtime (never
// hard-coded) so they survive RESTART IDENTITY from a wipe.
let PORT_HAI_PHONG = 0;
let PORT_DINH_VU = 0;
let PORT_LACH_HUYEN = 0;
let CONTAINER_TYPE_40DC = 0;
let CONTAINER_TYPE_40HC = 0;
let ROUTE_NEWEB = 0;
let ROUTE_ASKEY = 0;
let ROUTE_SUNRISE = 0;

async function resolveSeedReferenceIds() {
  const portByName = await db.select({ id: schema.ports.id, name: schema.ports.name, code: schema.ports.code })
    .from(schema.ports)
    .where(isNull(schema.ports.deletedAt));
  for (const p of portByName) {
    if (p.name === 'Cảng Hải Phòng') PORT_HAI_PHONG = p.id;
    if (p.name === 'Cảng Đình Vũ') PORT_DINH_VU = p.id;
    if (p.code === 'HICT') PORT_LACH_HUYEN = p.id;
  }
  const ctByCode = await db.select({ id: schema.containerTypes.id, code: schema.containerTypes.code })
    .from(schema.containerTypes)
    .where(isNull(schema.containerTypes.deletedAt));
  for (const ct of ctByCode) {
    if (ct.code === '40DC') CONTAINER_TYPE_40DC = ct.id;
    if (ct.code === '40HC') CONTAINER_TYPE_40HC = ct.id;
  }
  const routes = await db.select({ id: schema.routes.id, name: schema.routes.name })
    .from(schema.routes)
    .where(isNull(schema.routes.deletedAt));
  for (const r of routes) {
    if (r.name === 'Hải Phòng-NEWEB') ROUTE_NEWEB = r.id;
    if (r.name === 'ASKEY') ROUTE_ASKEY = r.id;
    if (r.name === 'SUNRISE+  SJ') ROUTE_SUNRISE = r.id;
  }
  if (!PORT_HAI_PHONG || !PORT_DINH_VU || !PORT_LACH_HUYEN || !CONTAINER_TYPE_40DC || !CONTAINER_TYPE_40HC) {
    throw new Error('Seed reference lookup failed: ports/container types missing — run the earlier seeders first.');
  }
}

export async function seedShipments(passwordHash: string) {
  await resolveSeedReferenceIds();
  console.log('\n📦 Seeding Wave 0 shipments + CUSTOMER demo user...');

  // 2. Two sample customers (operator-side AR customers — distinct from the
  //    CUSTOMER demo user above). Stable tax codes make the seed idempotent.
  //    The lookup uses the SAME expression as the partial unique index
  //    `customers_active_tax_code_uniq_idx` (lower(btrim(taxCode)) WHERE
  //    deletedAt IS NULL AND taxCode <> '') so case/whitespace variants
  //    resolve to the same row.
  const sampleCustomerSeeds = [
    { name: 'Công ty CP Vận tải Biển Bạc', taxCode: '0101234567', contactPerson: 'Phạm Thị Biển', phone: '02253555555' },
    { name: 'Công ty TNHH XNK Hà Nội', taxCode: '0107654321', contactPerson: 'Trịnh Văn Hà', phone: '02438888888' },
    { name: 'Công ty TNHH SX TM Dệt May Vân Trung', taxCode: '1100987654', contactPerson: 'Vũ Thị Vân', phone: '02213654321' },
    { name: 'Công ty CP Thực phẩm Đồng Văn', taxCode: '1100456789', contactPerson: 'Trần Văn Đồng', phone: '02213876543' },
    { name: 'Công ty TNHH Điện tử ASKEY Việt Nam', taxCode: '0700321654', contactPerson: 'Lý Thị Kiều', phone: '0203333444' },
    // Customer-portal demo rows. The two CUSTOMER users samsung-cs and
    // canon-cs (added below) are row-scoped to these customers so TC-CUST-SHIP-03
    // (row-scope, no leak) has two distinct portals to cross-verify.
    { name: 'Công ty TNHH Samsung Electronics Việt Nam', taxCode: '0301444111', contactPerson: 'Trần Minh Đức', phone: '02253991111' },
    { name: 'Công ty TNHH Canon Việt Nam', taxCode: '0301444222', contactPerson: 'Lê Thị Hương', phone: '02253992222' },
  ];
  const sampleCustomers: { id: number; name: string }[] = [];
  for (const c of sampleCustomerSeeds) {
    const normalisedTaxCode = c.taxCode.toLowerCase().trim();
    const [existing] = await db.select({ id: schema.customers.id, name: schema.customers.name })
      .from(schema.customers)
      .where(and(
        eq(sql`lower(btrim(${schema.customers.taxCode}))`, normalisedTaxCode),
        isNull(schema.customers.deletedAt),
      ))
      .limit(1);
    if (existing) {
      sampleCustomers.push(existing);
      continue;
    }
    const [created] = await db.insert(schema.customers).values({ ...c, shortName: c.name.replace(/^(Công ty|CÔNG TY)[^ ]* /, '').slice(0, 60) }).returning({ id: schema.customers.id, name: schema.customers.name });
    sampleCustomers.push(created);
  }
  console.log(`  ✅ Sample customers (${sampleCustomers.length} stable rows)`);

  // 2b. Insert the CUSTOMER demo logins only when missing. Existing rows
  // are preserved byte-for-byte so restore/bootstrap flows never clobber
  // operator-managed credentials or row-scope fields. The first sample
  // customer remains the default `customer` portal; samsung-cs and canon-cs
  // are row-scoped to their own customers so TC-CUST-SHIP-03 (row-scope,
  // no leak) has two distinct portals to cross-verify.
  const portalCustomer = sampleCustomers[0];
  const samsungCustomer = sampleCustomers[5];
  const canonCustomer = sampleCustomers[6];
  const customerPortalSeeds: Array<{
    username: string;
    email: string;
    phone: string;
    fullName: string;
    customerId: number;
  }> = [
    { username: 'customer', email: 'customer@nepo.vn', phone: '0900000020', fullName: 'Khách hàng Demo', customerId: portalCustomer.id },
    { username: 'samsung-cs', email: 'samsung.cs@nepo.vn', phone: '0900000021', fullName: 'Trần Minh Đức', customerId: samsungCustomer.id },
    { username: 'canon-cs', email: 'canon.cs@nepo.vn', phone: '0900000022', fullName: 'Lê Thị Hương', customerId: canonCustomer.id },
  ];
  for (const seed of customerPortalSeeds) {
    const [existing] = await db.select({ id: schema.users.id })
      .from(schema.users)
      .where(normalizedTextEquals(schema.users.username, seed.username))
      .limit(1);
    if (existing) continue;
    await db.insert(schema.users).values({
      ...seed,
      passwordHash,
      role: Role.CUSTOMER,
      status: 'ACTIVE',
    });
  }
  console.log('  ✅ CUSTOMER demo users (customer / samsung-cs / canon-cs, all /Abc123)');

  // 3. Sample shipments — realistic refs, every lifecycle status, both trade
  //    directions. Idempotency key = the document ref itself (blNumber for
  //    IMPORT, bookingRef for EXPORT — the DB one-ref invariant means exactly
  //    one of the two is populated per shipment).
  type ShipmentSeed = {
    tradeDirection: 'IMPORT' | 'EXPORT';
    routeName?: 'NEWEB' | 'ASKEY' | 'SUNRISE';
    ref: string; // BL number (IMPORT) or booking ref (EXPORT) — idempotency key
    customerId: number;
    expectedDeliveryDate?: string; // omit → initial status PENDING_DATE
    pickupLocation: string;
    deliveryLocation: string;
    contactName: string;
    contactPhone: string;
    closingAt?: string;
    advanceTo?: 'DISPATCHED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELED';
    containers?: Array<{
      containerNumber: string;
      sealNumber: string;
      cargoWeightKg: number;
      /** Optional per-container factory authority (SILVER L1). */
      factoryCode?: string;
      /** Optional per-container appointment instant (SILVER L1). */
      appointmentAt?: string;
    }>;
    document?: { type: 'BOOKING' | 'BL' | 'DO' | 'DECLARATION' | 'OTHER'; storageKey: string };
    declaration?: { declarationNumber: string; scope: 'SINGLE' | 'SHARED'; note: string };
  };

  const [bienBac, haNoi, vanTrung, dongVan, askey, samsung, canon] = sampleCustomers;
  const shipmentSeeds: ShipmentSeed[] = [
    // ── IMPORT — Bill refs, container haulage from Hai Phong ports ──────────
    {
      tradeDirection: 'IMPORT', ref: '105254544125', customerId: bienBac.id,
      expectedDeliveryDate: '2026-08-20',
      pickupLocation: 'Cảng Hải Phòng', deliveryLocation: 'Kho Biển Bạc, Bắc Ninh',
      contactName: 'Phạm Thị Biển', contactPhone: '02253555555',
    },
    {
      tradeDirection: 'IMPORT', ref: '105254544198', customerId: haNoi.id,
      // No dates → stays PENDING_DATE (booking awaiting schedule).
      pickupLocation: 'Cảng Đình Vũ', deliveryLocation: 'ICD Mỹ Đình, Hà Nội',
      contactName: 'Trịnh Văn Hà', contactPhone: '02438888888',
    },
    {
      tradeDirection: 'IMPORT', ref: '137465191612', routeName: 'SUNRISE', customerId: vanTrung.id,
      expectedDeliveryDate: '2026-08-18',
      pickupLocation: 'TC - HICT', deliveryLocation: 'KCN Vân Trung, Bắc Giang',
      contactName: 'Vũ Thị Vân', contactPhone: '02213654321',
            containers: [
        { containerNumber: 'CMAU3145620', sealNumber: 'SL8437216', cargoWeightKg: 21600 },
        { containerNumber: 'EGHU2047632', sealNumber: 'SL8437217', cargoWeightKg: 20400 },
      ],
    },
    {
      tradeDirection: 'IMPORT', ref: '137465191698', routeName: 'SUNRISE', customerId: dongVan.id,
      expectedDeliveryDate: '2026-08-17',
      pickupLocation: 'Cảng Nam Hải Đình Vũ', deliveryLocation: 'KCN Đồng Văn, Hà Nam',
      contactName: 'Trần Văn Đồng', contactPhone: '02213876543',
            containers: [
        { containerNumber: 'HLXU6109346', sealNumber: 'SL7219084', cargoWeightKg: 18900 },
      ],
    },
    {
      tradeDirection: 'IMPORT', ref: '105254549001', routeName: 'NEWEB', customerId: bienBac.id,
      expectedDeliveryDate: '2026-08-13',
      pickupLocation: 'Cảng Hải Phòng', deliveryLocation: 'Kho Biển Bạc, Bắc Ninh',
      contactName: 'Phạm Thị Biển', contactPhone: '02253555555',
            containers: [
        { containerNumber: 'TCLU5830190', sealNumber: 'SL7104562', cargoWeightKg: 19700 },
        { containerNumber: 'MEDU7120398', sealNumber: 'SL7104563', cargoWeightKg: 18300 },
      ],
      declaration: { declarationNumber: '102250312456', scope: 'SINGLE', note: 'Tờ khai nhập khẩu riêng' },
    },
    {
      tradeDirection: 'IMPORT', ref: '105254549088', routeName: 'NEWEB', customerId: haNoi.id,
      expectedDeliveryDate: '2026-08-02',
      pickupLocation: 'Cảng Đình Vũ', deliveryLocation: 'ICD Mỹ Đình, Hà Nội',
      contactName: 'Trịnh Văn Hà', contactPhone: '02438888888',
            containers: [
        { containerNumber: 'BEAU4281650', sealNumber: 'SL6955123', cargoWeightKg: 20800 },
      ],
      document: { type: 'BL', storageKey: 'uploads/seed/105254549088/bl.pdf' },
      declaration: { declarationNumber: '102250310877', scope: 'SINGLE', note: 'Đã thông quan' },
    },
    {
      tradeDirection: 'IMPORT', ref: '137465192255', routeName: 'SUNRISE', customerId: askey.id,
      expectedDeliveryDate: '2026-07-28',
      pickupLocation: 'TC - HICT', deliveryLocation: 'Kho ASKEY, Bắc Giang',
      contactName: 'Lý Thị Kiều', contactPhone: '0203333444',
            containers: [
        { containerNumber: 'FCIU9034568', sealNumber: 'SL6822940', cargoWeightKg: 17400 },
        { containerNumber: 'GPLU6781236', sealNumber: 'SL6822941', cargoWeightKg: 18100 },
      ],
    },
    {
      tradeDirection: 'IMPORT', ref: '105254550147', routeName: 'NEWEB', customerId: bienBac.id,
      expectedDeliveryDate: '2026-07-21',
      pickupLocation: 'Cảng Hải Phòng', deliveryLocation: 'Kho Biển Bạc, Bắc Ninh',
      contactName: 'Phạm Thị Biển', contactPhone: '02253555555',
            containers: [
        { containerNumber: 'OOLU8312661', sealNumber: 'SL6714408', cargoWeightKg: 17800 },
      ],
    },
    {
      tradeDirection: 'IMPORT', ref: '137465192801', customerId: vanTrung.id,
      expectedDeliveryDate: '2026-08-05',
      pickupLocation: 'Cảng Tân Vũ', deliveryLocation: 'KCN Vân Trung, Bắc Giang',
      contactName: 'Vũ Thị Vân', contactPhone: '02213654321',
      advanceTo: 'CANCELED',
    },
    // ── EXPORT — Booking refs, factory → port delivery ─────────────────────
    {
      tradeDirection: 'EXPORT', ref: 'DNKM13333', customerId: vanTrung.id,
      expectedDeliveryDate: '2026-08-21',
      pickupLocation: 'NEWEB-Kho 1', deliveryLocation: 'TC - HICT',
      contactName: 'Vũ Thị Vân', contactPhone: '02213654321',
      closingAt: '2026-08-20T08:00:00.000Z',
    },
    {
      tradeDirection: 'EXPORT', ref: 'DNKM13334', customerId: dongVan.id,
      // No dates → PENDING_DATE (booking awaiting closing schedule).
      pickupLocation: 'Xưởng SUNRISE', deliveryLocation: 'TC - HICT',
      contactName: 'Trần Văn Đồng', contactPhone: '02213876543',
    },
    {
      tradeDirection: 'EXPORT', ref: 'DNKM13335', routeName: 'ASKEY', customerId: askey.id,
      expectedDeliveryDate: '2026-08-18',
      pickupLocation: 'Kho ASKEY', deliveryLocation: 'Cảng Hải Phòng',
      contactName: 'Lý Thị Kiều', contactPhone: '0203333444',
      closingAt: '2026-08-17T16:00:00.000Z',
            containers: [
        { containerNumber: 'MSBU1245654', sealNumber: 'SL8512340', cargoWeightKg: 20500 },
      ],
    },
    {
      tradeDirection: 'EXPORT', ref: 'DNKM13336', routeName: 'NEWEB', customerId: bienBac.id,
      expectedDeliveryDate: '2026-08-16',
      pickupLocation: 'NEWEB-Kho 1', deliveryLocation: 'Cảng Đình Vũ',
      contactName: 'Phạm Thị Biển', contactPhone: '02253555555',
      closingAt: '2026-08-15T08:00:00.000Z',
            containers: [
        { containerNumber: 'MSDU1245780', sealNumber: 'SL8509912', cargoWeightKg: 19800 },
        { containerNumber: 'TGBU3190086', sealNumber: 'SL8509913', cargoWeightKg: 21100 },
      ],
    },
    {
      tradeDirection: 'EXPORT', ref: 'DNKM13337', customerId: haNoi.id,
      expectedDeliveryDate: '2026-08-12',
      pickupLocation: 'Kho Biển Bạc', deliveryLocation: 'TC - HICT',
      contactName: 'Trịnh Văn Hà', contactPhone: '02438888888',
      closingAt: '2026-08-11T08:00:00.000Z',
      advanceTo: 'IN_TRANSIT',
      containers: [
        { containerNumber: 'MAGU2468720', sealNumber: 'SL8371065', cargoWeightKg: 19300 },
      ],
      declaration: { declarationNumber: '102250318903', scope: 'SHARED', note: 'Tờ khai gộp 2 lô' },
    },
    {
      tradeDirection: 'EXPORT', ref: 'DNKM13338', routeName: 'ASKEY', customerId: askey.id,
      expectedDeliveryDate: '2026-07-26',
      pickupLocation: 'Kho ASKEY', deliveryLocation: 'Cảng Hải Phòng',
      contactName: 'Lý Thị Kiều', contactPhone: '0203333444',
      closingAt: '2026-07-25T08:00:00.000Z',
            containers: [
        { containerNumber: 'TRHU4510296', sealNumber: 'SL6782043', cargoWeightKg: 18700 },
      ],
      document: { type: 'BOOKING', storageKey: 'uploads/seed/DNKM13338/booking.pdf' },
    },
    {
      tradeDirection: 'EXPORT', ref: 'DNKM13339', customerId: dongVan.id,
      expectedDeliveryDate: '2026-08-08',
      pickupLocation: 'Xưởng SUNRISE', deliveryLocation: 'Cảng Nam Hải Đình Vũ',
      contactName: 'Trần Văn Đồng', contactPhone: '02213876543',
      closingAt: '2026-08-07T08:00:00.000Z',
      advanceTo: 'CANCELED',
    },
    // ── SILVER L1 per-container factory authority ────────────────────────────
    // One Booking, two containers at the same factory on two appointment
    // days: the per-container scenario every Phase-2+ surface must keep
    // whole. (Same factory because Biển Bạc seeds exactly one FACTORY site.)
    {
      tradeDirection: 'EXPORT', ref: 'DNKM13340', customerId: bienBac.id,
      expectedDeliveryDate: '2026-08-24',
      pickupLocation: 'BB Long Biên', deliveryLocation: 'TC - HICT',
      contactName: 'Phạm Thị Biển', contactPhone: '02253555555',
      closingAt: '2026-08-23T08:00:00.000Z',
      containers: [
        { containerNumber: 'BBHU2001012', sealNumber: 'SL8600101', cargoWeightKg: 18200, factoryCode: 'BB-KHO-LONG-BIEN', appointmentAt: '2026-08-24T04:00:00.000Z' },
        { containerNumber: 'BBHU2001028', sealNumber: 'SL8600102', cargoWeightKg: 17600, factoryCode: 'BB-KHO-LONG-BIEN', appointmentAt: '2026-08-25T04:00:00.000Z' },
      ],
    },
    // ── Customer-portal demo rows (samsung-cs, canon-cs) ────────────────────
    // One IMPORT shipment per customer is enough to let /portal/shipments
    // render a non-empty list and let TC-CUST-SHIP-03 (no-leak) navigate
    // from samsung-cs to canon-cs's shipment ID and assert 404.
    {
      tradeDirection: 'IMPORT', ref: '105254551001', customerId: samsung.id,
      expectedDeliveryDate: '2026-08-22',
      pickupLocation: 'Cảng Hải Phòng', deliveryLocation: 'KCN Yên Phong, Bắc Ninh',
      contactName: 'Trần Minh Đức', contactPhone: '02253991111',
    },
    {
      tradeDirection: 'IMPORT', ref: '105254551002', customerId: canon.id,
      expectedDeliveryDate: '2026-08-25',
      pickupLocation: 'Cảng Đình Vũ', deliveryLocation: 'KCN Thăng Long, Hà Nội',
      contactName: 'Lê Thị Hương', contactPhone: '02253992222',
    },
  ];

  let createdCount = 0;
  for (const s of shipmentSeeds) {
    // Idempotency: skip if a shipment with this document ref already exists.
    // The one-ref invariant stores it in exactly one of the two columns.
    const refColumn = s.tradeDirection === 'IMPORT' ? schema.shipments.blNumber : schema.shipments.bookingRef;
    const [existing] = await db.select({ id: schema.shipments.id })
      .from(schema.shipments)
      .where(eq(refColumn, s.ref))
      .limit(1);
    if (existing) {
      continue; // Already seeded — leave its status + children alone.
    }

    // Use createShipment so the row gets the canonical shipmentCode + an
    // initial status-history row, matching the production path.
    const routeId = s.routeName === 'NEWEB' ? ROUTE_NEWEB
      : s.routeName === 'ASKEY' ? ROUTE_ASKEY
      : s.routeName === 'SUNRISE' ? ROUTE_SUNRISE
      : null;
    const shipment = await createShipment({
      customerId: s.customerId,
      tradeDirection: s.tradeDirection,
      cargoMode: 'FCL',
      routeId,
      blNumber: s.tradeDirection === 'IMPORT' ? s.ref : undefined,
      bookingRef: s.tradeDirection === 'EXPORT' ? s.ref : undefined,
      expectedDeliveryDate: s.expectedDeliveryDate,
      pickupLocation: s.pickupLocation,
      deliveryLocation: s.deliveryLocation,
      contactName: s.contactName,
      contactPhone: s.contactPhone,
      closingAt: s.closingAt,
    });

    // Children + status transitions attach ONLY on first creation, walking
    // the legal ladder edge by edge.
    if (s.containers && s.containers.length > 0) {
      // Dispatch readiness (assertIntakeReady) requires every container to
      // carry type + both ports. IMPORT: lift at the sea port, drop at the
      // inland site; EXPORT is the mirror.
      const [pickupPortId, dropoffPortId] = s.tradeDirection === 'IMPORT'
        ? [PORT_HAI_PHONG, PORT_DINH_VU]
        : [PORT_DINH_VU, PORT_LACH_HUYEN];
      // Per-container factory authority resolves by code within the shipment's
      // customer; a missing/invalid code leaves authority null (legacy row).
      const factorySiteIds = new Map<string, number>();
      if (s.containers.some((c) => c.factoryCode)) {
        const siteRows = await db.select({ id: schema.operationalSites.id, code: schema.operationalSites.code })
          .from(schema.operationalSites)
          .where(and(
            eq(schema.operationalSites.customerId, s.customerId),
            eq(schema.operationalSites.siteType, 'FACTORY'),
          ));
        for (const row of siteRows) factorySiteIds.set(row.code, row.id);
      }
      await batchUpsertShipmentContainers(shipment.id, null, s.containers.map((c) => ({
        containerNumber: c.containerNumber,
        sealNumber: c.sealNumber,
        cargoWeightKg: c.cargoWeightKg,
        containerTypeId: c.containerNumber.startsWith('MS') || c.containerNumber.startsWith('TG')
          ? CONTAINER_TYPE_40HC
          : CONTAINER_TYPE_40DC,
        shippingLineName: s.tradeDirection === 'IMPORT' ? 'MSC' : 'ONE',
        // FCL dispatch reads the route off the CONTAINER, so the shipment's
        // route must be stamped onto every container or the dispatch order
        // rejects it ("Container chưa có tuyến đường hợp lệ").
        routeId,
        pickupPortId,
        dropoffPortId,
        operationalSiteId: c.factoryCode ? factorySiteIds.get(c.factoryCode) ?? null : null,
        customerAppointmentAt: c.appointmentAt ?? null,
      })));
    }
    if (s.document) {
      await attachShipmentDocument(shipment.id, {
        type: s.document.type,
        storageKey: s.document.storageKey,
      });
    }
    if (s.declaration) {
      await db.insert(schema.shipmentDeclarations).values({
        shipmentId: shipment.id,
        declarationNumber: s.declaration.declarationNumber,
        scope: s.declaration.scope,
        note: s.declaration.note,
      });
    }
    if (s.advanceTo) {
      const ladder: Record<NonNullable<ShipmentSeed['advanceTo']>, readonly string[]> = {
        DISPATCHED: ['DISPATCHED'],
        IN_TRANSIT: ['DISPATCHED', 'IN_TRANSIT'],
        COMPLETED: ['DISPATCHED', 'IN_TRANSIT', 'COMPLETED'],
        CANCELED: ['CANCELED'],
      };
      const reasons: Record<string, string> = {
        DISPATCHED: 'Điều vận',
        IN_TRANSIT: 'Đang vận chuyển',
        COMPLETED: 'Hoàn tất duyệt chi phí',
        CANCELED: 'Khách hủy lô hàng',
      };
      for (const next of ladder[s.advanceTo]) {
        await transitionShipmentStatus(
          shipment.id,
          next as Parameters<typeof transitionShipmentStatus>[1],
          { reason: `${reasons[next]} (seed)` },
        );
      }
    }
    createdCount++;
  }
  console.log(`  ✅ Sample shipments (${createdCount} new; ${shipmentSeeds.length - createdCount} already existed)`);
  console.log('✅ Wave 0 shipment seed complete!');
}

// CLI entry point — only auto-run when invoked directly via `pnpm seed`
// (npx tsx src/seed.ts). The guard lets tests import { seedShipments } from
// '../seed' without triggering the full seed flow + process.exit at module
// load.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  seed()
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
