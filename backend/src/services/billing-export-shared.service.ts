// Shared helpers for the billing-export leaf family (legacy / debit-note /
// templated XLSX renderers + identity): description/date formatting, the
// Vietnamese amount-in-words renderer, per-column value resolution, and the
// render-data enrichment loader. Extracted from billing-export.service.ts
// verbatim (pure code movement); leaves import these one-way.
import { db } from '../db';
import * as s from '../db/schema';
import { inArray, and, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { canonicalFreightDescription } from '@tingting/shared';
import type { BillingDocumentLine, DebitNoteTemplateColumn } from '@tingting/shared';
import {
  effectiveAmount,
  loadContainersByTrip,
  loadLegRenderDataByTrip,
  buildTripRenderData,
  containerNumbers,
  expenseDocumentCode,
  splitRouteName,
} from './billing-document.service';

const SERVICE_FEE_EXPORT_LABELS: Record<string, string> = {
  LIFTING: 'Phí nâng container',
  LOWERING: 'Phí hạ container',
  CUSTOMS: 'Phí hải quan',
  INFRASTRUCTURE: 'Phí hạ tầng',
  WEIGHING: 'Phí cân hàng',
  INSPECTION: 'Phí kiểm hóa',
  INSPECTION_SVC: 'Phí dịch vụ kiểm hóa',
  OTHER: 'Phí chi hộ khác',
};

export function exportDescription(line: BillingDocumentLine): string {
  const raw = line.description?.trim() ?? '';
  if (line.lineType !== 'SERVICE_FEE') return raw;
  return SERVICE_FEE_EXPORT_LABELS[raw.toUpperCase()] ?? raw;
}

export function formatVietnameseDate(raw: string): string {
  const [year, month, day] = raw.split('-');
  if (!year || !month || !day) return raw;
  return `${day}/${month}/${year}`;
}

export function formatMonthYear(raw: string): string {
  const [year, month] = raw.split('-');
  if (!year || !month) return raw;
  return `${month}.${year}`;
}

const VIETNAMESE_DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const VIETNAMESE_TRIPLE_UNITS = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ', 'tỷ tỷ'];

function readVietnameseTriple(value: number, forceHundreds: boolean): string {
  const hundred = Math.floor(value / 100);
  const ten = Math.floor((value % 100) / 10);
  const unit = value % 10;
  const parts: string[] = [];

  if (hundred > 0 || forceHundreds) {
    parts.push(`${VIETNAMESE_DIGITS[hundred]} trăm`);
  }

  if (ten > 1) {
    parts.push(`${VIETNAMESE_DIGITS[ten]} mươi`);
    if (unit === 1) parts.push('mốt');
    else if (unit === 5) parts.push('lăm');
    else if (unit > 0) parts.push(VIETNAMESE_DIGITS[unit]);
  } else if (ten === 1) {
    parts.push('mười');
    if (unit === 5) parts.push('lăm');
    else if (unit > 0) parts.push(VIETNAMESE_DIGITS[unit]);
  } else if (unit > 0) {
    if (hundred > 0 || forceHundreds) parts.push('lẻ');
    parts.push(VIETNAMESE_DIGITS[unit]);
  }

  return parts.join(' ');
}

function sentenceCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function amountToVietnameseWords(amount: number): string {
  const rounded = Math.round(amount);
  if (!Number.isFinite(rounded)) return '';
  if (rounded === 0) return 'Không đồng';

  const sign = rounded < 0 ? 'Âm ' : '';
  let remaining = Math.abs(rounded);
  const triples: number[] = [];
  while (remaining > 0) {
    triples.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }

  const words: string[] = [];
  for (let idx = triples.length - 1; idx >= 0; idx--) {
    const triple = triples[idx];
    if (triple === 0) continue;
    const hasHigherGroup = words.length > 0;
    const text = readVietnameseTriple(triple, hasHigherGroup && triple < 100);
    const unit = VIETNAMESE_TRIPLE_UNITS[idx] ?? '';
    words.push(unit ? `${text} ${unit}` : text);
  }

  return `${sign}${sentenceCase(words.join(' '))} đồng`;
}

export function renderColumnValue(line: BillingDocumentLine, col: DebitNoteTemplateColumn, rowIndex: number): string | number | Date | null {
  const data = line.renderData ?? {};
  const routeParts = splitRouteName(line.routeName ?? '');
  const parseDateValue = (raw: string | null | undefined): string | Date | null => {
    if (!raw) return null;
    const [year, month, day] = String(raw).split('-').map(Number);
    const date = year && month && day
      ? new Date(Date.UTC(year, month - 1, day))
      : new Date(`${raw}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(raw) : date;
  };
  switch (col.variable) {
    case 'rowIndex': return rowIndex;
    case 'departureDate': return parseDateValue(data.departureDate);
    case 'deliveryDate': return parseDateValue(data.deliveryDate);
    case 'truckPlate': return data.truckPlate ?? null;
    case 'vehicleType': return data.vehicleType ?? null;
    case 'actionType': return data.actionType ?? null;
    case 'origin': return data.origin ?? routeParts?.origin ?? null;
    case 'destination': return data.destination ?? routeParts?.destination ?? line.routeName ?? null;
    case 'deliveryAddress': return data.deliveryAddress ?? null;
    case 'factoryName': return data.factoryName ?? null;
    case 'tradeDirectionLabel': return data.tradeDirectionLabel ?? null;
    case 'billNumber': return data.billNumber ?? null;
    case 'declarationNumber': return data.declarationNumber ?? null;
    case 'quantityLabel': return data.quantityLabel ?? null;
    case 'container20Count': return data.container20Count ?? null;
    case 'container40Count': return data.container40Count ?? null;
    case 'containerCount': return data.containerCount ?? (line.containerNumbers?.length || null);
    case 'containerNumbers': return (line.containerNumbers ?? []).join(', ') || null;
    case 'cargoVolumeCbm': return data.cargoVolumeCbm ?? null;
    case 'routeName': return line.routeName ?? null;
    case 'description': return exportDescription(line);
    case 'lineTypeLabel': return line.typeLabel;
    case 'unit': return line.unit;
    case 'amount': {
      const amount = effectiveAmount(line) || 0;
      if (col.id === 'don_gia') {
        const qty = Number(data.containerCount ?? line.containerNumbers?.length ?? 1);
        return qty > 1 ? Math.round(amount / qty) : amount;
      }
      return amount;
    }
    case 'deliveryFeeAmount': return data.deliveryFeeAmount ?? null;
    case 'freightAmount': return data.freightAmount ?? null;
    case 'portFeeAmount': return data.portFeeAmount ?? null;
    case 'otherServiceFeeAmount': return data.otherServiceFeeAmount ?? null;
    case 'fuelSurchargeAmount': return data.fuelSurchargeAmount ?? null;
    case 'serviceFeeAmount': return data.serviceFeeAmount ?? null;
    case 'totalAmount': return data.totalAmount ?? (effectiveAmount(line) || 0);
    case 'serviceFeeDescription': return data.serviceFeeDescription ?? null;
    case 'recoverableSupplierName': return data.recoverableSupplierName ?? null;
    case 'recoverableFeeType': return data.recoverableFeeType ?? null;
    case 'recoverableDocumentCode': return data.recoverableDocumentCode ?? null;
    case 'recoverableAmount': return data.recoverableAmount ?? null;
    case 'note': return data.note ?? null;
    case 'documentCode': return data.documentCode ?? null;
    case 'tripCode':
      return col.id === 'chung_tu'
        ? data.documentCode ?? null
        : data.tripCode ?? data.billNumber ?? data.declarationNumber ?? null;
    default: return null;
  }
}

/** FB-094 / cards 161026232429: frozen Debit Note lines issued before the plate
 *  fix carry no renderData and no sourceId, so the BKS / loại xe cells rendered
 *  empty. Resolve them at render time through the document's OWN lot claims
 *  (debit_note_lots): a single-lot note by identity, a multi-lot consolidated
 *  note by the lot code the frozen builder stamped into the description.
 *  Anything unresolved is left untouched — never a guessed plate. */
type LegacyFrozenLotRenderInfo = { truckPlate: string | null; vehicleType: string | null };

async function loadLegacyFrozenLotRenderInfo(
  lines: readonly BillingDocumentLine[],
): Promise<Map<number, Map<string, LegacyFrozenLotRenderInfo>>> {
  const byDocument = new Map<number, Map<string, LegacyFrozenLotRenderInfo>>();
  const documentIds = [...new Set(lines
    .filter((line) => line.sourceType === 'ADHOC' && !line.renderData && line.documentId != null)
    .map((line) => Number(line.documentId))
    .filter((id) => Number.isFinite(id) && id > 0))];
  if (documentIds.length === 0) return byDocument;
  const rows = await db.select({
    documentId: s.debitNoteLots.documentId,
    shipmentId: s.debitNoteLots.shipmentId,
    shipmentCode: s.shipments.shipmentCode,
    billingTruckNo: s.shipments.billingTruckNo,
    revVehicleClassName: s.vehicleSizeClasses.name,
    revVehicleClassCode: s.vehicleSizeClasses.code,
  }).from(s.debitNoteLots)
    .innerJoin(s.shipments, eq(s.shipments.id, s.debitNoteLots.shipmentId))
    .leftJoin(s.vehicleSizeClasses, eq(s.vehicleSizeClasses.id, s.shipments.revVehicleClassId))
    .where(and(
      inArray(s.debitNoteLots.documentId, documentIds),
      isNull(s.debitNoteLots.releasedAt),
    ));
  for (const row of rows) {
    const info: LegacyFrozenLotRenderInfo = {
      // Review M2 — legacy frozen lines keep their ORIGINAL rendering law
      // (billing plate or nothing); the spec 23/10 BKS fallback is
      // materialized at FREEZE time for new documents (shipment-cost-lock),
      // never applied retroactively to already-issued ones.
      truckPlate: row.billingTruckNo?.trim() || null,
      vehicleType: row.revVehicleClassName ?? row.revVehicleClassCode ?? null,
    };
    let lots = byDocument.get(row.documentId);
    if (!lots) {
      lots = new Map();
      byDocument.set(row.documentId, lots);
    }
    // Both keys the frozen builder can name a lot by: the lot code, or its id.
    lots.set(row.shipmentCode ?? String(row.shipmentId), info);
    lots.set(String(row.shipmentId), info);
  }
  return byDocument;
}

const FROZEN_LOT_CODE_IN_DESCRIPTION = /— lô (\S+) \(chốt từ snapshot khóa lô\)\s*$/;

function legacyFrozenLotInfo(
  line: BillingDocumentLine,
  byDocument: Map<number, Map<string, LegacyFrozenLotRenderInfo>>,
): LegacyFrozenLotRenderInfo | null {
  const lots = line.documentId != null ? byDocument.get(Number(line.documentId)) : undefined;
  if (!lots) return null;
  const lotCodes = [...new Set(lots.keys())];
  if (lotCodes.length === 0) return null;
  const lotCode = FROZEN_LOT_CODE_IN_DESCRIPTION.exec(line.description)?.[1];
  if (lotCode) return lots.get(lotCode) ?? null;
  // No lot code in the description (single-lot note): only one lot can own it.
  return lots.size === 1 ? lots.get(lotCodes[0]!) ?? null : null;
}

/**
 * Card 171026004332: which side of the lane a document is addressed to.
 * `AR` = the customer note (BKS báo khách + loại xe tính cước THU); `AP` = the
 * carrier/vendor payable statement (BKS thực tế + loại xe tính cước TRẢ).
 */
export type BillingExportPerspective = 'AR' | 'AP';

/**
 * Resolve the perspective of a document on its way out, mirroring the explicit
 * dispatch createDraft uses for carrier statements: a VENDOR document is
 * payable, and a CUSTOMER payment statement is payable only when that customer
 * is a carrier (everything else, including every Debit Note, is receivable).
 * An unknown counterparty stays AR — the customer-facing reading.
 */
export async function resolveBillingExportPerspective(doc: {
  type: string;
  entityType: string;
  entityId: number;
}): Promise<BillingExportPerspective> {
  if (doc.entityType === 'VENDOR') return 'AP';
  if (doc.type !== 'PAYMENT_STATEMENT' || doc.entityType !== 'CUSTOMER') return 'AR';
  const [counterparty] = await db.select({ isCarrier: s.customers.isCarrier })
    .from(s.customers)
    .where(and(eq(s.customers.id, doc.entityId), isNull(s.customers.deletedAt)))
    .limit(1);
  return counterparty?.isCarrier ? 'AP' : 'AR';
}

export async function enrichLinesForDebitNoteRender(
  lines: BillingDocumentLine[],
  perspective: BillingExportPerspective = 'AR',
): Promise<BillingDocumentLine[]> {
  const normalizedLines = lines.map((line) => ({
    ...line,
    description: canonicalFreightDescription(line),
  }));
  const revVehicleClass = alias(s.vehicleSizeClasses, 'billing_export_rev_vehicle_class');
  const costVehicleClass = alias(s.vehicleSizeClasses, 'billing_export_cost_vehicle_class');
  const directTripIds = normalizedLines
    .filter((line) => line.sourceType === 'TRIP' && line.sourceId && !line.renderData)
    .map((line) => Number(line.sourceId))
    .filter((id) => Number.isFinite(id) && id > 0);
  const expenseIds = Array.from(new Set(normalizedLines
    .filter((line) => line.sourceType === 'EXPENSE' && line.sourceId)
    .map((line) => Number(line.sourceId))
    .filter((id) => Number.isFinite(id) && id > 0)));

  const expenseTripRows = expenseIds.length > 0
    ? await db.select({
      id: s.tripExpenses.id,
      tripId: s.tripExpenses.tripId,
      invoiceNumber: s.tripExpenses.invoiceNumber,
      declarationNumber: s.tripExpenses.declarationNumber,
    })
      .from(s.tripExpenses)
      .where(inArray(s.tripExpenses.id, expenseIds))
    : [];
  const expenseById = new Map(expenseTripRows.map((row) => [row.id, row]));
  const tripIds = Array.from(new Set([
    ...directTripIds,
    ...expenseTripRows.map((row) => row.tripId),
  ]));
  const legacyLotRenderInfo = await loadLegacyFrozenLotRenderInfo(normalizedLines);
  if (tripIds.length === 0 && expenseById.size === 0) {
    return normalizedLines.map((line) => {
      const lotInfo = line.renderData || line.sourceType !== 'ADHOC'
        ? null
        : legacyFrozenLotInfo(line, legacyLotRenderInfo);
      return lotInfo ? { ...line, renderData: { ...lotInfo } } : line;
    });
  }

  const trips = await db.select({
    id: s.tripsComposite.id,
    tripCode: s.tripsComposite.tripCode,
    departureDate: s.tripsComposite.departureDate,
    fuelSurchargeAmount: s.tripsComposite.fuelSurchargeAmount,
    routeName: s.routes.name,
    notes: s.tripsComposite.notes,
    truckPlate: s.trucks.licensePlate,
    externalPlateNumber: s.tripsComposite.externalPlateNumber,
    // FB-094: billing BKS ("xe ảo") — printed on the debit note in preference
    // to every actual plate.
    billingTruckNo: s.shipments.billingTruckNo,
    // Card 171026004332: the payable statement's own truck identity is the
    // truck that actually ran, and its loại xe is the TRẢ cost class — the two
    // facts that mirror the note's BKS báo khách + THU class.
    actualTruckNo: s.shipments.actualTruckNo,
    cargoMode: s.shipments.cargoMode,
    revVehicleClassName: revVehicleClass.name,
    revVehicleClassCode: revVehicleClass.code,
    costVehicleClassName: costVehicleClass.name,
    costVehicleClassCode: costVehicleClass.code,    billNumber: s.shipments.blNumber,
    shipmentId: s.tripsComposite.shipmentId,
  }).from(s.tripsComposite)
    .leftJoin(s.routes, eq(s.tripsComposite.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.tripsComposite.truckId, s.trucks.id))
    .leftJoin(s.shipments, eq(s.shipments.id, s.tripsComposite.shipmentId))
    // Two aliases of one catalog: the two billing classes must never alias
    // (the spec prices one group "Thu: Xe 3.5T | Trả: Xe 10T").
    .leftJoin(revVehicleClass, eq(revVehicleClass.id, s.shipments.revVehicleClassId))
    .leftJoin(costVehicleClass, eq(costVehicleClass.id, s.shipments.costVehicleClassId))
    .where(inArray(s.tripsComposite.id, tripIds));
  const tripsById = new Map(trips.map((trip) => [trip.id, trip]));
  // Batched explicit read: declaration numbers per lot (raw-sql aggregates in
  // drizzle select objects alias unreliably — silent undefined beats a loud
  // failure here, so read the rows and join in JS).
  const lotIds = [...new Set(trips.map((trip) => trip.shipmentId).filter((value): value is number => value != null))];
  const declarationRows = lotIds.length === 0
    ? []
    : await db.select({ shipmentId: s.shipmentDeclarations.shipmentId, declarationNumber: s.shipmentDeclarations.declarationNumber })
      .from(s.shipmentDeclarations)
      .where(inArray(s.shipmentDeclarations.shipmentId, lotIds));
  const declarationNumbersByLot = new Map<number, string>();
  for (const row of declarationRows) {
    if (row.declarationNumber == null || row.declarationNumber === '') continue;
    const current = declarationNumbersByLot.get(row.shipmentId);
    declarationNumbersByLot.set(row.shipmentId, current == null ? row.declarationNumber : `${current}, ${row.declarationNumber}`);
  }
  const containersByTrip = await loadContainersByTrip(tripIds);
  const legsByTrip = await loadLegRenderDataByTrip(tripIds);

  return normalizedLines.map((line) => {
    const expenseInfo = line.sourceType === 'EXPENSE' && line.sourceId
      ? expenseById.get(Number(line.sourceId))
      : undefined;
    const documentCode = expenseInfo ? expenseDocumentCode(expenseInfo) : null;
    if (line.renderData) {
      return {
        ...line,
        renderData: {
          ...line.renderData,
          documentCode: line.renderData.documentCode ?? documentCode,
        },
      };
    }
    // Legacy frozen lot lines (issued before FB-094): the plate/class come from
    // the document's own lot claim, not from a guess.
    if (line.sourceType === 'ADHOC') {
      const lotInfo = legacyFrozenLotInfo(line, legacyLotRenderInfo);
      return lotInfo ? { ...line, renderData: { ...lotInfo } } : line;
    }
    if (!line.sourceId) return line;
    const tripId = line.sourceType === 'TRIP'
      ? Number(line.sourceId)
      : line.sourceType === 'EXPENSE'
        ? expenseInfo?.tripId
        : null;
    if (!tripId) return line;
    const trip = tripsById.get(tripId);
    if (!trip) return line;
    const containers = containersByTrip.get(trip.id) ?? [];
    // Card 171026004332: a document saved before FB-094 carries TRIP lines with
    // no renderData, and this repair used to read every one of them AR-first —
    // so a re-exported carrier statement printed the customer's virtual BKS.
    // The document's own side decides: AR keeps the AR-first builder (billing
    // BKS + loại xe tính cước THU); AP prints the truck that actually ran and
    // the TRẢ cost class, exactly what buildCarrierPaymentLines stamps on a
    // fresh draft. Amounts and lock semantics are untouched — plates and classes
    // are not money.
    const sidesRenderData = perspective === 'AP'
      ? {
          truckPlate: trip.actualTruckNo?.trim() || trip.truckPlate || trip.externalPlateNumber || null,
          vehicleType: trip.costVehicleClassName ?? trip.costVehicleClassCode ?? null,
        }
      : {
          vehicleType: trip.revVehicleClassName ?? trip.revVehicleClassCode ?? null,
        };
    const enrichedLine = {
      ...line,
      routeName: line.routeName ?? trip.routeName ?? null,
      containerNumbers: line.containerNumbers ?? containerNumbers(containers),
      renderData: {
        ...buildTripRenderData({
          tripId: trip.id,
          trip,
          containers,
          legs: legsByTrip.get(trip.id),
          note: trip.notes ?? null,
        }),
        ...sidesRenderData,
        // Business keys for the export cells (Số Bill/tờ khai) — same fields
        // the draft path stamps, so fresh lines render identical to stored ones.
        billNumber: trip.billNumber ?? null,
        declarationNumber: declarationNumbersByLot.get(trip.shipmentId ?? 0) ?? null,
      },
    };
    return {
      ...enrichedLine,
      renderData: {
        ...enrichedLine.renderData,
        documentCode,
      },
    };
  });
}
