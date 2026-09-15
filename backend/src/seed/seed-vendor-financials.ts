/**
 * Seed vendor-side financials through domain services:
 *   - company expenses (UNPAID → VENDOR ledger payables) for /payables + /expenses
 *   - fuel invoices with per-trip allocations (+ APPROVED status) for fuel-recon
 *
 * Idempotent: keyed on stable invoice numbers / expense notes.
 *
 * Part of plans/260817-2148-seed-full-coverage.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { createExpense } from '../services/expense.service';
import { createFuelInvoice } from '../services/fuel-invoice.service';
import { createTripExpense } from '../services/forwarder.service';

export async function seedVendorFinancials(actorId: number, _legacyApproverId: number): Promise<void> {
  await seedCompanyExpenses(actorId);
  await seedFuelInvoices(actorId);
}

async function seedCompanyExpenses(actorId: number) {
  const suppliers = await db.select({ id: s.suppliers.id, name: s.suppliers.name })
    .from(s.suppliers).where(isNull(s.suppliers.deletedAt));
  const byName = new Map(suppliers.map(x => [x.name, x.id]));
  const categories = await db.select({ id: s.expenseCategories.id, name: s.expenseCategories.name })
    .from(s.expenseCategories);
  const cat = new Map(categories.map(x => [x.name, x.id]));
  const trucks = await db.select({ id: s.trucks.id, plate: s.trucks.licensePlate })
    .from(s.trucks).where(isNull(s.trucks.deletedAt));
  const truck = new Map(trucks.map(t => [t.plate, t.id]));

  const plans = [
    { note: 'Bảo hiểm thân xe 60C-12345 kỳ 2026', supplier: 'Bảo hiểm Bảo Việt', category: 'Bảo hiểm', amount: '24500000', truck: '60C-12345', date: '2026-07-05', paymentStatus: 'PAID', validFrom: '2026-07-01', validTo: '2027-06-30' },
    { note: 'Đăng kiểm định kỳ 60C-23456', supplier: 'Trạm Đăng kiểm 15-01S', category: 'Đăng kiểm', amount: '560000', truck: '60C-23456', date: '2026-07-18', paymentStatus: 'PAID', validFrom: '2026-07-18', validTo: '2027-01-17' },
    { note: 'Phí đường bộ quý 3/2026 xe 60C-34567', supplier: 'Trạm Đăng kiểm 15-01S', category: 'Phí đường bộ', amount: '4320000', truck: '60C-34567', date: '2026-07-25', paymentStatus: 'UNPAID', validFrom: '2026-07-01', validTo: '2026-09-30' },
    { note: 'Sửa chữa phanh rơ-moóc RM-60C-45678', supplier: 'Gara Thành Đông', category: 'Sửa chữa', amount: '3850000', truck: '60C-45678', date: '2026-08-02', paymentStatus: 'UNPAID', validFrom: null, validTo: null },
    { note: 'Thay lốp đầu kéo 60C-12345', supplier: 'Gara Thành Đông', category: 'Phụ tùng', amount: '16800000', truck: '60C-12345', date: '2026-08-08', paymentStatus: 'UNPAID', validFrom: null, validTo: null },
    { note: 'Vật tư dầu mỡ bôi trơn tháng 8', supplier: 'Petrolimex', category: 'Vật tư', amount: '2150000', truck: null, date: '2026-08-10', paymentStatus: 'UNPAID', validFrom: null, validTo: null },
  ];

  let created = 0;
  for (const plan of plans) {
    const [existing] = await db.select({ id: s.expenses.id })
      .from(s.expenses).where(eq(s.expenses.note, plan.note)).limit(1);
    if (existing) continue;

    const supplierId = byName.get(plan.supplier);
    const categoryId = cat.get(plan.category);
    if (!supplierId || !categoryId) {
      console.warn(`  ⚠️ Expense seed: missing ${plan.supplier} or ${plan.category}`);
      continue;
    }
    await db.transaction(async (tx) => {
      await createExpense(tx, {
        expenseDate: plan.date,
        supplierId,
        categoryId,
        truckId: plan.truck ? (truck.get(plan.truck) ?? null) : null,
        vehicleComponent: plan.truck ? 'TRUCK' : null,
        amount: plan.amount,
        paymentStatus: plan.paymentStatus,
        validFrom: plan.validFrom,
        validTo: plan.validTo,
        note: plan.note,
      }, actorId, true);
    });
    created++;
  }
  console.log(`✅ Company expenses seeded! (${created} new)`);
}

async function seedFuelInvoices(actorId: number) {
  const fuelSuppliers = await db.select({ id: s.suppliers.id, name: s.suppliers.name })
    .from(s.suppliers)
    .where(and(eq(s.suppliers.isFuelSupplier, true), isNull(s.suppliers.deletedAt)));
  if (fuelSuppliers.length === 0) {
    console.warn('  ⚠️ Fuel invoice seed: no fuel suppliers');
    return;
  }
  const petrolimex = fuelSuppliers.find(x => x.name === 'Petrolimex') ?? fuelSuppliers[0]!;

  // Allocate across trucks of completed/running trips.
  const trips = await db.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    truckId: s.trips.truckId,
    status: s.trips.status,
  })
    .from(s.trips)
    .where(and(
      isNull(s.trips.deletedAt),
      inArray(s.trips.status, ['COMPLETED', 'IN_TRANSIT']),
    ));

  const invoicePlans = [
    {
      invoiceNumber: 'PL-2026-0007812',
      invoiceDate: '2026-08-16',
      totalLiters: 380,
      unitPrice: 23000,
      note: 'Hóa đơn xăng dầu tổng hợp 16/08',
    },
    {
      invoiceNumber: 'PL-2026-0007945',
      invoiceDate: '2026-08-10',
      totalLiters: 290,
      unitPrice: 22800,
      note: 'Hóa đơn xăng dầu 10/08',
    },
  ];

  let created = 0;
  for (const plan of invoicePlans) {
    const [existing] = await db.select({ id: s.fuelInvoices.id })
      .from(s.fuelInvoices)
      .where(eq(s.fuelInvoices.invoiceNumber, plan.invoiceNumber)).limit(1);
    if (existing) continue;

    // Split liters evenly across trips carrying a truck.
    const truckTrips = trips.filter(t => t.truckId != null);
    if (truckTrips.length === 0) {
      console.warn('  ⚠️ Fuel invoice seed: no truck trips');
      return;
    }
    const litersEach = Math.round((plan.totalLiters / truckTrips.length) * 100) / 100;
    // Equal shares rounded up must not sum past the invoice's liter cap
    // (fuel-invoice validation rejects any allocation total above it), so
    // the last trip absorbs the exact remainder instead of a fourth rounded
    // share.
    const allocationDrafts = truckTrips.map((t, i) => ({
      tripId: t.id,
      voucherReference: `${plan.invoiceNumber}/${String(i + 1).padStart(2, '0')}`,
      voucherDate: plan.invoiceDate,
      liters: i === truckTrips.length - 1
        ? Math.round((plan.totalLiters - litersEach * (truckTrips.length - 1)) * 100) / 100
        : litersEach,
    }));

    const allocations = [];
    for (const allocation of allocationDrafts) {
      const [existingExpense] = await db.select().from(s.tripExpenses).where(and(eq(s.tripExpenses.tripId, allocation.tripId), eq(s.tripExpenses.invoiceNumber, allocation.voucherReference))).limit(1);
      const expense = existingExpense ?? await createTripExpense(db, {
        tripId: allocation.tripId, forwarderId: null, createdBy: actorId, expenseType: 'FUEL',
        expenseDate: allocation.voucherDate, invoiceNumber: allocation.voucherReference,
        supplierId: petrolimex.id, buyAmount: String(Math.round(allocation.liters * plan.unitPrice)),
        sellAmount: '0', settlementMethod: 'COMPANY_DIRECT', approvalStatus: 'RECORDED',
        note: `Dữ liệu mẫu — nhiên liệu ${allocation.voucherReference}`,
      });
      allocations.push({ ...allocation, tripExpenseId: expense.id });
    }

    await createFuelInvoice({
      supplierId: petrolimex.id,
      invoiceNumber: plan.invoiceNumber,
      invoiceDate: plan.invoiceDate,
      totalLiters: plan.totalLiters,
      unitPrice: plan.unitPrice,
      note: plan.note,
      allocations,
    }, actorId);

    // Record complete invoice and allocations through the direct service.
    created++;
  }
  console.log(`✅ Fuel invoices seeded! (${created} new)`);
}
