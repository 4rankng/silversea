// Shared helpers for the billing-export leaf family (legacy / debit-note /
// templated XLSX renderers + identity): description/date formatting, the
// Vietnamese amount-in-words renderer, per-column value resolution, and the
// render-data enrichment loader. Extracted from billing-export.service.ts
// verbatim (pure code movement); leaves import these one-way.
import { db } from '../db';
import * as s from '../db/schema';
import { inArray, eq } from 'drizzle-orm';
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
        : data.tripCode ?? (line.sourceType === 'TRIP' ? String(line.sourceId ?? '') : null);
    default: return null;
  }
}

export async function enrichLinesForDebitNoteRender(lines: BillingDocumentLine[]): Promise<BillingDocumentLine[]> {
  const normalizedLines = lines.map((line) => ({
    ...line,
    description: canonicalFreightDescription(line),
  }));
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
  if (tripIds.length === 0 && expenseById.size === 0) return normalizedLines;

  const trips = await db.select({
    id: s.tripsComposite.id,
    tripCode: s.tripsComposite.tripCode,
    departureDate: s.tripsComposite.departureDate,
    fuelSurchargeAmount: s.tripsComposite.fuelSurchargeAmount,
    routeName: s.routes.name,
    notes: s.tripsComposite.notes,
    truckPlate: s.trucks.licensePlate,
    externalPlateNumber: s.tripsComposite.externalPlateNumber,
  }).from(s.tripsComposite)
    .leftJoin(s.routes, eq(s.tripsComposite.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.tripsComposite.truckId, s.trucks.id))
    .where(inArray(s.tripsComposite.id, tripIds));
  const tripsById = new Map(trips.map((trip) => [trip.id, trip]));
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
    const enrichedLine = {
      ...line,
      routeName: line.routeName ?? trip.routeName ?? null,
      containerNumbers: line.containerNumbers ?? containerNumbers(containers),
      renderData: buildTripRenderData({
        tripId: trip.id,
        trip,
        containers,
        legs: legsByTrip.get(trip.id),
        note: trip.notes ?? null,
      }),
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
