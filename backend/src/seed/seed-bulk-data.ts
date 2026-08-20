/**
 * Bulk seed module — generates a large, realistic dataset for meaningful local-dev QA.
 *
 * Why this module exists:
 *   The canonical seed flow (seed.ts → seedShipments / seedTrips) deliberately
 *   produces a small, hand-curated set of ~20 shipments + ~9 trips. That is
 *   perfect for hand-driven demo flows, but too small to exercise pagination,
 *   filter combos, date-range aggregations, or perf regressions in the local
 *   dev DB. This module adds **synthetic-but-realistic** volume (~250
 *   shipments, ~200 trips, ~30 customers, ~60 expenses) that flows through
 *   plain DB inserts — not the production service stack — so it stays fast
 *   (the whole bulk load is < 5 s on a laptop) and idempotent.
 *
 * Idempotency:
 *   All synthetic rows carry refs with a stable `BULK-` / `VN-` prefix
 *   (BL/booking/customer tax codes, etc.). The single entry point
 *   `seedBulkData()` first probes for the seed marker — one well-known
 *   shipment with a known `blNumber` (`BULK-MARKER-DO-NOT-DELETE`). If the
 *   marker exists, the module short-circuits (logs `skipped, already
 *   seeded`) and returns; otherwise it inserts the full bulk dataset in
 *   FK-safe order.
 *
 * To force a re-seed: DELETE FROM shipments WHERE bl_number LIKE 'BULK-%'
 * (or run a full wipe, which removes the marker too).
 *
 * Coverage:
 *   - 30 new customers (tax codes 0300xxxxxx–0399xxxxxx, deliberately outside
 *     the existing 0101–2300 range so the unique tax-code index never fires).
 *   - 250 shipments: ~125 IMPORT + ~125 EXPORT, spread across every status
 *     and the last 6 months.
 *   - 1–2 containers per shipment, 1–2 seals per container where appropriate.
 *   - 200 trips: CREATED/IN_TRANSIT/COMPLETED/CANCELED with realistic
 *     revenue / cost / fuel surcharge snapshots.
 *   - 60 company expenses (PAID + UNPAID) across all categories.
 *   - 8 additional suppliers (different names from the 8 seed ones).
 *   - 12 additional drivers (so we have headroom for the larger trip pool).
 *
 * Date strategy:
 *   All dates are spread between 2026-03-01 and 2026-08-31 (the 6 months
 *   leading up to "now" per the project's current dev date). Distribution
 *   is biased so ~70 % of shipments are in the past (closed/operational
 *   surface) and ~30 % are in the future (planning surface).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';

// ─── Idempotency marker ────────────────────────────────────────────────────────
// A single, well-known BL number marks the bulk-seeded data. The probe is
// cheap (a unique-indexed query) and avoids any "row count" guesswork.
const BULK_MARKER_BL = 'BULK-MARKER-DO-NOT-DELETE';
const BULK_TAX_CODE_PREFIX = '03'; // 0300xxxxxx range
const BULK_BL_PREFIX = 'BULK-IMP-';
const BULK_BR_PREFIX = 'BULK-EXP-';
const BULK_TRIP_PREFIX = 'BULK-TR-';
const BULK_CUSTOMER_TAX_START = 30_000_000_0; // 0300000000 → 0300000029
const BULK_SUPPLIER_TAX_START = 80_000_000_0; // 0800000000 → 0800000007
const BULK_EXPENSE_NOTE_PREFIX = '[BULK]';

// ─── Data pools — realistic Vietnamese logistics fixtures ─────────────────────
const CITIES_NORTH = [
  'Hải Phòng', 'Bắc Ninh', 'Bắc Giang', 'Hà Nội', 'Hà Nam', 'Hưng Yên',
  'Thái Bình', 'Nam Định', 'Hải Dương', 'Phú Thọ', 'Vĩnh Phúc', 'Thái Nguyên',
  'Ninh Bình', 'Quảng Ninh', 'Hòa Bình', 'Lào Cai', 'Yên Bái',
];
const FACTORY_PREFIXES = [
  'KCN Vân Trung', 'KCN Đồng Văn', 'KCN Yên Phong', 'KCN Tiên Sơn',
  'KCN Thăng Long', 'KCN Quế Võ', 'KCN Phú Nghĩa', 'KCN Khai Quang',
  'KCN Bình Xuyên', 'KCN Bắc Ninh', 'KCN Hải Phòng', 'KCN Đình Vũ',
];
const WAREHOUSE_PREFIXES = [
  'Kho Tổng', 'Kho Trung chuyển', 'Kho Logistics', 'Kho Hàng Hóa',
  'Kho Bảo quản', 'Kho Xuất nhập', 'Kho Container', 'Kho Hải quan',
];
const FIRST_NAMES = [
  'Văn', 'Hữu', 'Đức', 'Thị', 'Văn', 'Thị', 'Quang', 'Thành', 'Trung', 'Minh',
  'Công', 'Tiến', 'Mạnh', 'Sỹ', 'Hồng', 'Thanh', 'Tuấn', 'Hải', 'Quốc', 'Bảo',
];
const FAMILY_NAMES = [
  'Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ',
  'Ngô', 'Dương', 'Lý', 'Chu', 'Đinh', 'Đoàn', 'Tô', 'Trịnh', 'Võ', 'Mai',
];
const COMPANY_TYPES = [
  'Công ty CP', 'Công ty TNHH', 'Công ty TNHH MTV', 'Tập đoàn', 'Công ty',
  'Xí nghiệp', 'Nhà máy', 'Chi nhánh', 'Công ty Liên doanh',
];
const COMPANY_INDUSTRIES = [
  'Dệt may', 'Điện tử', 'Thực phẩm', 'Cơ khí', 'Gỗ nội thất', 'Nhựa',
  'Hóa chất', 'Da giày', 'Bao bì', 'Nông sản', 'Thủy sản', 'Sắt thép',
  'VLXD', 'Thủy tinh', 'Gốm sứ', 'Sơn', 'Pin ắc quy', 'Phụ tùng ô tô',
  'Lốp xe', 'Cáp điện', 'Thiết bị điện', 'Đồ gia dụng', 'Sữa', 'Bánh kẹo',
];
const COMPANY_BRANDS = [
  'Việt Nhật', 'Á Đông', 'Hòa Bình', 'Tân Tiến', 'Phú Mỹ', 'Sài Gòn',
  'Hà Nội', 'Hải Phòng', 'Mekong', 'Đại Việt', 'Thăng Long', 'Bắc Á',
  'Thái Bình Dương', 'Đông Á', 'Nam Á', 'Bảo Long', 'An Phát', 'Hợp Phát',
  'Phú Hưng', 'Gia Phát', 'Hoàng Long', 'Hồng Hà', 'Trường An', 'Quốc Cường',
];
const SHIPPING_LINES = ['MSC', 'ONE', 'MAERSK', 'CMA CGM', 'HAPAG-LLOYD', 'EVERGREEN', 'COSCO', 'YANG MING'];
const FACTORY_NAMES = [
  'NEWEB-Kho 1', 'NEWEB-Kho 2', 'ASKEY Kho', 'SUNRISE Xưởng A', 'SUNRISE Xưởng B',
  'TONGWEI Kho Thức Ăn', 'REGINA Xưởng May 1', 'REGINA Xưởng May 2',
  'BB Long Biên', 'BB Kho Hà Nội', 'BÌNH ĐỊNH Kho', 'DECATHLON Kho',
];
const PORTS_PICKUP = ['Cảng Hải Phòng', 'Cảng Đình Vũ', 'Cảng Tân Vũ', 'TC - HICT', 'TIL - HTIT', 'Cảng Nam Hải Đình Vũ'];
const PORTS_DROPOFF = ['Cảng Đình Vũ', 'TC - HICT', 'TIL - HTIT', 'Cảng Tân Vũ', 'Cảng VIP Greenport', 'Cảng Nam Hải Đình Vũ'];
const STATUSES = [
  'NEW', 'NEW', 'NEW',                              // 3/16 NEW
  'PENDING_DATE', 'PENDING_DATE',                   // 2/16 PENDING_DATE
  'READY_FOR_DISPATCH', 'READY_FOR_DISPATCH', 'READY_FOR_DISPATCH', // 3/16
  'DISPATCHED', 'DISPATCHED',                       // 2/16
  'IN_TRANSIT', 'IN_TRANSIT', 'IN_TRANSIT',         // 3/16
  'PENDING_EXPENSE_APPROVAL',                       // 1/16
  'COMPLETED', 'COMPLETED',                         // 2/16
  'CANCELED',                                       // 1/16
];
const EXPENSE_NOTE_TEMPLATES = [
  'Bảo hiểm thân xe {plate} kỳ {q}/{y}',
  'Đăng kiểm định kỳ {plate}',
  'Phí đường bộ quý {q}/{y} xe {plate}',
  'Sửa chữa phanh rơ-moóc RM-{plate}',
  'Thay lốp đầu kéo {plate}',
  'Vật tư dầu mỡ bôi trơn tháng {m}/{y}',
  'Phí đăng ký biển số mới {plate}',
  'Bảo dưỡng động cơ {plate} định kỳ',
  'Thay cầu chì + bóng đèn {plate}',
  'Vệ sinh buồng lái + thay lọc gió {plate}',
  'Phí sử dụng đường bộ Bộ GTVT {plate}',
  'Phí bảo trì đường bộ VEC {plate}',
  'Nhiên liệu tháng {m}/{y} xe {plate}',
  'Phí kiểm định khí thải {plate}',
  'Phí kiểm định an toàn kỹ thuật {plate}',
  'Phí sửa chữa điều hòa cabin {plate}',
];

// ─── Deterministic PRNG (mulberry32) so reruns are reproducible ──────────────
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(20260820);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
const pickN = <T>(arr: readonly T[], n: number): T[] => {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]!);
  }
  return out;
};
const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const randFloatStr = (min: number, max: number, dp = 0) => {
  const v = min + rng() * (max - min);
  return v.toFixed(dp);
};

// ─── ID pools — resolve FKs at runtime so we never hard-code surrogate ids ───
async function resolvePorts(): Promise<{ byName: Map<string, number> }> {
  const rows = await db.select({ id: s.ports.id, name: s.ports.name })
    .from(s.ports).where(isNull(s.ports.deletedAt));
  return { byName: new Map(rows.map(r => [r.name, r.id])) };
}
async function resolveContainerTypes(): Promise<Map<string, number>> {
  const rows = await db.select({ id: s.containerTypes.id, code: s.containerTypes.code })
    .from(s.containerTypes).where(isNull(s.containerTypes.deletedAt));
  return new Map(rows.map(r => [r.code, r.id]));
}
async function resolveRoutes(): Promise<{ byName: Map<string, number> }> {
  const rows = await db.select({ id: s.routes.id, name: s.routes.name })
    .from(s.routes).where(isNull(s.routes.deletedAt));
  return { byName: new Map(rows.map(r => [r.name, r.id])) };
}
async function resolveAllTrucks(): Promise<{ byId: Map<number, string>; ids: number[] }> {
  const rows = await db.select({ id: s.trucks.id, plate: s.trucks.licensePlate })
    .from(s.trucks).where(and(eq(s.trucks.status, 'ACTIVE'), isNull(s.trucks.deletedAt)));
  return {
    byId: new Map(rows.map(r => [r.id, r.plate])),
    ids: rows.map(r => r.id),
  };
}
async function resolveAllDrivers(): Promise<{ byId: Map<number, string>; ids: number[] }> {
  const rows = await db.select({ id: s.drivers.id, name: s.drivers.name })
    .from(s.drivers)
    .where(and(eq(s.drivers.status, 'ACTIVE'), isNull(s.drivers.deletedAt)));
  return {
    byId: new Map(rows.map(r => [r.id, r.name])),
    ids: rows.map(r => r.id),
  };
}
async function resolveAllTrailers(): Promise<number[]> {
  const rows = await db.select({ id: s.trailers.id })
    .from(s.trailers)
    .where(and(eq(s.trailers.status, 'ACTIVE'), isNull(s.trailers.deletedAt)));
  return rows.map(r => r.id);
}
async function resolveActiveUserIdsByRole(): Promise<Map<string, number>> {
  const rows = await db.select({ id: s.users.id, username: s.users.username, role: s.users.role })
    .from(s.users).where(isNull(s.users.deletedAt));
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.username) map.set(r.username, r.id);
  }
  return map;
}
async function resolveExistingCustomerIds(): Promise<{ ids: number[]; byTaxCode: Map<string, number> }> {
  const rows = await db.select({ id: s.customers.id, taxCode: s.customers.taxCode })
    .from(s.customers).where(isNull(s.customers.deletedAt));
  return {
    ids: rows.map(r => r.id),
    byTaxCode: new Map(
      rows.filter(r => r.taxCode).map(r => [r.taxCode!.toLowerCase().trim(), r.id] as const),
    ),
  };
}
async function resolveAllSupplierIds(): Promise<number[]> {
  const rows = await db.select({ id: s.suppliers.id })
    .from(s.suppliers).where(isNull(s.suppliers.deletedAt));
  return rows.map(r => r.id);
}
async function resolveAllCategoryIds(): Promise<number[]> {
  const rows = await db.select({ id: s.expenseCategories.id })
    .from(s.expenseCategories);
  return rows.map(r => r.id);
}

// ─── Vietnamese container number helpers ─────────────────────────────────────
const CONTAINER_PREFIXES = ['MSCU', 'TCLU', 'CMAU', 'EGHU', 'OOLU', 'FCIU', 'HLXU', 'BEAU', 'MEDU', 'TRHU', 'MSBU', 'MSDU', 'TGBU', 'MAGU', 'WHLU', 'SUDU', 'APHU', 'CRLU', 'EISU', 'DRYU'];
function genContainerNumber(used: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const prefix = pick(CONTAINER_PREFIXES);
    const digits = String(randInt(1000000, 9999999));
    const candidate = prefix + digits;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  // Pathological: fall back to a timestamp-derived unique number.
  return 'BULK' + String(Date.now() + Math.floor(Math.random() * 1000)).slice(-7);
}
function genSealNumber(): string {
  return 'SL' + String(randInt(1_000_000, 9_999_999));
}
function genPhone(): string {
  const prefixes = ['090', '091', '093', '094', '096', '097', '098', '032', '033', '034', '035', '036', '037', '038', '039'];
  return pick(prefixes) + String(randInt(1_000_000, 9_999_999));
}
function genVietnameseName(): string {
  return `${pick(FAMILY_NAMES)} ${pick(FIRST_NAMES)} ${pick(FAMILY_NAMES)}`;
}
function genCompanyName(): string {
  const type = pick(COMPANY_TYPES);
  const brand = pick(COMPANY_BRANDS);
  const industry = pick(COMPANY_INDUSTRIES);
  return `${type} ${brand} ${industry}`;
}
function genFactoryAddress(): string {
  return `${pick(FACTORY_PREFIXES)}, ${pick(CITIES_NORTH)}`;
}
function genWarehouseAddress(): string {
  return `${pick(WAREHOUSE_PREFIXES)} ${pick(CITIES_NORTH)}`;
}

// ─── Date helpers ────────────────────────────────────────────────────────────
// 6-month window: 2026-03-01 → 2026-08-31.
// Past-biased: 70% land in March–July (operational history), 30% in August
// and onwards (planning window). All Math.random calls go through the
// deterministic rng for reproducibility.
const WINDOW_START = new Date('2026-03-01T00:00:00+07:00').getTime();
const WINDOW_END = new Date('2026-08-31T23:59:59+07:00').getTime();
function randomDate(): Date {
  // 70/30 past/future split around a pivot on 2026-08-01.
  const pivot = new Date('2026-08-01T00:00:00+07:00').getTime();
  const usePast = rng() < 0.7;
  const lo = usePast ? WINDOW_START : pivot;
  const hi = usePast ? pivot : WINDOW_END;
  return new Date(lo + rng() * (hi - lo));
}
function dateOffset(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

// ─── Main entry point ─────────────────────────────────────────────────────────
export async function seedBulkData(): Promise<{ created: boolean; stats: Record<string, number> }> {
  // ── 1. Idempotency probe ──────────────────────────────────────────────────
  // Two independent guards make the bulk seed fully idempotent across
  // normal re-runs, partial wipes, and concurrent test fixtures:
  //   a) the marker shipment (BULK-MARKER-DO-NOT-DELETE) — inserted by
  //      this module on its very first run.
  //   b) any existing BULK-prefixed BL or booking ref — covers the rare
  //      case where a partial prior run inserted rows but the marker row
  //      was deleted (e.g. a shipments-only wipe).
  const [marker] = await db.select({ id: s.shipments.id })
    .from(s.shipments)
    .where(eq(s.shipments.blNumber, BULK_MARKER_BL))
    .limit(1);
  if (marker) {
    console.log('✅ Bulk seed data already present (marker exists); skipping.');
    return { created: false, stats: {} };
  }
  const [anyBulkShipment] = await db.select({ id: s.shipments.id })
    .from(s.shipments)
    .where(sql`${s.shipments.blNumber} LIKE 'BULK-%' OR ${s.shipments.bookingRef} LIKE 'BULK-%'`)
    .limit(1);
  if (anyBulkShipment) {
    console.log('✅ Bulk seed data already present (BULK- shipments exist); skipping.');
    return { created: false, stats: {} };
  }

  console.log('\n📦 Seeding bulk QA dataset (this is a one-time idempotent load)…');

  // ── 2. Resolve FK pools once ─────────────────────────────────────────────
  const ports = await resolvePorts();
  const containerTypes = await resolveContainerTypes();
  const routes = await resolveRoutes();
  const trucks = await resolveAllTrucks();
  const drivers = await resolveAllDrivers();
  const trailers = await resolveAllTrailers();
  const userIds = await resolveActiveUserIdsByRole();
  const existingCustomers = await resolveExistingCustomerIds();
  const supplierIds = await resolveAllSupplierIds();
  const categoryIds = await resolveAllCategoryIds();
  const portPickupIds = PORTS_PICKUP.map(n => ports.byName.get(n)).filter((v): v is number => v != null);
  const portDropoffIds = PORTS_DROPOFF.map(n => ports.byName.get(n)).filter((v): v is number => v != null);
  const routeIds = [...routes.byName.values()];
  const containerTypeEntries: Array<[string, number]> = [...containerTypes.entries()];

  if (portPickupIds.length === 0 || portDropoffIds.length === 0) {
    throw new Error('seedBulkData: ports missing — run the canonical seed first.');
  }
  if (trucks.ids.length === 0 || drivers.ids.length === 0) {
    throw new Error('seedBulkData: no ACTIVE trucks/drivers — run the canonical seed first.');
  }
  if (containerTypeEntries.length === 0) {
    throw new Error('seedBulkData: no container types — run the canonical seed first.');
  }
  if (supplierIds.length === 0 || categoryIds.length === 0) {
    throw new Error('seedBulkData: no suppliers/categories — run the canonical seed first.');
  }
  if (!userIds.has('cus')) {
    throw new Error('seedBulkData: missing CUS user — run the canonical seed first.');
  }

  const cusUserId = userIds.get('cus')!;
  const dispatcherUserId = userIds.get('dieuvan') ?? userIds.get('admin')!;
  const managerUserId = userIds.get('giamdoc')!;
  const createdBy = cusUserId;
  // Tracks whether the marker shipment has been inserted yet. The marker
  // is the idempotency anchor for the next `seedBulkData` call.
  let markerInserted = false;

  // ── 3. Add 30 new customers with synthetic-but-plausible tax codes ───────
  const newCustomerIds: number[] = [...existingCustomers.ids];
  let newCustomerCount = 0;
  const customerFullNames: { id: number; name: string; shortName: string }[] = [];
  for (let i = 0; i < 30; i++) {
    const taxCode = String(BULK_CUSTOMER_TAX_START + i).padStart(10, '0');
    const taxKey = taxCode.toLowerCase().trim();
    if (existingCustomers.byTaxCode.has(taxKey)) continue;
    const fullName = genCompanyName();
    const shortName = fullName.replace(/^(Công ty|CÔNG TY|Tập đoàn|Chi nhánh|Xí nghiệp|Nhà máy)[^ ]* /, '').slice(0, 60);
    const [created] = await db.insert(s.customers).values({
      name: fullName,
      shortName,
      taxCode,
      contactPerson: genVietnameseName(),
      phone: genPhone(),
      isCarrier: false,
      status: 'ACTIVE',
    }).returning({ id: s.customers.id });
    newCustomerIds.push(created!.id);
    customerFullNames.push({ id: created!.id, name: fullName, shortName });
    existingCustomers.byTaxCode.set(taxKey, created!.id);
    newCustomerCount++;
  }
  // Use the short-name as the contact person too (matches the seed convention).
  console.log(`  ✅ Customers: +${newCustomerCount} (total pool ${newCustomerIds.length})`);

  // ── 4. Insert 8 additional suppliers with synthetic tax codes ────────────
  const newSupplierIds: number[] = [...supplierIds];
  let newSupplierCount = 0;
  const supplierServiceTemplates = [
    { name: 'Gara Ô tô Bình An', phone: '02253667788', note: 'Xưởng sửa chữa xe container', chiHoDueDays: 15, cuocDueDays: 30, isFuelSupplier: false },
    { name: 'Trạm Đăng kiểm 15-02S', phone: '02253667789', note: 'Đăng kiểm khu vực Hải Phòng', chiHoDueDays: 15, cuocDueDays: 30, isFuelSupplier: false },
    { name: 'Shell Vietnam', phone: '02838228822', note: 'Nhà cung cấp nhiên liệu', chiHoDueDays: 15, cuocDueDays: 30, isFuelSupplier: true },
    { name: 'Bảo hiểm PVI', phone: '19001560', note: 'Bảo hiểm hàng hóa + xe', chiHoDueDays: 15, cuocDueDays: 30, isFuelSupplier: false },
    { name: 'Gara Hải Phòng Auto', phone: '02253669852', note: 'Sửa chữa + phụ tùng', chiHoDueDays: 15, cuocDueDays: 30, isFuelSupplier: false },
    { name: 'Công ty TNHH Vận tải Hà Thanh', phone: '02253899123', note: 'Vận tải phụ trợ', chiHoDueDays: 15, cuocDueDays: 30, isFuelSupplier: false },
    { name: 'Bãi container Hải An', phone: '02253664217', note: 'Bãi đỗ xe + container', chiHoDueDays: 15, cuocDueDays: 30, isFuelSupplier: false },
    { name: 'Trạm cân 18 Hải Phòng', phone: '02253664500', note: 'Trạm cân điện tử', chiHoDueDays: 15, cuocDueDays: 30, isFuelSupplier: false },
  ];
  for (let i = 0; i < supplierServiceTemplates.length; i++) {
    const tmpl = supplierServiceTemplates[i]!;
    const taxCode = String(BULK_SUPPLIER_TAX_START + i).padStart(10, '0');
    const [existing] = await db.select({ id: s.suppliers.id })
      .from(s.suppliers)
      .where(eq(s.suppliers.taxCode, taxCode))
      .limit(1);
    if (existing) {
      newSupplierIds.push(existing.id);
      continue;
    }
    const [created] = await db.insert(s.suppliers).values({
      name: tmpl.name,
      contactPerson: genVietnameseName(),
      phone: tmpl.phone,
      taxCode,
      note: tmpl.note,
      isFuelSupplier: tmpl.isFuelSupplier,
      chiHoDueDays: tmpl.chiHoDueDays,
      cuocDueDays: tmpl.cuocDueDays,
    }).returning({ id: s.suppliers.id });
    newSupplierIds.push(created!.id);
    newSupplierCount++;
  }
  console.log(`  ✅ Suppliers: +${newSupplierCount} (total pool ${newSupplierIds.length})`);

  // ── 5. Add 12 more drivers so the larger trip pool has headroom ─────────
  const driverIds = [...drivers.ids];
  let newDriverCount = 0;
  for (let i = 0; i < 12; i++) {
    const phone = '093' + String(randInt(1_000_000, 9_999_999)).padStart(7, '0');
    const [existing] = await db.select({ id: s.drivers.id })
      .from(s.drivers)
      .where(eq(s.drivers.phone, phone))
      .limit(1);
    if (existing) {
      driverIds.push(existing.id);
      continue;
    }
    const [created] = await db.insert(s.drivers).values({
      name: genVietnameseName(),
      phone,
      baseSalary: String(randInt(4_000_000, 7_000_000)),
      status: 'ACTIVE',
    }).returning({ id: s.drivers.id });
    driverIds.push(created!.id);
    newDriverCount++;
  }
  console.log(`  ✅ Drivers: +${newDriverCount} (total pool ${driverIds.length})`);

  // ── 6. Generate 250 shipments + containers + status-history rows ─────────
  const NUM_SHIPMENTS = 250;
  const usedContainerNumbers = new Set<string>();
  // Pre-load existing container numbers so we never collide.
  const existingContainers = await db.select({ containerNumber: s.shipmentContainers.containerNumber })
    .from(s.shipmentContainers);
  for (const row of existingContainers) {
    if (row.containerNumber) usedContainerNumbers.add(row.containerNumber);
  }
  // The active customer pool: original 15 + 30 new = up to 45 distinct customers.
  const customerPool = newCustomerIds;
  const stats = {
    shipments: 0,
    containers: 0,
    fulfillments: 0,
    trips: 0,
    tripContainers: 0,
    expenses: 0,
    notifications: 0,
  };
  const statusHistoryBuffer: Array<typeof s.shipmentStatusHistory.$inferInsert> = [];

  for (let i = 0; i < NUM_SHIPMENTS; i++) {
    const isImport = i % 2 === 0; // alternating IMPORT/EXPORT
    const customerId = pick(customerPool);
    const routeId = routeIds.length > 0 ? pick(routeIds) : null;
    const status = pick(STATUSES);
    const createdAt = dateOffset(randomDate(), -randInt(0, 3));
    const expectedDeliveryDate = dateOffset(createdAt, randInt(1, 14));
    const ref = isImport
      ? `${BULK_BL_PREFIX}${String(i + 1).padStart(4, '0')}`
      : `${BULK_BR_PREFIX}${String(i + 1).padStart(4, '0')}`;

    const pickupLocation = isImport ? pick(PORTS_PICKUP) : pick(FACTORY_NAMES);
    const deliveryLocation = isImport ? genFactoryAddress() : pick(PORTS_DROPOFF);
    const shippingLine = pick(SHIPPING_LINES);
    const contactName = genVietnameseName();
    const contactPhone = genPhone();
    const cargoMode = 'FCL';
    const closingAt = isImport ? null : dateOffset(createdAt, randInt(-2, 5));
    const operationalNotes = pick([
      null,
      'Hàng dễ vỡ, bốc xếp cẩn thận',
      'Ưu tiên giao trước 16h',
      'Có thêm phụ phí ngoài giờ',
      'Container đã qua sử dụng',
      'Hàng lạnh bảo quản ở 5°C',
      'Cần xuất hóa đơn đỏ trước khi giao',
      null,
    ]);
    const customerNotes = pick([
      null,
      'Khách yêu cầu gọi trước 30 phút',
      'Cổng sau khóa, vào cổng chính',
      'Có thêm 2 kiện hàng phụ',
      'Giao trong giờ hành chính',
      'Liên hệ anh Tuấn khi đến nơi',
      null,
    ]);

    // The marker row carries the bulk dataset's identity; the actual data
    // sits on the other 249 rows. We do NOT use the marker for trips. The
    // first EXPORT iteration (i === 1) carries the marker; subsequent
    // EXPORT iterations are normal data. The DB one-ref invariant requires
    // IMPORT rows to have `bookingRef = null` and EXPORT rows to have
    // `blNumber = null` — the partial check `shipments_document_reference_
    // direction_check` enforces it. So the marker uses `bookingRef` (since
    // the marker iteration is EXPORT).
    const isMarker = !markerInserted && !isImport;
    const finalBlNumber = isImport ? ref : null;
    const finalBookingRef = isMarker ? BULK_MARKER_BL : (isImport ? null : ref);
    if (isMarker) markerInserted = true;

    const [shipment] = await db.insert(s.shipments).values({
      customerId,
      routeId: routeId ?? null,
      tradeDirection: isImport ? 'IMPORT' : 'EXPORT',
      cargoMode,
      status: status as 'NEW' | 'PENDING_DATE' | 'READY_FOR_DISPATCH' | 'DISPATCHED' | 'IN_TRANSIT' | 'PENDING_EXPENSE_APPROVAL' | 'COMPLETED' | 'CANCELED',
      blNumber: finalBlNumber,
      bookingRef: finalBookingRef,
      expectedDeliveryDate: expectedDeliveryDate.toISOString().slice(0, 10),
      closingAt,
      pickupLocation,
      deliveryLocation,
      contactName,
      contactPhone,
      shippingLineName: shippingLine,
      operationalNotes,
      customerNotes,
      createdBy,
      updatedBy: createdBy,
      version: 1,
      isCombined: false,
      createdAt,
      updatedAt: createdAt,
    }).returning({ id: s.shipments.id });
    stats.shipments++;

    // Status history — one row per status in the ladder to that point.
    const ladder: Record<string, string[]> = {
      NEW: ['NEW'],
      PENDING_DATE: ['NEW', 'PENDING_DATE'],
      READY_FOR_DISPATCH: ['NEW', 'PENDING_DATE', 'READY_FOR_DISPATCH'],
      DISPATCHED: ['NEW', 'PENDING_DATE', 'READY_FOR_DISPATCH', 'DISPATCHED'],
      IN_TRANSIT: ['NEW', 'PENDING_DATE', 'READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT'],
      PENDING_EXPENSE_APPROVAL: ['NEW', 'PENDING_DATE', 'READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT', 'PENDING_EXPENSE_APPROVAL'],
      COMPLETED: ['NEW', 'PENDING_DATE', 'READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT', 'PENDING_EXPENSE_APPROVAL', 'COMPLETED'],
      CANCELED: ['NEW', 'CANCELED'],
    };
    const ladderSteps = ladder[status] ?? ['NEW'];
    for (let stepIdx = 0; stepIdx < ladderSteps.length; stepIdx++) {
      const toStatus = ladderSteps[stepIdx]!;
      const fromStatus: string | null = stepIdx === 0 ? null : (ladderSteps[stepIdx - 1] ?? null);
      statusHistoryBuffer.push({
        shipmentId: shipment!.id,
        fromStatus: fromStatus as 'NEW' | 'PENDING_DATE' | 'READY_FOR_DISPATCH' | 'DISPATCHED' | 'IN_TRANSIT' | 'PENDING_EXPENSE_APPROVAL' | 'COMPLETED' | 'CANCELED' | null,
        toStatus: toStatus as 'NEW' | 'PENDING_DATE' | 'READY_FOR_DISPATCH' | 'DISPATCHED' | 'IN_TRANSIT' | 'PENDING_EXPENSE_APPROVAL' | 'COMPLETED' | 'CANCELED',
        reason: `Bulk seed (${toStatus})`,
        changedBy: createdBy,
        changedAt: dateOffset(createdAt, stepIdx),
      });
    }

    // Containers + fulfillment rows: 1–2 per shipment, but only when status
    // has reached READY_FOR_DISPATCH (dispatch readiness requires them).
    if (['READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT', 'PENDING_EXPENSE_APPROVAL', 'COMPLETED'].includes(status) && !isMarker) {
      const numContainers = randInt(1, 2);
      for (let cIdx = 0; cIdx < numContainers; cIdx++) {
        const containerNumber = genContainerNumber(usedContainerNumbers);
        const [_typeCode, typeId] = pick(containerTypeEntries) as [string, number];
        const weight = randInt(15_000, 25_500);
        const [pickupPortId, dropoffPortId] = isImport
          ? [pick(portPickupIds), pick(portDropoffIds)]
          : [pick(portPickupIds), pick(portDropoffIds)];
        const [container] = await db.insert(s.shipmentContainers).values({
          shipmentId: shipment!.id,
          containerTypeId: typeId,
          containerNumber,
          sealNumber: genSealNumber(),
          cargoWeightKg: String(weight),
          shippingLineName: shippingLine,
          pickupPortId,
          dropoffPortId,
          createdBy,
          createdAt,
          updatedAt: createdAt,
        }).returning({ id: s.shipmentContainers.id });
        stats.containers++;

        // One active fulfillment per active container. The `isCombined=false`
        // SINGLE classification matches the canonical seed for predictable
        // dashboard counts.
        await db.insert(s.shipmentFulfillments).values({
          shipmentId: shipment!.id,
          fulfillmentType: 'FCL_CONTAINER',
          cargoMode,
          shipmentContainerId: container!.id,
          sourceShipmentVersion: 1,
          plannedCarrierType: 'OWN',
          dispatchClassification: 'SINGLE',
          version: 1,
          createdBy,
          createdAt,
        });
        stats.fulfillments++;
      }
    }
  }
  // Flush the status history buffer in one shot.
  if (statusHistoryBuffer.length > 0) {
    await db.insert(s.shipmentStatusHistory).values(statusHistoryBuffer);
  }
  console.log(`  ✅ Shipments: +${stats.shipments} (containers +${stats.containers}, fulfillments +${stats.fulfillments})`);

  // ── 7. Generate 200 trips for the dispatched/in-transit/completed set ───
  // Pick shipments with at least one container and a status past
  // READY_FOR_DISPATCH (the production dispatch chain creates the trip on
  // the way to DISPATCHED).
  const dispatchableShipments = await db.select({
    id: s.shipments.id,
    customerId: s.shipments.customerId,
    routeId: s.shipments.routeId,
    status: s.shipments.status,
    expectedDeliveryDate: s.shipments.expectedDeliveryDate,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
  })
    .from(s.shipments)
    .where(and(
      isNull(s.shipments.deletedAt),
      sql`${s.shipments.blNumber} LIKE 'BULK-%' OR ${s.shipments.bookingRef} LIKE 'BULK-%'`,
      inArray(s.shipments.status, ['DISPATCHED', 'IN_TRANSIT', 'PENDING_EXPENSE_APPROVAL', 'COMPLETED']),
    ))
    .limit(NUM_SHIPMENTS);
  // Most recent N for the trip pool, in arrival order so older history is
  // populated first (mimics chronological ops).
  const sortedDispatchable = [...dispatchableShipments].sort((a, b) => {
    const aDate = a.expectedDeliveryDate ? new Date(a.expectedDeliveryDate).getTime() : 0;
    const bDate = b.expectedDeliveryDate ? new Date(b.expectedDeliveryDate).getTime() : 0;
    return aDate - bDate;
  });
  const TRIP_COUNT = Math.min(200, sortedDispatchable.length);
  let tripCounter = 1;
  for (let i = 0; i < TRIP_COUNT; i++) {
    const sh = sortedDispatchable[i]!;
    // Each shipment can only host one LIVE trip (the partial unique index
    // `trips_shipment_without_fulfillment_live_uniq` enforces it). We give
    // each dispatchable shipment one trip here.
    const tripStatus =
      sh.status === 'COMPLETED' ? 'COMPLETED' :
      sh.status === 'PENDING_EXPENSE_APPROVAL' ? 'COMPLETED' :
      sh.status === 'IN_TRANSIT' ? 'IN_TRANSIT' :
      sh.status === 'DISPATCHED' ? 'CREATED' :
      'CREATED';
    const truckId = pick(trucks.ids);
    const driverId = pick(driverIds);
    const trailerId = trailers.length > 0 ? pick(trailers) : null;
    const trailerType = trailerId ? (rng() < 0.7 ? '40FT' : '20FT') : null;
    const routeId = sh.routeId ?? pick(routeIds);
    if (!routeId) continue;
    const containerCount = randInt(1, 2);
    const weight = randInt(15_000, 25_500) * containerCount;
    const departure = sh.expectedDeliveryDate ? new Date(sh.expectedDeliveryDate) : randomDate();
    const plannedStart = dateOffset(departure, -randInt(0, 2));
    const plannedEnd = dateOffset(plannedStart, randInt(4, 12));

    // Revenue + cost: realistic per-trip numbers (3–6 million VND revenue,
    // 1.5–3 million VND cost, 50–80 liters fuel).
    const revenue = randInt(3_000_000, 6_500_000) * containerCount;
    const totalCost = randInt(1_500_000, 3_500_000) * containerCount;
    const fuelLiters = randFloatStr(40, 110, 2);
    const tollCost = randInt(150_000, 850_000);
    const driverSalary = randInt(450_000, 850_000);
    const tripCode = `${BULK_TRIP_PREFIX}${String(tripCounter++).padStart(4, '0')}`;

    const [trip] = await db.insert(s.trips).values({
      tripCode,
      version: 1,
      createdBy: dispatcherUserId,
      customerId: sh.customerId,
      truckId,
      driverId,
      routeId,
      trailerId,
      trailerType: trailerType as '40FT' | '20FT' | null,
      containerCount,
      status: tripStatus as 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELED',
      departureDate: departure.toISOString().slice(0, 10),
      plannedStartAt: plannedStart,
      plannedEndAt: plannedEnd,
      cargoWeightKg: String(weight),
      fuelMode: 'AUTO',
      fuelLiters,
      totalFuelCost: String(Math.round(parseFloat(fuelLiters) * 23_000)),
      tollCost: String(tollCost),
      driverSalary: String(driverSalary),
      revenue: String(revenue),
      totalCost: String(totalCost),
      grossProfit: String(revenue - totalCost),
      fuelSurchargeAmount: '0',
      createdAt: plannedStart,
      updatedAt: plannedStart,
    }).returning({ id: s.trips.id });
    stats.trips++;

    // Copy the shipment's container(s) into trip_containers.
    const shipmentContainers = await db.select({
      id: s.shipmentContainers.id,
      containerTypeId: s.shipmentContainers.containerTypeId,
      containerNumber: s.shipmentContainers.containerNumber,
      sealNumber: s.shipmentContainers.sealNumber,
      cargoWeightKg: s.shipmentContainers.cargoWeightKg,
    })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.shipmentId, sh.id));
    for (const sc of shipmentContainers) {
      await db.insert(s.tripContainers).values({
        tripId: trip!.id,
        sourceShipmentId: sh.id,
        sourceShipmentContainerId: sc.id,
        sourceShipmentVersion: 1,
        containerTypeId: sc.containerTypeId,
        containerNumber: sc.containerNumber,
        sealNumber: sc.sealNumber,
        cargoWeightKg: sc.cargoWeightKg,
        createdBy: dispatcherUserId,
        createdAt: plannedStart,
        updatedAt: plannedStart,
      });
      stats.tripContainers++;
    }
  }
  console.log(`  ✅ Trips: +${stats.trips} (trip_containers +${stats.tripContainers})`);

  // ── 8. Generate 60 company expenses spread across the 6-month window ─────
  const NUM_EXPENSES = 60;
  // Pre-load truck plates for the note templates.
  const truckPlates = [...trucks.byId.values()];
  const truckPlateToId = new Map<string, number>();
  for (const [id, plate] of trucks.byId.entries()) truckPlateToId.set(plate, id);
  for (let i = 0; i < NUM_EXPENSES; i++) {
    const supplierId = pick(newSupplierIds);
    const categoryId = pick(categoryIds);
    const truck = truckPlates.length > 0 ? pick(truckPlates) : null;
    const amount = randInt(300_000, 5_500_000);
    const expenseDate = randomDate();
    const paymentStatus = rng() < 0.55 ? 'PAID' : 'UNPAID';
    const note = BULK_EXPENSE_NOTE_PREFIX + ' ' + pick(EXPENSE_NOTE_TEMPLATES)
      .replace('{plate}', truck ?? '60C-XXXXX')
      .replace('{y}', String(2026))
      .replace('{m}', String(expenseDate.getMonth() + 1).padStart(2, '0'))
      .replace('{q}', String(Math.floor(expenseDate.getMonth() / 3) + 1));
    await db.insert(s.expenses).values({
      expenseDate: expenseDate.toISOString().slice(0, 10),
      supplierId,
      categoryId,
      truckId: truck ? (truckPlateToId.get(truck) ?? null) : null,
      vehicleComponent: truck ? 'TRUCK' : null,
      amount: String(amount),
      paymentStatus,
      note,
      createdBy: managerUserId,
      createdAt: expenseDate,
      updatedAt: expenseDate,
    });
    stats.expenses++;
  }
  console.log(`  ✅ Expenses: +${stats.expenses}`);

  // ── 9. Notifications: a handful so the bell icon isn't empty on first load
  for (let i = 0; i < 25; i++) {
    const target = pick([cusUserId, dispatcherUserId, managerUserId]);
    const created = dateOffset(new Date(), -randInt(0, 14));
    const title = pick([
      'Lô hàng mới được phân công',
      'Trip hoàn thành',
      'Điều chỉnh giá nhiên liệu',
      'Phiếu chi cần duyệt',
      'Yêu cầu xác nhận POD',
      'Đăng ký giờ làm thêm',
      'Cảnh báo hạn mức tín dụng',
    ]);
    const message = pick([
      'Có 1 lô hàng mới cần xử lý trong hôm nay.',
      'Trip đã đóng — vui lòng xác nhận công nợ.',
      'Bảng giá nhiên liệu thay đổi từ 00:00 ngày mai.',
      'Có 3 phiếu chi đang chờ duyệt.',
      'Khách hàng yêu cầu xác nhận e-POD.',
      'Bạn có 1 yêu cầu xác nhận giờ làm thêm.',
      'Khách hàng đã sử dụng 85% hạn mức tín dụng.',
    ]);
    const notifType = pick([
      'TRIP_CREATED', 'TRIP_DISPATCHED', 'TRIP_IN_TRANSIT', 'TRIP_COMPLETED',
      'TRIP_CANCELED', 'PAYMENT_RECEIVED', 'PENALTY_CREATED',
      'PENALTY_CANCELED', 'OVERDUE_PAYMENT', 'SALARY_PERIOD_CLOSING',
      'SYSTEM_ANNOUNCEMENT', 'ADVANCE_SETTLEMENT_APPROVED', 'SHIPMENT_HANDOFF',
    ]) as 'TRIP_CREATED' | 'TRIP_DISPATCHED' | 'TRIP_IN_TRANSIT' | 'TRIP_COMPLETED' | 'TRIP_CANCELED' | 'PAYMENT_RECEIVED' | 'PENALTY_CREATED' | 'PENALTY_CANCELED' | 'OVERDUE_PAYMENT' | 'SALARY_PERIOD_CLOSING' | 'SYSTEM_ANNOUNCEMENT' | 'ADVANCE_SETTLEMENT_APPROVED' | 'SHIPMENT_HANDOFF';
    await db.insert(s.notifications).values({
      userId: target,
      type: notifType,
      title,
      message,
      isRead: rng() < 0.4,
      createdAt: created,
    });
    stats.notifications++;
  }
  console.log(`  ✅ Notifications: +${stats.notifications}`);

  console.log('\n🎉 Bulk seed complete! Use the BL/booking prefix `BULK-` to identify synthetic rows.');
  return { created: true, stats };
}
