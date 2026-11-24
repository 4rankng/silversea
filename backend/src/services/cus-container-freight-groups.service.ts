// SIL-945 (KB Ch.3 §3.1.7 / Ch.10 §10.1.4) — the Chi tiết lô hàng board's
// three freight column groups (Cước đầu ra · Cước đầu vào · Phí chi hộ).
//
// Data channels reuse the settlement boards' canonical producers so one
// quantity can never read two ways:
//   - Cước đầu ra · Phí vận chuyển  = the per-trip freight pricing snapshot
//     (freightRateSnapshots, latest-per-trip grain — the same pick the debit
//     Bảng 2.1 renders); a lot-level LCL row's saved manual sell price wins
//     over the traced lane value, the same precedence the debit board prints.
//   - Cước đầu vào · Phí vận chuyển = trip_carrier_info.external_freight_cost
//     (the debit Bảng 2.3 "Cước trả" channel).
//   - Phí làm hàng / Phí phát sinh  = live ops entries of costGroup
//     OPS_REGULAR / OPS_INCIDENTAL (debit group 5): the cost side reads the
//     entry amount, the customer side reads the negotiated charge (null =
//     never negotiated — '—', never 0).
//   - Phí chi hộ (CSHT · Nâng · Hạ · Khác) = live INVOICED_* ops entries
//     bucketed by the catalog category through debitChiHoGroupOf (the debit
//     group-4 rule), amount = charge ?? paid (chi bao nhiêu thu khách bấy
//     nhiêu), negative paid rows dropped exactly like the debit board.
// Money rides the wire as strings; null = chưa xác định. The Lạch Huyện zone
// surcharge has its own settlement cell and none of the three KB columns, so
// it contributes to no cell here.
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { debitChiHoGroupOf } from './debit-merge.service';
import { liveDebitOpsExpense } from './live-debit-expense-scope';
import { pickLatestFreightSnapshotByTrip } from './revenue-override-read.service';

export interface CusFreightCell {
  amount: string | null;
  invoiceNumbers?: string[];
}

export interface CusFreightSide {
  transport: CusFreightCell;
  handling: CusFreightCell;
  incidental: CusFreightCell;
  total: string | null;
}

export interface CusFreightGroups {
  outbound: CusFreightSide;
  inbound: CusFreightSide;
  chiHo: {
    csht: CusFreightCell;
    lift: CusFreightCell;
    drop: CusFreightCell;
    other: CusFreightCell;
  };
}

/** One flat row's freight-relevant identity. `containerId` is the
 *  shipment_containers id (null = the lot-level LCL row). */
export interface CusFreightRowInput {
  shipmentId: number;
  rowId: number;
  tripId: number | null;
  containerId: number | null;
  isLotLevel: boolean;
  /** Lot rows only — the saved manual "Giá cước thu khách" (VND). */
  revFreightManual?: number | null;
}

export interface CusFreightOpsRow {
  shipmentId: number;
  /** shipmentContainerId — null on chung-lô / multi-cont rows. */
  containerId: number | null;
  /** SIL-881 multi-cont set; exactly one cont keeps both columns in sync. */
  containerIds: number[] | null;
  costGroup: string | null;
  /** forwarder_expense_types.category — the chi hộ bucket key. */
  category: string | null;
  /** Entry amount — the cost side (Phí / Thực chi). */
  amount: string;
  /** Negotiated customer charge — null = never negotiated. */
  charge: string | null;
  invoiceNumber: string | null;
}

export interface CusFreightChannel {
  /** tripId → the pricing snapshot's freight amount (Bảng 2.1 channel). */
  snapshotFreightByTrip: Map<number, string | null>;
  /** tripId → trip_carrier_info.external_freight_cost (Bảng 2.3 channel). */
  carrierCostByTrip: Map<number, string | null>;
  /** Live (never voided/rejected) ops entries for the page's shipments. */
  opsRows: CusFreightOpsRow[];
}

function cell(amount: string | null, invoiceNumbers: string[]): CusFreightCell {
  if (invoiceNumbers.length === 0) return { amount };
  return { amount, invoiceNumbers };
}

/** The two-line cell's invoice list: non-empty, unique, source order kept. */
function pushInvoice(list: string[], invoiceNumber: string | null): void {
  const value = invoiceNumber?.trim();
  if (value && !list.includes(value)) list.push(value);
}

function emptySide(): CusFreightSide {
  return { transport: { amount: null }, handling: { amount: null }, incidental: { amount: null }, total: null };
}

function totalOf(side: CusFreightSide): string | null {
  const parts = [side.transport.amount, side.handling.amount, side.incidental.amount]
    .filter((value): value is string => value != null)
    .map((value) => Number(value));
  if (parts.length === 0) return null;
  return String(parts.reduce((sum, value) => sum + value, 0));
}

/**
 * Pure assembler — KB §3.1.7's column groups for ONE page of rows. Container
 * rows read their own container's entries; the lot-level LCL row reads every
 * entry of its (containerless) lot; a chung-lô entry on a lot that DOES own
 * containers lands on the FIRST container row so the lot's money stays
 * visible somewhere on the board without being multiplied across rows.
 */
export function buildCusFreightGroups(rows: CusFreightRowInput[], channel: CusFreightChannel): Map<number, CusFreightGroups> {
  const result = new Map<number, CusFreightGroups>();
  const rowsByShipment = new Map<number, CusFreightRowInput[]>();
  for (const row of rows) {
    const bucket = rowsByShipment.get(row.shipmentId) ?? [];
    bucket.push(row);
    rowsByShipment.set(row.shipmentId, bucket);
  }
  const opsByShipment = new Map<number, CusFreightOpsRow[]>();
  for (const entry of channel.opsRows) {
    const bucket = opsByShipment.get(entry.shipmentId) ?? [];
    bucket.push(entry);
    opsByShipment.set(entry.shipmentId, bucket);
  }
  for (const [shipmentId, shipmentRows] of rowsByShipment) {
    const entries = opsByShipment.get(shipmentId) ?? [];
    const containerRows = shipmentRows.filter((row) => !row.isLotLevel);
    // Chung-lô rows land on the lot row when one exists (the LCL board row);
    // on a container-owning lot they land on the FIRST container row.
    const commonTarget = shipmentRows.find((row) => row.isLotLevel) ?? containerRows[0] ?? null;
    for (const row of shipmentRows) {
      const sideOut = emptySide();
      const sideIn = emptySide();
      // Transport channels (per-trip; null = chưa xác định).
      if (row.tripId != null) {
        const snapshot = channel.snapshotFreightByTrip.get(row.tripId);
        // Cước đầu ra: the lot's saved manual sell price wins over the trace
        // (the debit board's own precedence); container rows read the trace.
        const outboundTransport = row.isLotLevel && row.revFreightManual != null
          ? String(row.revFreightManual)
          : snapshot ?? null;
        sideOut.transport = cell(outboundTransport, []);
        sideIn.transport = cell(channel.carrierCostByTrip.get(row.tripId) ?? null, []);
      } else if (row.isLotLevel && row.revFreightManual != null) {
        sideOut.transport = cell(String(row.revFreightManual), []);
      }
      // Ops-driven components.
      const chiHoSums: Record<'csht' | 'lift' | 'drop' | 'other', { total: number | null; invoices: string[] }> = {
        csht: { total: null, invoices: [] },
        lift: { total: null, invoices: [] },
        drop: { total: null, invoices: [] },
        other: { total: null, invoices: [] },
      };
      let handlingOutKnown = false;
      let handlingOut = 0;
      let handlingInKnown = false;
      let handlingIn = 0;
      let incidentalOutKnown = false;
      let incidentalOut = 0;
      let incidentalInKnown = false;
      let incidentalIn = 0;
      for (const entry of entries) {
        // Scope: lot-level rows read every entry; a chung-lô entry (no
        // container named at all) lands on the common target row only; a
        // container row reads the entries naming ITS container.
        const common = entry.containerId == null && (entry.containerIds == null || entry.containerIds.length === 0);
        const scoped = !common && (
          row.isLotLevel
          || (row.containerId != null
            && (entry.containerId === row.containerId || entry.containerIds?.includes(row.containerId) === true))
        );
        if (common) {
          if (commonTarget == null || commonTarget.rowId !== row.rowId) continue;
        } else if (!scoped) continue;
        const amount = Number(entry.amount);
        if (entry.costGroup === 'OPS_REGULAR') {
          if (entry.charge != null) { handlingOutKnown = true; handlingOut += Number(entry.charge); }
          handlingInKnown = true;
          handlingIn += amount;
          pushInvoice(sideIn.handling.invoiceNumbers ?? (sideIn.handling.invoiceNumbers = []), entry.invoiceNumber);
          if (entry.charge != null) {
            pushInvoice(sideOut.handling.invoiceNumbers ?? (sideOut.handling.invoiceNumbers = []), entry.invoiceNumber);
          }
        } else if (entry.costGroup === 'OPS_INCIDENTAL') {
          if (entry.charge != null) { incidentalOutKnown = true; incidentalOut += Number(entry.charge); }
          incidentalInKnown = true;
          incidentalIn += amount;
          pushInvoice(sideIn.incidental.invoiceNumbers ?? (sideIn.incidental.invoiceNumbers = []), entry.invoiceNumber);
          if (entry.charge != null) {
            pushInvoice(sideOut.incidental.invoiceNumbers ?? (sideOut.incidental.invoiceNumbers = []), entry.invoiceNumber);
          }
        } else if (entry.costGroup != null && entry.costGroup.startsWith('INVOICED_')) {
          // Debit group-4 law: negative paid behaves as absent; the cell
          // amount is the customer charge, falling back to the paid amount.
          if (amount < 0) continue;
          const bucket = debitChiHoGroupOf(entry.category);
          const value = entry.charge != null ? Number(entry.charge) : amount;
          const slot = chiHoSums[bucket];
          slot.total = (slot.total ?? 0) + value;
          pushInvoice(slot.invoices, entry.invoiceNumber);
        }
      }
      sideOut.handling = cell(handlingOutKnown ? String(handlingOut) : null, sideOut.handling.invoiceNumbers ?? []);
      sideIn.handling = cell(handlingInKnown ? String(handlingIn) : null, sideIn.handling.invoiceNumbers ?? []);
      sideOut.incidental = cell(incidentalOutKnown ? String(incidentalOut) : null, sideOut.incidental.invoiceNumbers ?? []);
      sideIn.incidental = cell(incidentalInKnown ? String(incidentalIn) : null, sideIn.incidental.invoiceNumbers ?? []);
      sideOut.total = totalOf(sideOut);
      sideIn.total = totalOf(sideIn);
      result.set(row.rowId, {
        outbound: sideOut,
        inbound: sideIn,
        chiHo: {
          csht: cell(chiHoSums.csht.total == null ? null : String(chiHoSums.csht.total), chiHoSums.csht.invoices),
          lift: cell(chiHoSums.lift.total == null ? null : String(chiHoSums.lift.total), chiHoSums.lift.invoices),
          drop: cell(chiHoSums.drop.total == null ? null : String(chiHoSums.drop.total), chiHoSums.drop.invoices),
          other: cell(chiHoSums.other.total == null ? null : String(chiHoSums.other.total), chiHoSums.other.invoices),
        },
      });
    }
  }
  return result;
}

/**
 * The db-backed channel for one page: pricing snapshots, carrier costs, and
 * live ops entries — the same live-scope law every debit money surface rides
 * (VOIDED/REJECTED rows are dead money and never render here).
 */
export async function loadCusFreightChannel(params: {
  shipmentIds: number[];
  tripIds: number[];
}): Promise<CusFreightChannel> {
  const { shipmentIds, tripIds } = params;
  const snapshotFreightByTrip = new Map<number, string | null>();
  if (tripIds.length > 0 && shipmentIds.length > 0) {
    const snapshots = await db.select({
      id: s.freightRateSnapshots.id,
      tripId: s.freightRateSnapshots.tripId,
      freightAmount: s.freightRateSnapshots.freightAmount,
      surchargeAmount: s.freightRateSnapshots.surchargeAmount,
      totalAmount: s.freightRateSnapshots.totalAmount,
      rateTermsId: s.freightRateSnapshots.rateTermsId,
      pricingTableId: s.freightRateSnapshots.pricingTableId,
      fuelNormId: s.freightRateSnapshots.fuelNormId,
      fuelPricePeriodId: s.freightRateSnapshots.fuelPricePeriodId,
    })
      .from(s.freightRateSnapshots)
      .where(inArray(s.freightRateSnapshots.shipmentId, shipmentIds));
    for (const [tripId, leg] of pickLatestFreightSnapshotByTrip(
      snapshots.map((row) => ({ ...row, rateKey: null })),
    )) {
      snapshotFreightByTrip.set(tripId, leg.freight);
    }
  }
  const carrierCostByTrip = new Map<number, string | null>();
  if (tripIds.length > 0) {
    const carrierRows = await db.select({
      tripId: s.tripCarrierInfo.tripId,
      cost: s.tripCarrierInfo.externalFreightCost,
    })
      .from(s.tripCarrierInfo)
      .where(inArray(s.tripCarrierInfo.tripId, tripIds));
    for (const row of carrierRows) {
      carrierCostByTrip.set(row.tripId, row.cost == null ? null : String(Number(row.cost)));
    }
  }
  const opsRows: CusFreightOpsRow[] = shipmentIds.length === 0 ? [] : await db.select({
    shipmentId: s.opsExpenseEntries.shipmentId,
    containerId: s.opsExpenseEntries.shipmentContainerId,
    containerIds: s.opsExpenseEntries.shipmentContainerIds,
    costGroup: s.opsExpenseEntries.costGroup,
    category: s.forwarderExpenseTypes.category,
    amount: s.opsExpenseEntries.amount,
    charge: s.opsExpenseEntries.customerChargeAmount,
    invoiceNumber: s.opsExpenseEntries.invoiceNumber,
  })
    .from(s.opsExpenseEntries)
    .leftJoin(s.forwarderExpenseTypes, eq(s.forwarderExpenseTypes.code, s.opsExpenseEntries.expenseTypeCode))
    .where(and(
      inArray(s.opsExpenseEntries.shipmentId, shipmentIds),
      liveDebitOpsExpense(),
      ne(s.opsExpenseEntries.approvalStatus, 'REJECTED'),
    ));
  return { snapshotFreightByTrip, carrierCostByTrip, opsRows };
}
