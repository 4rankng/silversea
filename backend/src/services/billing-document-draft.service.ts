import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, gte, lte, isNull, inArray, desc, or, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import { getSupplierStatement } from './statement.service';
import { customerTripReceivableAmount } from './ledger.service';
import {
  BILLABLE_TRIP_STATUSES,
  LoadingType,
} from '@tingting/shared';
import type { Tx } from './trip-shared';
import {
  postingChecksum,
  calculateVatSnapshot,
  buildTripSourceVersionToken,
  buildExpenseSourceVersionToken,
  documentVatTotals,
  VAT_TREATMENT_VERSION,
  buildTripBlockedReason,
  loadLatestPodStatusByTrip,
  type CustomerDebitTripCandidate,
} from './billing-document-shared.service';
import type {
  BillingDocumentDraft,
  BillingDraftBlockedTrip,
  BillingDraftLine,
  BillingLineRenderData,
  GenerateBillingDocumentInput,
} from '@tingting/shared';

/**
 * Billing document draft generation (preview, pre-save).
 *
 * Split out of billing-document.service.ts. Builds unsaved draft lines for each
 * entity type (customer debit note, customer payment statement, carrier payment
 * statement, supplier payment statement) from authoritative trip/expense
 * sources, together with the bulk render-data loaders (containers, legs, POD
 * status, declarations, approved fees) that feed line renderData.
 */
type DraftBuildResult = {
  lines: BillingDraftLine[];
  entityName: string;
  eligibilitySummary?: BillingDocumentDraft['eligibilitySummary'];
};

// ─── Generate (preview draft, pre-save) ───────────────────────────────────────

/**
 * Build AR debit-note lines for a customer + authoritative business-date range.
 * Each COMPLETED trip → a FREIGHT line (route + container separate) + its approved
 * ancillary sell fees (phí nộp hộ) → SERVICE_FEE lines.
 */
export async function buildCustomerDebitLines(customerId: number, from: string, to: string): Promise<DraftBuildResult> {
  const [customer] = await db.select({ id: s.customers.id, name: s.customers.name })
    .from(s.customers).where(and(eq(s.customers.id, customerId), isNull(s.customers.deletedAt)));
  if (!customer) throw new ApiError(404, 'Không tìm thấy khách hàng');
  const entityName = customer.name;

  const completionInRange = and(
    sql`${s.tripsComposite.completedAt} IS NOT NULL`,
    gte(sql`(${s.tripsComposite.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`, from),
    lte(sql`(${s.tripsComposite.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`, to),
  )!;
  const expenseInRange = sql`EXISTS (
    SELECT 1
    FROM ${s.tripExpenses} period_expense
    WHERE period_expense.trip_id = ${s.tripsComposite.id}
      AND period_expense.approval_status = 'APPROVED'
      AND period_expense.sell_amount > 0
      AND period_expense.expense_date BETWEEN ${from} AND ${to}
  )`;
  const trips = await db.select({
    id: s.tripsComposite.id,
    tripCode: s.tripsComposite.tripCode,
    customerId: s.tripsComposite.customerId,
    shipmentId: s.tripsComposite.shipmentId,
    fulfillmentId: s.tripsComposite.fulfillmentId,
    status: s.tripsComposite.status,
    departureDate: s.tripsComposite.departureDate,
    completionDate: sql<string | null>`to_char(${s.tripsComposite.completedAt} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`,
    revenue: s.tripsComposite.revenue,
    fuelSurchargeAmount: s.tripsComposite.fuelSurchargeAmount,
    routeName: s.routes.name,
    notes: s.tripsComposite.notes,
    truckPlate: s.trucks.licensePlate,
    trailerPlateNumber: s.trailers.licensePlate,
    externalPlateNumber: s.tripsComposite.externalPlateNumber,
    version: s.tripsComposite.version,
    vatRate: s.tripsComposite.vatRate,
    updatedAt: s.tripsComposite.updatedAt,
    financialPostingId: s.tripFinancialPostings.id,
    financialPostingVersion: s.tripFinancialPostings.version,
    financialPostingTripVersion: s.tripFinancialPostings.tripVersion,
    financialPostingReason: s.tripFinancialPostings.reason,
    financialPostingEffectiveAt: s.tripFinancialPostings.effectiveAt,
    shipmentCustomerId: s.shipments.customerId,
    tradeDirection: s.shipments.tradeDirection,
    billNumber: s.shipments.blNumber,
    factoryName: sql<string | null>`coalesce(${s.operationalSites.name}, ${s.shipments.factoryName})`,
    expectedDeliveryDate: s.shipments.expectedDeliveryDate,
    cargoVolumeCbm: s.shipments.cargoVolumeCbm,
    packageCount: s.shipments.packageCount,
    packageType: s.shipments.packageType,
  }).from(s.tripsComposite)
    .innerJoin(s.tripFinancialPostings, and(
      eq(s.tripFinancialPostings.tripId, s.tripsComposite.id),
      eq(s.tripFinancialPostings.status, 'ACTIVE'),
    ))
    .leftJoin(s.routes, eq(s.tripsComposite.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.tripsComposite.truckId, s.trucks.id))
    .leftJoin(s.trailers, eq(s.tripsComposite.trailerId, s.trailers.id))
    .leftJoin(s.shipments, eq(s.tripsComposite.shipmentId, s.shipments.id))
    .leftJoin(s.operationalSites, eq(s.shipments.operationalSiteId, s.operationalSites.id))
    .where(and(
      eq(s.tripsComposite.customerId, customerId),
      isNull(s.tripsComposite.deletedAt),
      or(completionInRange, expenseInRange)!,
    ))
    .orderBy(s.tripsComposite.completedAt, s.tripsComposite.id) as CustomerDebitTripCandidate[];

  const tripIds = trips.map((trip) => trip.id);
  const latestPodByTrip = await loadLatestPodStatusByTrip(tripIds);
  const declarationByShipment = await loadPrimaryDeclarationByShipment(
    [...new Set(trips
      .map((trip) => trip.shipmentId)
      .filter((shipmentId): shipmentId is number => shipmentId != null))],
  );
  const containersByTrip = await loadContainersByTrip(tripIds);
  const legsByTrip = await loadLegRenderDataByTrip(tripIds);
  const feesByTrip = await loadApprovedFeesByTrip(tripIds);

  const lines: BillingDraftLine[] = [];
  const blockedTrips: BillingDraftBlockedTrip[] = [];
  let sortOrder = 0;
  for (const trip of trips) {
    const blockedReason = buildTripBlockedReason(trip, customerId, latestPodByTrip.get(trip.id));
    if (blockedReason) {
      blockedTrips.push({
        tripId: trip.id,
        tripCode: trip.tripCode ?? null,
        reason: blockedReason,
      });
      continue;
    }
    const containerInfo = containersByTrip.get(trip.id) ?? [];
    const containers = containerNumbers(containerInfo);
    const unit = containerUnit(containerInfo);
    const renderData = buildTripRenderData({
      tripId: trip.id,
      trip,
      containers: containerInfo,
      legs: legsByTrip.get(trip.id),
      note: trip.notes ?? null,
    });
    renderData.deliveryDate = trip.expectedDeliveryDate ?? trip.completionDate ?? null;
    renderData.factoryName = trip.factoryName ?? null;
    renderData.tradeDirectionLabel = tradeDirectionLabel(trip.tradeDirection);
    renderData.billNumber = trip.billNumber ?? null;
    renderData.declarationNumber = trip.shipmentId != null
      ? declarationByShipment.get(trip.shipmentId) ?? null
      : null;
    renderData.quantityLabel = quantityLabelFromCandidate(trip, containerInfo);
    renderData.vehicleType = vehicleTypeLabel(trip, containerInfo);
    renderData.cargoVolumeCbm = trip.cargoVolumeCbm == null ? null : Number(trip.cargoVolumeCbm);
    renderData.freightAmount = trip.completionDate && trip.completionDate >= from && trip.completionDate <= to
      ? Number(trip.revenue ?? 0)
      : null;
    renderData.sourceVersion = buildTripSourceVersionToken(trip.version);
    renderData.sourceChangedAt = trip.updatedAt.toISOString();
    const checksum = postingChecksum({
      id: trip.financialPostingId,
      tripId: trip.id,
      version: trip.financialPostingVersion,
      tripVersion: trip.financialPostingTripVersion,
      reason: trip.financialPostingReason,
      effectiveAt: trip.financialPostingEffectiveAt,
    });
    renderData.financialPostingId = trip.financialPostingId;
    renderData.financialPostingVersion = trip.financialPostingVersion;
    renderData.postingChecksum = checksum;
    renderData.sourceVersion = checksum;
    renderData.sourceChangedAt = trip.financialPostingEffectiveAt.toISOString();
    if (trip.completionDate && trip.completionDate >= from && trip.completionDate <= to) {
      // Revenue and surcharge are already incl-VAT; split the combined amount once.
      const receivableAmount = customerTripReceivableAmount(trip.revenue, trip.fuelSurchargeAmount);
      const vat = calculateVatSnapshot(receivableAmount, trip.vatRate);
      lines.push({
        sourceType: 'TRIP', sourceId: trip.id, lineType: 'FREIGHT',
        // Trip code is NOT inlined here — it has its own "Số chứng từ" column
        // (renderData.tripCode). Inlining it caused "Cước vận chuyển TRP--" when the
        // route name was missing, which customers mistook for the description.
        description: `Cước vận chuyển${trip.routeName ? ` — ${trip.routeName}` : ''}`,
        typeLabel: 'Doanh thu',
        unit,
        routeName: trip.routeName ?? null,
        containerNumbers: containers,
        renderData,
        financialPostingId: trip.financialPostingId,
        financialPostingVersion: trip.financialPostingVersion,
        postingChecksum: checksum,
        baseAmount: receivableAmount,
        amountOverride: null, excluded: false, ...vat, sortOrder: sortOrder++,
      });
    }

    // Approved ancillary fees charged to customer (sell side) → phí nộp hộ
    const fees = (feesByTrip.get(trip.id) ?? []).filter(
      (fee) => fee.expenseDate != null && fee.expenseDate >= from && fee.expenseDate <= to,
    );
    for (const fee of fees) {
      const amt = Number(fee.sellAmount ?? 0);
      if (amt <= 0) continue;
      const vat = calculateVatSnapshot(amt, fee.vatRate);
      lines.push({
        sourceType: 'EXPENSE', sourceId: fee.id, lineType: 'SERVICE_FEE',
        description: fee.billingLabel ?? fee.name ?? fee.expenseType,
        typeLabel: 'Phí chi hộ',
        unit,
        routeName: trip.routeName ?? null, containerNumbers: containers,
        renderData: {
          ...renderData,
          documentCode: expenseDocumentCode(fee),
          note: fee.billingLabel ?? fee.name ?? fee.expenseType,
          recoverableSupplierName: fee.supplierName ?? null,
          recoverableFeeType: fee.billingLabel ?? fee.name ?? fee.expenseType,
          recoverableDocumentCode: expenseDocumentCode(fee),
          recoverableAmount: amt,
          sourceVersion: buildExpenseSourceVersionToken(fee),
          sourceChangedAt: fee.updatedAt?.toISOString() ?? null,
        },
        baseAmount: amt, amountOverride: null, excluded: false, ...vat, sortOrder: sortOrder++,
      });
    }
  }

  return {
    lines,
    entityName,
    eligibilitySummary: {
      includedTripCount: trips.length - blockedTrips.length,
      blockedTrips,
    },
  };
}

/**
 * Build customer payment-statement lines in the horizontal business shape:
 * each trip / shipment is one row, while freight and approved ancillary fees are
 * exposed as separate render variables for customer-specific table columns.
 */
async function buildCustomerPaymentStatementLines(customerId: number, from: string, to: string): Promise<DraftBuildResult> {
  const [customer] = await db.select({ id: s.customers.id, name: s.customers.name })
    .from(s.customers).where(and(eq(s.customers.id, customerId), isNull(s.customers.deletedAt)));
  if (!customer) throw new ApiError(404, 'Không tìm thấy khách hàng');
  const entityName = customer.name;

  const trips = await db.select({
    id: s.tripsComposite.id, tripCode: s.tripsComposite.tripCode, departureDate: s.tripsComposite.departureDate,
    completionDate: sql<string | null>`to_char(${s.tripsComposite.completedAt} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`,
    revenue: s.tripsComposite.revenue, fuelSurchargeAmount: s.tripsComposite.fuelSurchargeAmount, routeName: s.routes.name, notes: s.tripsComposite.notes,
    truckPlate: s.trucks.licensePlate, externalPlateNumber: s.tripsComposite.externalPlateNumber,
  }).from(s.tripsComposite)
    .leftJoin(s.routes, eq(s.tripsComposite.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.tripsComposite.truckId, s.trucks.id))
    .where(and(
      eq(s.tripsComposite.customerId, customerId),
      inArray(s.tripsComposite.status, [...BILLABLE_TRIP_STATUSES]),
      isNull(s.tripsComposite.deletedAt),
      or(
        and(
          sql`${s.tripsComposite.completedAt} IS NOT NULL`,
          gte(sql`(${s.tripsComposite.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`, from),
          lte(sql`(${s.tripsComposite.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`, to),
        ),
        sql`EXISTS (
          SELECT 1
          FROM ${s.tripExpenses} period_expense
          WHERE period_expense.trip_id = ${s.tripsComposite.id}
            AND period_expense.approval_status = 'APPROVED'
            AND period_expense.sell_amount > 0
            AND period_expense.expense_date BETWEEN ${from} AND ${to}
        )`,
      )!,
    ))
    .orderBy(s.tripsComposite.completedAt, s.tripsComposite.id);

  const tripIds = trips.map((t) => t.id);
  const containersByTrip = await loadContainersByTrip(tripIds);
  const legsByTrip = await loadLegRenderDataByTrip(tripIds);
  const feesByTrip = await loadApprovedFeesByTrip(tripIds);

  const lines: BillingDraftLine[] = [];
  let sortOrder = 0;
  for (const trip of trips) {
    const containerInfo = containersByTrip.get(trip.id) ?? [];
    const containers = containerNumbers(containerInfo);
    const approvedFees = (feesByTrip.get(trip.id) ?? [])
      .filter((fee) => fee.expenseDate != null && fee.expenseDate >= from && fee.expenseDate <= to)
      .map((fee) => ({
        label: fee.billingLabel ?? fee.name ?? fee.expenseType,
        amount: Number(fee.sellAmount ?? 0),
      }))
      .filter((fee) => fee.amount > 0);
    const freightAmount = trip.completionDate && trip.completionDate >= from && trip.completionDate <= to
      ? Number(trip.revenue ?? 0)
      : 0;
    const serviceFeeAmount = approvedFees.reduce((sum, fee) => sum + fee.amount, 0);
    const totalAmount = freightAmount + serviceFeeAmount;
    const serviceFeeDescription = approvedFees.map((fee) => fee.label).join(', ') || null;
    const renderData = {
      ...buildTripRenderData({
        tripId: trip.id,
        trip,
        containers: containerInfo,
        legs: legsByTrip.get(trip.id),
        note: trip.notes ?? null,
      }),
      freightAmount,
      serviceFeeAmount: serviceFeeAmount || null,
      totalAmount,
      serviceFeeDescription,
    };

    lines.push({
      sourceType: 'TRIP', sourceId: trip.id, lineType: 'FREIGHT',
      description: `Cước vận chuyển${trip.routeName ? ` — ${trip.routeName}` : ''}${serviceFeeDescription ? `; ${serviceFeeDescription}` : ''}`,
      typeLabel: serviceFeeAmount > 0 ? 'Cước + chi hộ' : 'Doanh thu',
      unit: 'lô',
      routeName: trip.routeName ?? null,
      containerNumbers: containers,
      renderData,
      baseAmount: totalAmount,
      amountOverride: null,
      excluded: false,
      sortOrder: sortOrder++,
    });
  }

  return { lines, entityName };
}

/** Build AP carrier lines: trips we outsourced to this carrier (externalCarrierId). */
async function buildCarrierPaymentLines(carrierId: number, from: string, to: string): Promise<DraftBuildResult> {
  const [carrier] = await db.select({ id: s.customers.id, name: s.customers.name })
    .from(s.customers).where(and(eq(s.customers.id, carrierId), isNull(s.customers.deletedAt)));
  if (!carrier) throw new ApiError(404, 'Không tìm thấy đối tác vận chuyển');
  const entityName = carrier.name;

  const trips = await db.select({
    id: s.tripsComposite.id, tripCode: s.tripsComposite.tripCode, departureDate: s.tripsComposite.departureDate,
    externalFreightCost: s.tripsComposite.externalFreightCost, routeName: s.routes.name,
  }).from(s.tripsComposite).leftJoin(s.routes, eq(s.tripsComposite.routeId, s.routes.id))
    .where(and(
      eq(s.tripsComposite.externalEntityId, carrierId),
      inArray(s.tripsComposite.status, [...BILLABLE_TRIP_STATUSES]),
      isNull(s.tripsComposite.deletedAt),
      sql`${s.tripsComposite.completedAt} IS NOT NULL`,
      gte(sql`(${s.tripsComposite.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`, from),
      lte(sql`(${s.tripsComposite.completedAt} at time zone 'Asia/Ho_Chi_Minh')::date`, to),
    )).orderBy(s.tripsComposite.completedAt);

  const containersByTrip = await loadContainersByTrip(trips.map((t) => t.id));

  const lines: BillingDraftLine[] = [];
  let sortOrder = 0;
  for (const trip of trips) {
    const amt = Number(trip.externalFreightCost ?? 0);
    if (amt <= 0) continue;
    lines.push({
      sourceType: 'TRIP', sourceId: trip.id, lineType: 'FREIGHT',
      description: `Cước thuê ngoài${trip.routeName ? ` — ${trip.routeName}` : ''}`,
      typeLabel: 'Doanh thu',
      unit: 'lần',
      routeName: trip.routeName ?? null,
      containerNumbers: containerNumbers(containersByTrip.get(trip.id) ?? []),
      baseAmount: amt, amountOverride: null, excluded: false, sortOrder: sortOrder++,
    });
  }
  return { lines, entityName };
}

/** Build AP supplier lines from the existing supplier statement (payable accruals). */
async function buildSupplierPaymentLines(supplierId: number, from: string, to: string): Promise<DraftBuildResult> {
  const statement = await getSupplierStatement(supplierId, from, to);
  if (!statement) throw new ApiError(404, 'Không tìm thấy nhà cung cấp');
  const entityName = statement.supplier.name;

  // Only payable accruals (credit > 0); exclude settlement payments.
  const lines: BillingDraftLine[] = [];
  let sortOrder = 0;
  for (const row of statement.ledgerRows) {
    const credit = Number(row.credit ?? 0);
    if (credit <= 0) continue;
    lines.push({
      sourceType: 'EXPENSE', sourceId: row.txnId ?? null, lineType: 'SERVICE_FEE',
      description: row.note || 'Chi phí nhà cung cấp',
      typeLabel: 'Phí chi hộ',
      unit: 'lần',
      routeName: null, containerNumbers: null,
      baseAmount: credit, amountOverride: null, excluded: false, sortOrder: sortOrder++,
    });
  }
  return { lines, entityName };
}

type ContainerRenderInfo = { containerNumber: string | null; containerTypeCode: string | null; containerTypeName: string | null };
type LegRenderInfo = { origin: string | null; destination: string | null; loadingType: LoadingType | null };
type ApprovedFeeRenderInfo = {
  tripId: number;
  id: number;
  sellAmount: string | null;
  expenseType: string;
  billingLabel: string | null;
  name: string | null;
  supplierName: string | null;
  vatRate: string | null;
  invoiceNumber: string | null;
  declarationNumber: string | null;
  approvalStatus: string | null;
  expenseDate: string | null;
  updatedAt: Date | null;
};

function tradeDirectionLabel(value: 'IMPORT' | 'EXPORT' | null): string | null {
  if (value === 'IMPORT') return 'Nhập';
  if (value === 'EXPORT') return 'Xuất';
  return null;
}

function quantityLabelFromCandidate(
  candidate: CustomerDebitTripCandidate,
  containers: ContainerRenderInfo[],
): string | null {
  const containerList = containerNumbers(containers);
  if (containerList && containerList.length > 0) return containerList.join(', ');
  if (candidate.packageCount && candidate.packageCount > 0) {
    return `${candidate.packageCount}${candidate.packageType ? ` ${candidate.packageType}` : ' kiện'}`;
  }
  return null;
}

function vehicleTypeLabel(
  candidate: CustomerDebitTripCandidate,
  containers: ContainerRenderInfo[],
): string | null {
  const unit = containerUnit(containers);
  if (unit !== 'cont') return unit;
  if (candidate.packageCount && candidate.packageCount > 0) return 'LCL';
  return null;
}

export function containerNumbers(containers: ContainerRenderInfo[]): string[] | null {
  const list = containers.map((c) => c.containerNumber).filter((n): n is string => Boolean(n));
  return list.length > 0 ? list : null;
}

export function containerUnit(containers: ContainerRenderInfo[]): string {
  const c20 = countContainers(containers, '20');
  const c40 = countContainers(containers, '40');
  if (c20 > 0 && c40 === 0) return "20'";
  if (c40 > 0 && c20 === 0) return "40'";
  return 'cont';
}

export function expenseDocumentCode(fee: Pick<ApprovedFeeRenderInfo, 'invoiceNumber' | 'declarationNumber'>): string | null {
  return fee.invoiceNumber?.trim() || fee.declarationNumber?.trim() || null;
}

function countContainers(containers: ContainerRenderInfo[], size: '20' | '40'): number {
  return containers.filter((c) => {
    const label = `${c.containerTypeCode ?? ''} ${c.containerTypeName ?? ''}`.toUpperCase();
    return label.startsWith(size) || label.includes(`${size}'`) || label.includes(`${size}FT`);
  }).length;
}

export function splitRouteName(routeName: string): { origin: string; destination: string } | null {
  const normalized = routeName.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const separator = normalized.match(/\s[-–—]\s/);
  if (!separator || separator.index === undefined) return null;
  const origin = normalized.slice(0, separator.index).trim();
  const destination = normalized.slice(separator.index + separator[0].length).trim();
  return origin && destination ? { origin, destination } : null;
}

export function buildTripRenderData(input: {
  tripId?: number;
  trip: {
    tripCode: string | null;
    departureDate: string;
    routeName: string | null;
    notes: string | null;
    truckPlate: string | null;
    externalPlateNumber: string | null;
    fuelSurchargeAmount?: string | null;
  };
  containers: ContainerRenderInfo[];
  legs?: LegRenderInfo;
  note?: string | null;
}): BillingLineRenderData {
  const containerCount = input.containers.length;
  const routeParts = splitRouteName(input.trip.routeName ?? '');
  return {
    tripId: input.tripId ?? null,
    tripCode: input.trip.tripCode ?? null,
    departureDate: input.trip.departureDate,
    truckPlate: input.trip.truckPlate ?? input.trip.externalPlateNumber ?? null,
    // BK VIETSUN-style "Đóng / Trả" mapping. HANG = loaded leg (ĐÓNG) = "delivering",
    // VO = empty return leg (TRẢ) = "returning without cargo". Null if the source
    // billing line has no legs (e.g. ADHOC service fees) — users hide the column
    // for those templates.
    actionType: input.legs?.loadingType === 'HANG' ? 'ĐÓNG'
              : input.legs?.loadingType === 'VO'   ? 'TRẢ'
              : null,
    origin: input.legs?.origin ?? routeParts?.origin ?? null,
    destination: routeParts?.destination ?? input.trip.routeName ?? input.legs?.destination ?? null,
    deliveryAddress: input.legs?.destination ?? null,
    container20Count: countContainers(input.containers, '20') || null,
    container40Count: countContainers(input.containers, '40') || null,
    containerCount: containerCount || null,
    fuelSurchargeAmount: Number(input.trip.fuelSurchargeAmount ?? 0),
    note: input.note ?? null,
  };
}

export async function loadContainersByTrip(
  tripIds: number[],
  executor: Pick<Tx, 'select'> | typeof db = db,
): Promise<Map<number, ContainerRenderInfo[]>> {
  const map = new Map<number, ContainerRenderInfo[]>();
  if (tripIds.length === 0) return map;
  const rows = await executor.select({
    tripId: s.tripContainers.tripId,
    containerNumber: s.tripContainers.containerNumber,
    containerTypeCode: s.containerTypes.code,
    containerTypeName: s.containerTypes.name,
  }).from(s.tripContainers)
    .leftJoin(s.containerTypes, eq(s.tripContainers.containerTypeId, s.containerTypes.id))
    .where(inArray(s.tripContainers.tripId, tripIds));
  for (const r of rows) {
    if (!map.has(r.tripId)) map.set(r.tripId, []);
    map.get(r.tripId)!.push({
      containerNumber: r.containerNumber,
      containerTypeCode: r.containerTypeCode ?? null,
      containerTypeName: r.containerTypeName ?? null,
    });
  }
  return map;
}

export async function loadLegRenderDataByTrip(
  tripIds: number[],
  executor: Pick<Tx, 'select'> | typeof db = db,
): Promise<Map<number, LegRenderInfo>> {
  const map = new Map<number, LegRenderInfo>();
  if (tripIds.length === 0) return map;
  const rows = await executor.select({
    tripId: s.tripLegs.tripId,
    sequence: s.tripLegs.sequence,
    origin: s.tripLegs.origin,
    destination: s.tripLegs.destination,
    loadingType: s.tripLegs.loadingType,
  }).from(s.tripLegs)
    .where(inArray(s.tripLegs.tripId, tripIds))
    .orderBy(s.tripLegs.tripId, s.tripLegs.sequence);
  for (const r of rows) {
    const existing = map.get(r.tripId);
    if (!existing) {
      map.set(r.tripId, { origin: r.origin, destination: r.destination, loadingType: r.loadingType as LoadingType });
    } else {
      existing.destination = r.destination;
      // Last-leg loadingType wins (matches the "destination" semantics — same leg).
      existing.loadingType = r.loadingType as LoadingType;
    }
  }
  return map;
}

async function loadPrimaryDeclarationByShipment(
  shipmentIds: number[],
  executor: Pick<Tx, 'select'> | typeof db = db,
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (shipmentIds.length === 0) return map;
  const rows = await executor.select({
    shipmentId: s.shipmentDeclarations.shipmentId,
    declarationNumber: s.shipmentDeclarations.declarationNumber,
    issuedAt: s.shipmentDeclarations.issuedAt,
    updatedAt: s.shipmentDeclarations.updatedAt,
    id: s.shipmentDeclarations.id,
  }).from(s.shipmentDeclarations)
    .where(inArray(s.shipmentDeclarations.shipmentId, shipmentIds))
    .orderBy(
      s.shipmentDeclarations.shipmentId,
      desc(s.shipmentDeclarations.issuedAt),
      desc(s.shipmentDeclarations.updatedAt),
      desc(s.shipmentDeclarations.id),
    );
  for (const row of rows) {
    if (!row.declarationNumber || map.has(row.shipmentId)) continue;
    map.set(row.shipmentId, row.declarationNumber);
  }
  return map;
}

/** Bulk-load approved ancillary fees (sell side) grouped by trip — avoids N+1 per trip. */
async function loadApprovedFeesByTrip(tripIds: number[]): Promise<Map<number, ApprovedFeeRenderInfo[]>> {
  const map = new Map<number, ApprovedFeeRenderInfo[]>();
  if (tripIds.length === 0) return map;
  const rows = await db.select({
    tripId: s.tripExpenses.tripId, id: s.tripExpenses.id,
    sellAmount: s.tripExpenses.sellAmount, expenseType: s.tripExpenses.expenseType,
    invoiceNumber: s.tripExpenses.invoiceNumber, declarationNumber: s.tripExpenses.declarationNumber,
    approvalStatus: s.tripExpenses.approvalStatus, expenseDate: s.tripExpenses.expenseDate,
    updatedAt: s.tripExpenses.updatedAt,
    billingLabel: s.forwarderExpenseTypes.billingLabel, name: s.forwarderExpenseTypes.name,
    vatRate: s.forwarderExpenseTypes.vatRate,
    supplierName: s.suppliers.name,
  }).from(s.tripExpenses)
    .leftJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
    .leftJoin(s.suppliers, eq(s.tripExpenses.supplierId, s.suppliers.id))
    .where(and(inArray(s.tripExpenses.tripId, tripIds), inArray(s.tripExpenses.approvalStatus, ['RECORDED', 'APPROVED'])));
  for (const f of rows) {
    if (!map.has(f.tripId)) map.set(f.tripId, []);
    map.get(f.tripId)!.push(f);
  }
  return map;
}

export async function generateDraft(input: GenerateBillingDocumentInput): Promise<BillingDocumentDraft> {
  const { type, entityType, entityId, rangeFrom: from, rangeTo: to } = input;

  let result: DraftBuildResult;

  if (type === 'DEBIT_NOTE' && entityType === 'CUSTOMER') {
    result = await buildCustomerDebitLines(entityId, from, to);
  } else if (type === 'PAYMENT_STATEMENT' && entityType === 'CUSTOMER') {
    const [customer] = await db.select({ isCarrier: s.customers.isCarrier })
      .from(s.customers)
      .where(and(eq(s.customers.id, entityId), isNull(s.customers.deletedAt)))
      .limit(1);
    result = customer?.isCarrier
      ? await buildCarrierPaymentLines(entityId, from, to)
      : await buildCustomerPaymentStatementLines(entityId, from, to);
  } else if (type === 'PAYMENT_STATEMENT' && entityType === 'VENDOR') {
    result = await buildSupplierPaymentLines(entityId, from, to);
  } else {
    // DEBIT_NOTE + VENDOR is not meaningful (debit notes are customer-facing AR only).
    throw new ApiError(400, 'Loại tài liệu không hợp lệ cho đối tượng này');
  }

  const totals = documentVatTotals(result.lines);
  return {
    type,
    entityType,
    entityId,
    entityName: result.entityName,
    rangeFrom: from,
    rangeTo: to,
    lines: result.lines,
    totalInclVat: totals.gross,
    totalNet: totals.net,
    totalTax: totals.tax,
    totalGross: totals.gross,
    vatTreatmentVersion: VAT_TREATMENT_VERSION,
    eligibilitySummary: result.eligibilitySummary ?? null,
  };
}
