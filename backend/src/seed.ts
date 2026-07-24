import bcrypt from 'bcryptjs';
import { db } from './db';
import * as schema from './db/schema';
import { Role, FORWARDER_EXPENSE_TYPE_DEFAULTS } from '@tingting/shared';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { COMPANY_INFO_SETTING_KEYS, COMPANY_INFO_DEFAULTS } from './services/company-info.service';

async function seed() {
  const passwordHash = await bcrypt.hash('admin123', 10);

  const users = [
    { username: 'admin', email: 'admin@nepo.vn', phone: '0900000000', passwordHash, role: Role.ADMIN, fullName: 'Trần Văn Admin' },
    { username: 'giamdoc', email: 'giamdoc@nepo.vn', phone: '0900000001', passwordHash, role: Role.MANAGER, fullName: 'Lê Văn Tỉnh' },
    { username: 'ketoan', email: 'ketoan@nepo.vn', phone: '0900000002', passwordHash, role: Role.ACCOUNTANT, fullName: 'Nguyễn Thị Mai' },
    { username: 'laixe', email: 'laixe@nepo.vn', phone: '0900000003', passwordHash, role: Role.DRIVER, fullName: 'Phạm Văn Hùng' },
    { username: 'giaonhan', email: 'giaonhan@nepo.vn', phone: '0900000004', passwordHash, role: Role.FORWARDER, fullName: 'Nguyễn Văn Giao' },
    { username: 'thu', email: 'thu@nepo.vn', phone: '0900000010', passwordHash, role: Role.DRIVER, fullName: 'Nguyễn Văn Thụ' },
    { username: 'pho', email: 'pho@nepo.vn', phone: '0900000011', passwordHash, role: Role.DRIVER, fullName: 'Nguyễn Văn Phố' },
    { username: 'quyet', email: 'quyet@nepo.vn', phone: '0900000012', passwordHash, role: Role.DRIVER, fullName: 'Lê Văn Quyết' },
  ];

  for (const user of users) {
    await db.insert(schema.users).values(user).onConflictDoNothing();
  }

  console.log('✅ Users seeded!');
  for (const u of users) {
    console.log(`  ${u.username} / admin123 (${u.role})`);
  }

  // ─── Drivers — linked to user accounts via user_id ─────────────────────
  // The driver portal (/my-trips, /my-earnings, etc.) relies on
  // drivers.user_id pointing to users.id. Without this link, getDriverByUserId()
  // throws NoDriverProfileError (404) and the portal is unusable.
  //
  // Look up user IDs by email since onConflictDoNothing() may have no-oped.
  const userAccounts = await db.select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(isNull(schema.users.deletedAt));
  const userByEmail = new Map(userAccounts.map(u => [u.email, u.id]));

  const driverSeeds = [
    { userId: userByEmail.get('laixe@nepo.vn') ?? null, name: 'Phạm Văn Hùng',  phone: '0900000003', baseSalary: '5000000', status: 'ACTIVE' as const },
    { userId: userByEmail.get('thu@nepo.vn') ?? null,   name: 'Nguyễn Văn Thụ', phone: '0900000010', baseSalary: '4500000', status: 'ACTIVE' as const },
    { userId: userByEmail.get('quyet@nepo.vn') ?? null, name: 'Lê Văn Quyết',   phone: '0900000012', baseSalary: '4500000', status: 'ACTIVE' as const },
    { userId: userByEmail.get('pho@nepo.vn') ?? null,   name: 'Nguyễn Văn Phố', phone: '0900000011', baseSalary: '5000000', status: 'ACTIVE' as const },
  ];

  // Use onConflictDoNothing with a unique constraint on (name) if it exists,
  // otherwise check by name before inserting to stay idempotent.
  const existingDrivers = await db.select({ name: schema.drivers.name })
    .from(schema.drivers);
  const existingDriverNames = new Set(existingDrivers.map(d => d.name));

  let driverCount = 0;
  for (const driver of driverSeeds) {
    if (existingDriverNames.has(driver.name)) continue;
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

  let linkedCount = 0;
  for (const u of driverUsers) {
    if (!u.phone) continue;
    const updated = await db.update(schema.drivers)
      .set({ userId: u.id })
      .where(and(
        eq(schema.drivers.phone, u.phone),
        isNull(schema.drivers.userId),
        isNull(schema.drivers.deletedAt),
      ))
      .returning({ id: schema.drivers.id });
    linkedCount += updated.length;
  }
  if (linkedCount > 0) {
    console.log(`✅ Drivers linked to user accounts! (${linkedCount} linked by phone)`);
  } else {
    console.log('✅ Driver↔user links already in place.');
  }

  const supplierSeeds = [
    { name: 'Petrolimex', contactPerson: 'Nguyễn Văn Hải', phone: '0901234567', taxCode: '0100100746', note: 'Nhà cung cấp xăng dầu chính', isFuelSupplier: true },
    { name: 'PV Oil', contactPerson: 'Trần Thị Thảo', phone: '0907654321', taxCode: '0102716892', note: 'Nhà cung cấp xăng dầu dự phòng', isFuelSupplier: true },
    { name: 'Gara Thành Đông', contactPerson: 'Lê Văn Đông', phone: '0912345678', taxCode: '0304567890', note: 'Xưởng sửa chữa xe chính', isFuelSupplier: false },
    { name: 'Trạm Đăng kiểm 15-01S', contactPerson: 'Nguyễn Văn Đăng', phone: '02253888888', taxCode: '0304123456', note: 'Trung tâm đăng kiểm Hải Phòng', isFuelSupplier: false },
    { name: 'Bảo hiểm Bảo Việt', contactPerson: 'Phạm Minh Việt', phone: '1900558899', taxCode: '0100111307', note: 'Công ty bảo hiểm', isFuelSupplier: false },
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

  for (const truck of trucks) {
    await db.insert(schema.trucks).values(truck).onConflictDoNothing();
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
      await db.update(schema.drivers).set({ assignedTruckId }).where(eq(schema.drivers.name, name));
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
      note: `Backfill: chi phí #${exp.id}`,
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
  if (newCtTypes.length > 0) {
    for (const ct of newCtTypes) {
      await db.insert(schema.containerTypes).values(ct).onConflictDoNothing();
    }
    console.log(`✅ Container types seeded! (${newCtTypes.length} new)`);
  } else {
    console.log('✅ Container types already exist, skipping.');
  }

  // ─── Hai Phong ports/yards (Pete's request) ────────────────────────────────
  // Starter set of common ICDs and terminals in the Hai Phong area.
  const portSeeds = [
    { name: 'Cảng Hải Phòng',                    code: 'HPH',  city: 'Hải Phòng', address: 'Quận Hồng Bàng, Hải Phòng' },
    { name: 'Cảng Đình Vũ',                      code: 'DVU',  city: 'Hải Phòng', address: 'Đông Hải 2, Hải An, Hải Phòng' },
    { name: 'Cảng Lạch Huyện (HICT)',            code: 'HICT', city: 'Hải Phòng', address: 'Cát Hải, Hải Phòng' },
    { name: 'Cảng Tân Cảng 128 Hải Phòng',       code: 'TC128', city: 'Hải Phòng', address: 'Hùng Vương, Hồng Bàng, Hải Phòng' },
    { name: 'Cảng Tân Vũ',                       code: 'TVU',  city: 'Hải Phòng', address: 'Đông Hải 2, Hải An, Hải Phòng' },
    { name: 'Cảng Nam Hải Đình Vũ',              code: 'NHDV', city: 'Hải Phòng', address: 'Đông Hải 2, Hải An, Hải Phòng' },
    { name: 'Cảng VIP Greenport',                code: 'VIPG', city: 'Hải Phòng', address: 'Đông Hải 2, Hải An, Hải Phòng' },
    { name: 'ICD Hoàng Thành',                   code: 'HTHA', city: 'Hải Phòng', address: 'An Dương, Hải Phòng' },
  ];
  const existingPorts = await db.select({ code: schema.ports.code })
    .from(schema.ports);
  const existingPortCodes = new Set(existingPorts.map(p => p.code));
  const newPorts = portSeeds.filter(p => !existingPortCodes.has(p.code));
  if (newPorts.length > 0) {
    for (const p of newPorts) {
      await db.insert(schema.ports).values(p).onConflictDoNothing();
    }
    console.log(`✅ Hai Phong ports/yards seeded! (${newPorts.length} new)`);
  } else {
    console.log('✅ Ports already exist, skipping.');
  }

  // ─── Forwarder expense types (user-configurable) ─────────────────────────
  // Upsert all 8 fee types with defaultMarkup, billingLabel, vatRate so that
  // re-running seed is safe and always brings the table up to date.
  let fetUpsertCount = 0;
  for (const [code, meta] of Object.entries(FORWARDER_EXPENSE_TYPE_DEFAULTS)) {
    await db.insert(schema.forwarderExpenseTypes)
      .values({
        code,
        name: meta.name,
        defaultMarkup: meta.defaultMarkup,
        billingLabel: meta.billingLabel,
        vatRate: '0.080',
      })
      .onConflictDoUpdate({
        target: schema.forwarderExpenseTypes.code,
        set: {
          name: meta.name,
          defaultMarkup: meta.defaultMarkup,
          billingLabel: meta.billingLabel,
          vatRate: '0.080',
          updatedAt: new Date(),
        },
      });
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

  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
