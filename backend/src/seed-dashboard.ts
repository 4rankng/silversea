/**
 * Seed dashboard data — populates everything the dashboard needs to show
 * meaningful KPIs, charts, and attention-panel alerts.
 *
 * Run: npx tsx src/seed-dashboard.ts
 *
 * Idempotent: uses ON CONFLICT DO NOTHING for reference data, and
 * checks before inserting trip/ledger rows.
 */
import { db } from './db';
import * as s from './db/schema';
import { sql, eq, isNull } from 'drizzle-orm';

// ─── Helpers ────────────────────────────────────────────────────────────────
function vnd(n: number): string {
  return String(Math.round(n));
}

function dateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ─── Config data ────────────────────────────────────────────────────────────

async function seedConfig() {
  console.log('\n📦 Seeding config tables...');

  // road_config (toll, bonuses)
  const existingRoadConfig = await db.select().from(s.roadConfig);
  if (existingRoadConfig.length === 0) {
    await db.insert(s.roadConfig).values({
      tollPerStation: '150000',
      returnCargoBonus: '500000',
      defaultDriverSalary: '400000',
      twoPointDeliveryBonus: '200000',
      vehicleShiftDefault: '200000',
    });
    console.log('  ✅ road_config seeded');
  } else {
    console.log('  ⏭️  road_config already exists');
  }

  // salary_periods — global default: 25th → 24th
  const existingSp = await db.select().from(s.salaryPeriods).where(eq(s.salaryPeriods.isDefault, true));
  if (existingSp.length === 0) {
    await db.insert(s.salaryPeriods).values({
      month: null,
      year: null,
      defaultStartDay: 25,
      defaultEndDay: 24,
      isDefault: true,
      label: 'Kỳ lương mặc định (25 → 24)',
    });
    console.log('  ✅ salary_periods default seeded (25→24)');
  } else {
    console.log('  ⏭️  salary_periods default exists');
  }

  // management_fees — Jan through June 2026
  const existingFees = await db.select().from(s.managementFees);
  const feeMonths: [number, number][] = [
    [1, 2026], [2, 2026], [3, 2026], [4, 2026], [5, 2026], [6, 2026],
  ];
  for (const [m, y] of feeMonths) {
    const exists = existingFees.some(f => f.month === m && f.year === y);
    if (!exists) {
      await db.insert(s.managementFees).values({
        month: m,
        year: y,
        amount: vnd(8_000_000), // 8M VND/month management fee
      });
    }
  }
  console.log('  ✅ management_fees seeded (Jan–Jun 2026)');
}

// ─── Trip data ──────────────────────────────────────────────────────────────

interface TripSeed {
  status: 'LOCKED' | 'COMPLETED' | 'IN_TRANSIT' | 'CREATED';
  departureDate: string;
  customerId: number;
  truckId: number;
  driverId: number;
  routeId: number;
  revenue: number;
  totalCost: number;
  driverSalary: number;
  totalFuelCost: number;
  totalRoadAllowance: number;
  fuelLiters: number;
  legs: { origin: string; destination: string; km: number; loadingType: 'HANG' | 'VO' }[];
}

// Realistic revenues based on existing trip data (7-20M VND per trip)
// Use existing customer/route/truck/driver IDs from the DB
const tripDefs: TripSeed[] = [
  // ─── June 2026 (current period: May 25 → Jun 24) ───────────────────────
  // 8 LOCKED trips for good KPI numbers
  {
    status: 'LOCKED', departureDate: '2026-06-01',
    customerId: 1, truckId: 1, driverId: 4, routeId: 1,
    revenue: 18_500_000, totalCost: 7_820_000, driverSalary: 850_000,
    totalFuelCost: 4_200_000, totalRoadAllowance: 2_770_000, fuelLiters: 152,
    legs: [
      { origin: 'ICD Hoàng Thành, Hải Phòng', destination: 'Vinatea Mộc Châu, Sơn La', km: 320, loadingType: 'HANG' },
    ],
  },
  {
    status: 'LOCKED', departureDate: '2026-06-02',
    customerId: 2, truckId: 2, driverId: 3, routeId: 2,
    revenue: 15_200_000, totalCost: 6_450_000, driverSalary: 750_000,
    totalFuelCost: 3_800_000, totalRoadAllowance: 1_900_000, fuelLiters: 138,
    legs: [
      { origin: 'Cảng Đình Vũ, Hải Phòng', destination: 'Trà Thu Đan, Thuận Châu, Sơn La', km: 380, loadingType: 'HANG' },
    ],
  },
  {
    status: 'LOCKED', departureDate: '2026-06-03',
    customerId: 4, truckId: 3, driverId: 2, routeId: 10,
    revenue: 8_400_000, totalCost: 3_100_000, driverSalary: 400_000,
    totalFuelCost: 1_800_000, totalRoadAllowance: 900_000, fuelLiters: 65,
    legs: [
      { origin: 'Cảng Đình Vũ, Hải Phòng', destination: 'KCN Quế Võ, Bắc Ninh', km: 130, loadingType: 'HANG' },
    ],
  },
  {
    status: 'LOCKED', departureDate: '2026-06-05',
    customerId: 3, truckId: 4, driverId: 1, routeId: 3,
    revenue: 14_800_000, totalCost: 6_900_000, driverSalary: 700_000,
    totalFuelCost: 3_900_000, totalRoadAllowance: 2_300_000, fuelLiters: 141,
    legs: [
      { origin: 'Cảng Hải Phòng', destination: 'Yên Sơn, Tuyên Quang', km: 300, loadingType: 'HANG' },
    ],
  },
  {
    status: 'LOCKED', departureDate: '2026-06-08',
    customerId: 6, truckId: 1, driverId: 4, routeId: 6,
    revenue: 16_200_000, totalCost: 7_100_000, driverSalary: 800_000,
    totalFuelCost: 3_600_000, totalRoadAllowance: 2_700_000, fuelLiters: 130,
    legs: [
      { origin: 'ICD Hoàng Thành, Hải Phòng', destination: 'HTX chè Nà Tân, Mộc Châu', km: 310, loadingType: 'HANG' },
    ],
  },
  {
    status: 'LOCKED', departureDate: '2026-06-10',
    customerId: 5, truckId: 2, driverId: 3, routeId: 4,
    revenue: 19_000_000, totalCost: 8_500_000, driverSalary: 900_000,
    totalFuelCost: 4_600_000, totalRoadAllowance: 3_000_000, fuelLiters: 166,
    legs: [
      { origin: 'Cảng Lạch Huyện, Hải Phòng', destination: 'Bản Bo, Lai Châu', km: 420, loadingType: 'HANG' },
    ],
  },
  {
    status: 'LOCKED', departureDate: '2026-06-12',
    customerId: 8, truckId: 3, driverId: 2, routeId: 8,
    revenue: 13_600_000, totalCost: 6_200_000, driverSalary: 750_000,
    totalFuelCost: 3_400_000, totalRoadAllowance: 2_050_000, fuelLiters: 123,
    legs: [
      { origin: 'Cảng Đình Vũ, Hải Phòng', destination: 'Phú Tài, Văn Chấn, Yên Bái', km: 290, loadingType: 'HANG' },
    ],
  },
  {
    status: 'LOCKED', departureDate: '2026-06-15',
    customerId: 1, truckId: 4, driverId: 1, routeId: 9,
    revenue: 10_200_000, totalCost: 4_400_000, driverSalary: 500_000,
    totalFuelCost: 2_600_000, totalRoadAllowance: 1_300_000, fuelLiters: 94,
    legs: [
      { origin: 'Cảng Hải Phòng', destination: 'Chè Ngọc Thanh, Phù Ninh, Phú Thọ', km: 200, loadingType: 'HANG' },
    ],
  },
  // Active status trips
  {
    status: 'IN_TRANSIT', departureDate: '2026-06-18',
    customerId: 7, truckId: 1, driverId: 4, routeId: 5,
    revenue: 17_500_000, totalCost: 7_600_000, driverSalary: 850_000,
    totalFuelCost: 4_100_000, totalRoadAllowance: 2_650_000, fuelLiters: 148,
    legs: [
      { origin: 'Cảng Hải Phòng', destination: 'HTX tea Tân Uyên, Lai Châu', km: 370, loadingType: 'HANG' },
    ],
  },
  {
    status: 'IN_TRANSIT', departureDate: '2026-06-19',
    customerId: 9, truckId: 2, driverId: 3, routeId: 7,
    revenue: 12_800_000, totalCost: 5_500_000, driverSalary: 600_000,
    totalFuelCost: 3_100_000, totalRoadAllowance: 1_800_000, fuelLiters: 112,
    legs: [
      { origin: 'ICD Hoàng Thành, Hải Phòng', destination: 'Chè Tân Lập, Mộc Châu', km: 280, loadingType: 'HANG' },
    ],
  },
  {
    status: 'COMPLETED', departureDate: '2026-06-17',
    customerId: 4, truckId: 3, driverId: 2, routeId: 10,
    revenue: 8_100_000, totalCost: 2_900_000, driverSalary: 400_000,
    totalFuelCost: 1_700_000, totalRoadAllowance: 800_000, fuelLiters: 61,
    legs: [
      { origin: 'Cảng Đình Vũ, Hải Phòng', destination: 'KCN Quế Võ, Bắc Ninh', km: 130, loadingType: 'HANG' },
    ],
  },
  {
    status: 'CREATED', departureDate: '2026-06-20',
    customerId: 3, truckId: 4, driverId: 1, routeId: 1,
    revenue: 0, totalCost: 0, driverSalary: 0,
    totalFuelCost: 0, totalRoadAllowance: 0, fuelLiters: 0,
    legs: [
      { origin: 'Cảng Hải Phòng', destination: 'Vinatea Mộc Châu, Sơn La', km: 320, loadingType: 'HANG' },
    ],
  },
  {
    status: 'CREATED', departureDate: '2026-06-21',
    customerId: 8, truckId: 1, driverId: 4, routeId: 11,
    revenue: 0, totalCost: 0, driverSalary: 0,
    totalFuelCost: 0, totalRoadAllowance: 0, fuelLiters: 0,
    legs: [
      { origin: 'ICD Hoàng Thành, Hải Phòng', destination: 'Zaitoon tea, Trạm Thản, Phú Thọ', km: 209, loadingType: 'HANG' },
    ],
  },

  // ─── May 2026 (period: Apr 25 → May 24) ──────────────────────────────
  ...generateMonthTrips(2026, 5, 7, [
    [1, 1, 4, 1], [2, 2, 3, 2], [4, 3, 2, 10], [3, 4, 1, 3],
    [6, 1, 4, 6], [5, 2, 3, 4], [9, 3, 2, 8],
  ]),

  // ─── April 2026 ──────────────────────────────────────────────────────
  ...generateMonthTrips(2026, 4, 6, [
    [2, 1, 4, 2], [4, 2, 3, 10], [1, 3, 2, 1], [3, 4, 1, 3],
    [7, 1, 4, 5], [6, 2, 3, 6],
  ]),

  // ─── March 2026 ──────────────────────────────────────────────────────
  ...generateMonthTrips(2026, 3, 5, [
    [1, 1, 4, 1], [3, 2, 3, 3], [5, 3, 2, 4], [8, 4, 1, 8],
    [4, 1, 4, 10],
  ]),

  // ─── February 2026 ───────────────────────────────────────────────────
  ...generateMonthTrips(2026, 2, 4, [
    [2, 1, 4, 2], [6, 2, 3, 6], [9, 3, 2, 8], [1, 4, 1, 1],
  ]),

  // ─── January 2026 ────────────────────────────────────────────────────
  ...generateMonthTrips(2026, 1, 5, [
    [1, 1, 4, 1], [4, 2, 3, 10], [3, 3, 2, 3], [5, 4, 1, 4],
    [7, 1, 4, 5],
  ]),

  // ─── Some 2025 data for YoY chart ────────────────────────────────────
  ...generateMonthTrips(2025, 6, 3, [
    [1, 1, 4, 1], [4, 2, 3, 10], [3, 3, 2, 3],
  ]),
  ...generateMonthTrips(2025, 5, 3, [
    [2, 1, 4, 2], [6, 2, 3, 6], [9, 3, 2, 8],
  ]),
  ...generateMonthTrips(2025, 4, 2, [
    [1, 1, 4, 1], [4, 2, 3, 10],
  ]),
  ...generateMonthTrips(2025, 3, 2, [
    [3, 3, 2, 3], [5, 4, 1, 4],
  ]),
  ...generateMonthTrips(2025, 2, 2, [
    [2, 1, 4, 2], [6, 2, 3, 6],
  ]),
  ...generateMonthTrips(2025, 1, 3, [
    [1, 1, 4, 1], [3, 3, 2, 3], [4, 2, 3, 10],
  ]),
];

function generateMonthTrips(
  year: number, month: number, count: number,
  assignments: [customerId: number, truckId: number, driverId: number, routeId: number][],
): TripSeed[] {
  const origins = [
    'Cảng Hải Phòng', 'Cảng Đình Vũ, Hải Phòng', 'ICD Hoàng Thành, Hải Phòng',
    'Cảng Lạch Huyện, Hải Phòng', 'Cảng Tân Cảng 128, Hải Phòng',
  ];
  const destinations: Record<number, string> = {
    1: 'Vinatea Mộc Châu, Sơn La',
    2: 'Trà Thu Đan, Thuận Châu, Sơn La',
    3: 'Yên Sơn, Tuyên Quang',
    4: 'Bản Bo, Lai Châu',
    5: 'HTX tea Tân Uyên, Lai Châu',
    6: 'HTX chè Nà Tân, Mộc Châu',
    7: 'Chè Tân Lập, Mộc Châu',
    8: 'Phú Tài, Văn Chấn, Yên Bái',
    9: 'Chè Ngọc Thanh, Phù Ninh, Phú Thọ',
    10: 'KCN Quế Võ, Bắc Ninh',
    11: 'Zaitoon tea, Trạm Thản, Phú Thọ',
  };
  const kms: Record<number, number> = {
    1: 320, 2: 380, 3: 300, 4: 420, 5: 370,
    6: 310, 7: 280, 8: 290, 9: 200, 10: 130, 11: 209,
  };
  // Revenue scaling by route distance
  const basePerKm = 35_000; // ~35k VND/km

  return assignments.slice(0, count).map((a, i) => {
    const [custId, truckId, driverId, routeId] = a;
    const km = kms[routeId] || 250;
    const revenue = km * basePerKm + Math.round((Math.random() - 0.3) * 2_000_000);
    const fuelCost = Math.round(km * 43 / 100 * 27_650);
    const roadAllowance = Math.round(km * 7_500);
    const driverSalary = routeId === 10 ? 400_000 : Math.round(600_000 + km * 800);
    const totalCost = fuelCost + roadAllowance + driverSalary;
    const day = Math.min(i * 3 + 1, 22);

    return {
      status: 'LOCKED' as const,
      departureDate: dateStr(year, month, day),
      customerId: custId,
      truckId,
      driverId,
      routeId,
      revenue,
      totalCost,
      driverSalary,
      totalFuelCost: fuelCost,
      totalRoadAllowance: roadAllowance,
      fuelLiters: Math.round(km * 43 / 100 * 10) / 10,
      legs: [{
        origin: origins[i % origins.length],
        destination: destinations[routeId] || 'Kho hàng',
        km,
        loadingType: 'HANG' as const,
      }],
    };
  });
}

async function seedTrips() {
  console.log('\n🚛 Seeding trips...');

  // Get existing trip codes to avoid duplicates
  const existingCodes = new Set(
    (await db.select({ tripCode: s.trips.tripCode }).from(s.trips))
      .map(t => t.tripCode)
      .filter(Boolean)
  );

  // Get trip code counters
  const existingCounters = await db.select().from(s.tripCodeCounters);
  const counterMap = new Map(existingCounters.map(c => [c.yearMonth, c.counter]));

  let seeded = 0;
  for (const def of tripDefs) {
    // Generate a trip code
    const y = parseInt(def.departureDate.slice(0, 4));
    const m = parseInt(def.departureDate.slice(5, 7));
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    const nextCounter = (counterMap.get(ym) || 0) + 1;
    const tripCode = `TRP-${ym}-${String(nextCounter).padStart(4, '0')}`;

    // Skip if already exists
    if (existingCodes.has(tripCode)) continue;

    counterMap.set(ym, nextCounter);

    const grossProfit = def.revenue - def.totalCost;

    // Insert trip
    const [trip] = await db.insert(s.trips).values({
      tripCode,
      status: def.status,
      departureDate: def.departureDate,
      customerId: def.customerId,
      truckId: def.truckId,
      driverId: def.driverId,
      routeId: def.routeId,
      cargoTypeId: 1, // first cargo type
      revenue: vnd(def.revenue),
      totalCost: vnd(def.totalCost),
      grossProfit: vnd(grossProfit),
      driverSalary: vnd(def.driverSalary),
      totalFuelCost: vnd(def.totalFuelCost),
      totalRoadAllowance: vnd(def.totalRoadAllowance),
      fuelLiters: String(def.fuelLiters),
      fuelPriceApplied: '27650',
      fuelMode: 'AUTO',
      version: 1,
    }).returning({ id: s.trips.id });

    // Insert legs
    for (let li = 0; li < def.legs.length; li++) {
      const leg = def.legs[li];
      await db.insert(s.tripLegs).values({
        tripId: trip.id,
        sequence: li + 1,
        origin: leg.origin,
        destination: leg.destination,
        km: leg.km,
        loadingType: leg.loadingType,
      });
    }

    // Insert TRIP_REVENUE ledger entry for LOCKED trips
    if (def.status === 'LOCKED' && def.revenue > 0) {
      await insertLedgerEntry(def.customerId, def.revenue, trip.id, def.departureDate);
    }

    seeded++;
  }

  // Upsert trip code counters
  for (const [ym, counter] of counterMap) {
    await db.insert(s.tripCodeCounters)
      .values({ yearMonth: ym, counter })
      .onConflictDoUpdate({ target: s.tripCodeCounters.yearMonth, set: { counter } });
  }

  console.log(`  ✅ ${seeded} trips seeded`);
}

async function insertLedgerEntry(customerId: number, amount: number, tripId: number, dateStr: string) {
  // Get current balance for this customer
  const [lastEntry] = await db.select({ balance: s.ledger.balance })
    .from(s.ledger)
    .where(sql`${s.ledger.entityType} = 'CUSTOMER' AND ${s.ledger.entityId} = ${customerId}`)
    .orderBy(sql`${s.ledger.id} DESC`)
    .limit(1);

  const prevBalance = lastEntry ? parseFloat(lastEntry.balance as string) : 0;
  // Customer: debit increases (they owe us more)
  const newBalance = prevBalance + amount;

  await db.insert(s.ledger).values({
    txnType: 'TRIP_REVENUE',
    txnId: tripId,
    entityType: 'CUSTOMER',
    entityId: customerId,
    debit: vnd(amount),
    credit: '0',
    balance: vnd(newBalance),
    timestamp: new Date(dateStr + 'T08:00:00Z'),
    note: 'Cước vận chuyển',
  });
}

async function seedReceivables() {
  console.log('\n💰 Seeding receivables (partial payments)...');

  // Simulate some customers having paid partially
  // This creates PAYMENT_RECEIVED ledger entries to reduce their balance
  const payments: { customerId: number; amount: number; date: string }[] = [
    { customerId: 1, amount: 25_000_000, date: '2026-05-28' },
    { customerId: 2, amount: 12_000_000, date: '2026-06-05' },
    { customerId: 4, amount: 8_000_000, date: '2026-06-10' },
    { customerId: 3, amount: 10_000_000, date: '2026-04-15' },
  ];

  for (const p of payments) {
    const [lastEntry] = await db.select({ balance: s.ledger.balance })
      .from(s.ledger)
      .where(sql`${s.ledger.entityType} = 'CUSTOMER' AND ${s.ledger.entityId} = ${p.customerId}`)
      .orderBy(sql`${s.ledger.id} DESC`)
      .limit(1);

    const prevBalance = lastEntry ? parseFloat(lastEntry.balance as string) : 0;
    const newBalance = Math.max(0, prevBalance - p.amount);

    await db.insert(s.ledger).values({
      txnType: 'PAYMENT_RECEIVED',
      entityType: 'CUSTOMER',
      entityId: p.customerId,
      debit: '0',
      credit: vnd(p.amount),
      balance: vnd(newBalance),
      timestamp: new Date(p.date + 'T10:00:00Z'),
      note: 'Khách thanh toán',
    });
  }
  console.log('  ✅ Receivables seeded (4 partial payments)');
}

async function seedExpenses() {
  console.log('\n🔧 Seeding expenses (with renewal reminders)...');

  // Get category IDs
  const cats = await db.select().from(s.expenseCategories);
  const catMap = new Map(cats.map(c => [c.name, c.id]));

  // Renewable expenses approaching expiry (insurance, registration, toll)
  const renewableExpenses = [
    {
      supplierId: 1,
      categoryId: catMap.get('Bảo hiểm'),
      truckId: 1,
      amount: vnd(12_500_000),
      validFrom: '2025-07-01',
      validTo: '2026-07-01', // expires in ~30 days
      note: 'Bảo hiểm thân veste 15C-136.31',
    },
    {
      supplierId: 1,
      categoryId: catMap.get('Bảo hiểm'),
      truckId: 2,
      amount: vnd(11_800_000),
      validFrom: '2025-06-15',
      validTo: '2026-06-15', // expired or very close
      note: 'Bảo hiểm thân veste 15H-168.73',
    },
    {
      supplierId: 2,
      categoryId: catMap.get('Đăng kiểm'),
      truckId: 3,
      amount: vnd(3_200_000),
      validFrom: '2025-08-01',
      validTo: '2026-07-15', // ~45 days
      note: 'Đăng kiểm 15C-139.82',
    },
    {
      supplierId: 3,
      categoryId: catMap.get('Phí đường bộ'),
      truckId: 4,
      amount: vnd(4_500_000),
      validFrom: '2026-01-01',
      validTo: '2026-06-30', // expires in ~30 days
      note: 'Phí đường bộ 2026 15C-180.99',
    },
  ];

  for (const exp of renewableExpenses) {
    if (!exp.categoryId) continue;
    await db.insert(s.expenses).values({
      expenseDate: '2026-01-15',
      supplierId: exp.supplierId,
      categoryId: exp.categoryId,
      truckId: exp.truckId,
      vehicleComponent: 'TRUCK',
      amount: exp.amount,
      paymentStatus: 'PAID',
      validFrom: new Date(exp.validFrom),
      validTo: new Date(exp.validTo),
      note: exp.note,
      createdBy: 1,
    });
  }

  // Some regular repair/maintenance expenses for cost breakdown
  const regularExpenses = [
    { categoryId: catMap.get('Sửa chữa'), truckId: 1, amount: 5_500_000, note: 'Thay thế phanh' },
    { categoryId: catMap.get('Phụ tùng'), truckId: 2, amount: 2_300_000, note: 'Lốp dự phòng' },
    { categoryId: catMap.get('Vật tư'), truckId: 3, amount: 800_000, note: 'Dầu nhớt' },
    { categoryId: catMap.get('Sửa chữa'), truckId: 5, amount: 9_200_000, note: 'Sửa chữa động cơ (bảo dưỡng)' },
    { categoryId: catMap.get('Phụ tùng'), truckId: 4, amount: 1_500_000, note: 'Bóng đèn, gương chiếu hậu' },
  ];

  for (const exp of regularExpenses) {
    if (!exp.categoryId) continue;
    await db.insert(s.expenses).values({
      expenseDate: '2026-05-20',
      supplierId: 4,
      categoryId: exp.categoryId,
      truckId: exp.truckId,
      vehicleComponent: 'TRUCK',
      amount: vnd(exp.amount),
      paymentStatus: 'PAID',
      note: exp.note,
      createdBy: 1,
    });
  }

  // One UNPAID expense for payables
  await db.insert(s.expenses).values({
    expenseDate: '2026-06-10',
    supplierId: 5,
    categoryId: catMap.get('Sửa chữa') || 1,
    truckId: 1,
    vehicleComponent: 'TRUCK',
    amount: vnd(3_800_000),
    paymentStatus: 'UNPAID',
    note: 'Sửa chữa lốc máy',
    createdBy: 1,
  });

  console.log(`  ✅ Expenses seeded (${renewableExpenses.length} renewable + ${regularExpenses.length + 1} regular)`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding dashboard data...\n');
  console.log('📅 Current date: June 2026');
  console.log('📅 Salary period default: 25th → 24th');

  await seedConfig();
  await seedTrips();
  await seedReceivables();
  await seedExpenses();

  // Print summary
  console.log('\n📊 Summary:');
  const trips = await db.select({
    status: s.trips.status,
    count: sql<number>`count(*)`,
  }).from(s.trips).where(isNull(s.trips.deletedAt)).groupBy(s.trips.status);

  for (const r of trips) {
    console.log(`  ${r.status}: ${r.count} trips`);
  }

  const totalRevenue = await db.select({
    total: sql<string>`coalesce(sum(revenue::numeric), 0)`,
  }).from(s.trips).where(sql`${s.trips.status} = 'LOCKED' AND ${s.trips.deletedAt} IS NULL`);

  console.log(`  💰 Total LOCKED revenue: ${parseFloat(totalRevenue[0].total).toLocaleString('vi-VN')} VND`);

  console.log('\n✅ Dashboard seed complete!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
