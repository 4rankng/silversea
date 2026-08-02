import bcrypt from 'bcryptjs';
import { db } from './db';
import * as schema from './db/schema';
import {
  DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
  FORWARDER_EXPENSE_TYPE_DEFAULTS,
  NO_INVOICE_POLICY_DEFAULTS,
  Role,
} from '@tingting/shared';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { COMPANY_INFO_SETTING_KEYS, COMPANY_INFO_DEFAULTS } from './services/company-info.service';
import {
  createShipment,
  transitionShipmentStatus,
  batchUpsertShipmentContainers,
  attachShipmentDocument,
} from './services/shipment.service';
import { seedCustomers } from './seed/seed-customers';
import { seedReference } from './seed/seed-reference';

async function seed() {
  const passwordHash = await bcrypt.hash('Abc123', 10);

  const users = [
    { username: 'admin', email: 'admin@nepo.vn', phone: '0900000000', passwordHash, role: Role.ADMIN, fullName: 'Trần Văn Admin' },
    { username: 'giamdoc', email: 'giamdoc@nepo.vn', phone: '0900000001', passwordHash, role: Role.MANAGER, fullName: 'Lê Văn Tỉnh' },
    { username: 'ketoan', email: 'ketoan@nepo.vn', phone: '0900000002', passwordHash, role: Role.ACCOUNTANT, fullName: 'Nguyễn Thị Mai' },
    { username: 'cus', email: 'cus@nepo.vn', phone: '0900000005', passwordHash, role: Role.CLERK, fullName: 'Nhân viên CUS Demo' },
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
    console.log(`  ${u.username} / Abc123 (${u.role})`);
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
  for (const [code, meta] of Object.entries(FORWARDER_EXPENSE_TYPE_DEFAULTS)) {
    const substituteEvidenceAllowed = defaultNoInvoiceCodes.has(code);
    await db.insert(schema.forwarderExpenseTypes)
      .values({
        code,
        name: meta.name,
        requiresInvoice: false,
        substituteEvidenceAllowed,
        noInvoiceEvidenceTypes: substituteEvidenceAllowed ? [...DEFAULT_NO_INVOICE_EVIDENCE_TYPES] : [],
        noInvoicePerItemLimit: String(NO_INVOICE_POLICY_DEFAULTS.perItemLimit),
        noInvoicePerDayLimit: String(NO_INVOICE_POLICY_DEFAULTS.perDayLimit),
        noInvoiceFinanceLeadItemApprovalLimit: String(NO_INVOICE_POLICY_DEFAULTS.financeLeadItemApprovalLimit),
        noInvoiceDirectorDayApprovalLimit: String(NO_INVOICE_POLICY_DEFAULTS.directorDayApprovalLimit),
        noInvoicePolicyVersion: 1,
        defaultMarkup: meta.defaultMarkup,
        billingLabel: meta.billingLabel,
        vatRate: '0.080',
      })
      .onConflictDoUpdate({
        target: schema.forwarderExpenseTypes.code,
        set: {
          name: meta.name,
          requiresInvoice: false,
          substituteEvidenceAllowed,
          noInvoiceEvidenceTypes: substituteEvidenceAllowed ? [...DEFAULT_NO_INVOICE_EVIDENCE_TYPES] : [],
          noInvoicePerItemLimit: String(NO_INVOICE_POLICY_DEFAULTS.perItemLimit),
          noInvoicePerDayLimit: String(NO_INVOICE_POLICY_DEFAULTS.perDayLimit),
          noInvoiceFinanceLeadItemApprovalLimit: String(NO_INVOICE_POLICY_DEFAULTS.financeLeadItemApprovalLimit),
          noInvoiceDirectorDayApprovalLimit: String(NO_INVOICE_POLICY_DEFAULTS.directorDayApprovalLimit),
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

  // Install the customer-owned operational master data and the Long Minh
  // Debit Note authority as part of every supported setup/seed path. These
  // seeders are idempotent and deliberately run after generic defaults so the
  // approved Silver Sea identity is the final configured export identity.
  await seedReference();
  await seedCustomers();
  await seedShipments(passwordHash);
  await seedClerkScope();

  process.exit(0);
}

async function seedClerkScope(): Promise<void> {
  const [clerk] = await db.select({ id: schema.users.id }).from(schema.users)
    .where(and(eq(schema.users.username, 'cus'), eq(schema.users.role, Role.CLERK), isNull(schema.users.deletedAt)))
    .limit(1);
  if (!clerk) throw new Error('Không tìm thấy tài khoản CUS demo sau khi seed');

  const [unit] = await db.insert(schema.businessUnits).values({
    code: 'CUS-DEMO',
    name: 'Đơn vị CUS Demo',
    status: 'ACTIVE',
  }).onConflictDoUpdate({
    target: schema.businessUnits.code,
    set: { name: 'Đơn vị CUS Demo', status: 'ACTIVE', updatedAt: new Date() },
  }).returning({ id: schema.businessUnits.id });

  await db.insert(schema.userBusinessUnitLinks).values({
    userId: clerk.id,
    businessUnitId: unit.id,
  }).onConflictDoNothing({
    target: [schema.userBusinessUnitLinks.userId, schema.userBusinessUnitLinks.businessUnitId],
  });

  await db.update(schema.shipments)
    .set({ responsibleUnitId: unit.id, updatedAt: new Date() })
    .where(sql`${schema.shipments.bookingRef} in ('SEED-SHIP-1', 'SEED-SHIP-2', 'SEED-SHIP-3')`);

  const scopedCustomers = await db.select({ id: schema.customers.id }).from(schema.customers)
    .where(and(isNull(schema.customers.deletedAt), sql`${schema.customers.taxCode} in ('0101234567', '0107654321')`));
  for (const customer of scopedCustomers) {
    await db.insert(schema.userCustomerLinks).values({
      userId: clerk.id,
      customerId: customer.id,
    }).onConflictDoNothing({
      target: [schema.userCustomerLinks.userId, schema.userCustomerLinks.customerId],
    });
  }

  if (scopedCustomers[0]) {
    await db.update(schema.users).set({ customerId: scopedCustomers[0].id }).where(eq(schema.users.id, clerk.id));
  }
  console.log(`✅ CUS demo scope seeded! (${scopedCustomers.length} customers, 1 business unit)`);
}

// ─── Wave 0: shipments + CUSTOMER demo user ──────────────────────────────────
//
// Seeds a CUSTOMER-role demo login + sample shipments in mixed statuses so
// the Wave 0 ShipmentsPage has something to render during QA and the
// eventual Wave 2 customer portal has a login to test against.
//
// Idempotency contract:
//   - CUSTOMER user:               onConflictDoNothing on unique username.
//   - Sample customers:            existence check by stable taxCode.
//   - Sample shipments:            existence check by stable bookingRef
//                                  sentinel (SEED-SHIP-1/2/3) BEFORE calling
//                                  createShipment (which would otherwise
//                                  generate a new shipmentCode + row each
//                                  invocation).
//   - Status transitions + children: only attached when the shipment is
//                                  first created (gated by the same
//                                  existence check).
//
// Exported so the test in tests/seed-shipments.test.ts can exercise it
// directly without re-running the full `pnpm seed` flow.
export async function seedShipments(passwordHash: string) {
  console.log('\n📦 Seeding Wave 0 shipments + CUSTOMER demo user...');

  // 1. CUSTOMER demo user — username `customer` / admin123.
  //    onConflictDoUpdate on the username target so a re-run after a manual
  //    edit restores the canonical password + role (QA login guarantee).
  //    The app-level row-scope helper reads `users.customerId` from the JWT,
  //    so after the sample customers are upserted below we link this login to
  //    the first stable sample customer for portal QA.
  await db.insert(schema.users).values({
    username: 'customer',
    email: 'customer@nepo.vn',
    phone: '0900000020',
    passwordHash,
    role: Role.CUSTOMER,
    fullName: 'Khách hàng Demo',
  }).onConflictDoUpdate({
    target: schema.users.username,
    set: { passwordHash, role: Role.CUSTOMER, email: 'customer@nepo.vn', phone: '0900000020', fullName: 'Khách hàng Demo' },
  });
  console.log('  ✅ CUSTOMER demo user (customer / Abc123)');

  // 2. Two sample customers (operator-side AR customers — distinct from the
  //    CUSTOMER demo user above). Stable tax codes make the seed idempotent.
  //    The lookup uses the SAME expression as the partial unique index
  //    `customers_active_tax_code_uniq_idx` (lower(btrim(taxCode)) WHERE
  //    deletedAt IS NULL AND taxCode <> '') so case/whitespace variants
  //    resolve to the same row.
  const sampleCustomerSeeds = [
    { name: 'Công ty CP Vận tải Biển Bạc', taxCode: '0101234567', contactPerson: 'Phạm Thị Biển', phone: '02253555555' },
    { name: 'Công ty TNHH XNK Hà Nội', taxCode: '0107654321', contactPerson: 'Trịnh Văn Hà', phone: '02438888888' },
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
    const [created] = await db.insert(schema.customers).values(c).returning({ id: schema.customers.id, name: schema.customers.name });
    sampleCustomers.push(created);
  }
  console.log(`  ✅ Sample customers (${sampleCustomers.length} stable rows)`);

  // 2b. Link the CUSTOMER demo login to the first sample customer so the
  // customer portal can row-scope to real shipments during local QA.
  const [portalCustomer] = sampleCustomers;
  await db.update(schema.users)
    .set({ customerId: portalCustomer.id })
    .where(eq(schema.users.username, 'customer'));

  // 3. Sample shipments — three across DRAFT / IN_PROGRESS / DELIVERED.
  //    Sentinels via bookingRef so re-runs do NOT call createShipment twice.
  type ShipmentSeed = {
    sentinel: string; // bookingRef sentinel — must be unique + stable
    customerId: number;
    blNumber: string;
    expectedDeliveryDate: string;
    pickupLocation: string;
    deliveryLocation: string;
    contactName: string;
    contactPhone: string;
    advanceTo?: 'IN_PROGRESS' | 'DELIVERED';
    containers?: Array<{ containerNumber: string; sealNumber: string; cargoWeightKg: number }>;
    document?: { type: 'BOOKING' | 'BL' | 'DO' | 'DECLARATION' | 'OTHER'; storageKey: string };
    declaration?: { declarationNumber: string; scope: 'SINGLE' | 'SHARED'; note: string };
  };

  const [bienBac, haNoi] = sampleCustomers;
  const shipmentSeeds: ShipmentSeed[] = [
    {
      sentinel: 'SEED-SHIP-1',
      customerId: bienBac.id,
      blNumber: 'BL-SEED-001',
      expectedDeliveryDate: '2026-08-15',
      pickupLocation: 'Cảng Hải Phòng',
      deliveryLocation: 'Kho Biển Bạc',
      contactName: 'Phạm Thị Biển',
      contactPhone: '02253555555',
      // Stays in DRAFT — represents a freshly-created booking not yet dispatched.
    },
    {
      sentinel: 'SEED-SHIP-2',
      customerId: haNoi.id,
      blNumber: 'BL-SEED-002',
      expectedDeliveryDate: '2026-08-10',
      pickupLocation: 'Cảng Hải Phòng',
      deliveryLocation: 'ICD Hà Nội',
      contactName: 'Trịnh Văn Hà',
      contactPhone: '02438888888',
      advanceTo: 'IN_PROGRESS',
      containers: [
        { containerNumber: 'MSKU1234565', sealNumber: 'SEED-SEAL-001', cargoWeightKg: 18500 },
        { containerNumber: 'TCNU7425363', sealNumber: 'SEED-SEAL-002', cargoWeightKg: 19200 },
      ],
    },
    {
      sentinel: 'SEED-SHIP-3',
      customerId: bienBac.id,
      blNumber: 'BL-SEED-003',
      expectedDeliveryDate: '2026-07-30',
      pickupLocation: 'Cảng Đà Nẵng',
      deliveryLocation: 'Kho Biển Bạc',
      contactName: 'Phạm Thị Biển',
      contactPhone: '02253555555',
      advanceTo: 'DELIVERED',
      containers: [
        { containerNumber: 'OOLU8312661', sealNumber: 'SEED-SEAL-003', cargoWeightKg: 17800 },
      ],
      document: { type: 'BL', storageKey: 'uploads/seed/SEED-SHIP-3/bl.pdf' },
      declaration: { declarationNumber: 'SEED-DECL-003', scope: 'SINGLE', note: 'Tờ khai mẫu (seed)' },
    },
  ];

  let createdCount = 0;
  for (const s of shipmentSeeds) {
    // Idempotency: skip if a shipment with this sentinel bookingRef already
    // exists. createShipment would otherwise mint a new shipmentCode each call.
    const [existing] = await db.select({ id: schema.shipments.id })
      .from(schema.shipments)
      .where(eq(schema.shipments.bookingRef, s.sentinel))
      .limit(1);
    if (existing) {
      continue; // Already seeded — leave its status + children alone.
    }

    // Use createShipment so the row gets the canonical shipmentCode + an
    // initial DRAFT history row, matching the production path.
    const shipment = await createShipment({
      customerId: s.customerId,
      bookingRef: s.sentinel,
      blNumber: s.blNumber,
      expectedDeliveryDate: s.expectedDeliveryDate,
      pickupLocation: s.pickupLocation,
      deliveryLocation: s.deliveryLocation,
      contactName: s.contactName,
      contactPhone: s.contactPhone,
    });

    // Children + status transition attach ONLY on first creation.
    if (s.containers && s.containers.length > 0) {
      await batchUpsertShipmentContainers(shipment.id, null, s.containers.map((c) => ({
        containerNumber: c.containerNumber,
        sealNumber: c.sealNumber,
        cargoWeightKg: c.cargoWeightKg,
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
    if (s.advanceTo === 'IN_PROGRESS') {
      await transitionShipmentStatus(shipment.id, 'IN_PROGRESS', { reason: 'Điều vận (seed)' });
    } else if (s.advanceTo === 'DELIVERED') {
      // Two legal edges required: DRAFT → IN_PROGRESS → DELIVERED.
      await transitionShipmentStatus(shipment.id, 'IN_PROGRESS', { reason: 'Điều vận (seed)' });
      await transitionShipmentStatus(shipment.id, 'DELIVERED', { reason: 'Giao hàng (seed)' });
    }
    createdCount++;
  }
  console.log(`  ✅ Sample shipments (${createdCount} new; ${shipmentSeeds.length - createdCount} already existed)`);
  console.log('✅ Wave 0 shipment seed complete!');
}

// CLI entry point — only auto-run when invoked directly via `pnpm seed`
// (npx tsx src/seed.ts). The guard lets tests import { seedShipments } from
// '../seed' without triggering the full seed flow + process.exit at module
// load. Mirrors the pattern in services/agent/retention-job.ts.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  seed().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
