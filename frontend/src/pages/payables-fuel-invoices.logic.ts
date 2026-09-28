/**
 * Pure data layer for the fuel-invoice panel.
 *
 * `payables-fuel-invoices.tsx` is grandfathered at a 1078-line ceiling, so the
 * form model, the completion math and the submit-time validation live here
 * instead of growing the panel. Everything in this module is pure: types, form
 * builders, and the three submit helpers the panel calls.
 *
 * The split is structural only. `validateFuelInvoiceForm`,
 * `buildFuelInvoicePayload` and `resolveEditingInvoice` were moved out of
 * `FuelInvoicesPanel`'s `submitEditor` verbatim (same strings, same order, same
 * outcomes) because that one function carried the repo finding
 * `finding_99d0f8af67b1025f03af` — a critical `complex_conditional` where a
 * single `if` combined six boolean operators. No condition was weakened; the
 * chains were split into named predicates that each read as one question.
 */
import { round2dp } from '@tingting/shared';

import type { FuelInvoice, FuelInvoiceAllocation, FuelInvoiceInput } from '../api/financialClient';
import { formatNumber } from '../lib/format';

export type FuelInvoiceFormRow = {
  localId: string;
  tripId: string;
  truckId: number | null;
  tripExpenseId: number | null;
  voucherReference: string;
  voucherDate: string;
  liters: string;
  note: string;
};

export type FuelInvoiceFormState = {
  supplierId: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalLiters: string;
  unitPrice: string;
  note: string;
  allocations: FuelInvoiceFormRow[];
};

export type CompletionSummary = {
  totalLiters: number;
  allocatedLiters: number;
  remainingLiters: number;
  totalAmount: number;
  allocatedAmount: number;
  remainingAmount: number;
  isComplete: boolean;
};

export type FuelInvoiceEditorState = { mode: 'create' | 'edit'; invoiceId: number | null } | null;

const HEADER_ERROR = 'Vui lòng nhập đủ nhà cung cấp, số hóa đơn, ngày hóa đơn, tổng lít và đơn giá.';
const ALLOCATION_ERROR = 'Mỗi dòng phân bổ phải có chuyến, phiếu đổ dầu, ngày đổ, số lít thực tế và chi phí nhiên liệu đã ghi nhận làm căn cứ.';

let rowSequence = 0;

function nextRowId() {
  rowSequence += 1;
  return `fuel-allocation-${rowSequence}`;
}

export function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

export function emptyRow(date = todayValue()): FuelInvoiceFormRow {
  return {
    localId: nextRowId(),
    tripId: '',
    truckId: null,
    tripExpenseId: null,
    voucherReference: '',
    voucherDate: date,
    liters: '',
    note: '',
  };
}

export function emptyForm(): FuelInvoiceFormState {
  const date = todayValue();
  return {
    supplierId: '',
    invoiceNumber: '',
    invoiceDate: date,
    totalLiters: '',
    unitPrice: '',
    note: '',
    allocations: [emptyRow(date)],
  };
}

export function buildForm(invoice: FuelInvoice): FuelInvoiceFormState {
  return {
    supplierId: String(invoice.supplierId),
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate.slice(0, 10),
    totalLiters: String(invoice.totalLiters),
    unitPrice: String(invoice.unitPrice),
    note: invoice.note ?? '',
    allocations: (invoice.allocations?.length ? invoice.allocations : [emptyRow(invoice.invoiceDate)]).map((allocation) => ({
      localId: nextRowId(),
      tripId: String(allocation.tripId),
      truckId: allocation.truckId ?? null,
      tripExpenseId: allocation.tripExpenseId ?? null,
      voucherReference: allocation.voucherReference,
      voucherDate: allocation.voucherDate.slice(0, 10),
      liters: String(allocation.liters),
      note: allocation.note ?? '',
    })),
  };
}

export function toDecimal(value: string | number | null | undefined): number {
  if (value == null || value === '') return 0;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function computeCompletion(
  totalLitersInput: string | number,
  unitPriceInput: string | number,
  allocations: Array<Pick<FuelInvoiceAllocation, 'liters' | 'amount'>> | FuelInvoiceFormRow[],
): CompletionSummary {
  const totalLiters = round2dp(toDecimal(totalLitersInput));
  const unitPrice = round2dp(toDecimal(unitPriceInput));
  const allocatedLiters = round2dp(allocations.reduce((sum, allocation) => sum + toDecimal(allocation.liters), 0));
  const totalAmount = round2dp(totalLiters * unitPrice);
  const allocatedAmount = round2dp(allocations.reduce((sum, allocation) => {
    const explicitAmount = 'amount' in allocation ? toDecimal(allocation.amount) : NaN;
    if (Number.isFinite(explicitAmount) && explicitAmount > 0) return sum + explicitAmount;
    return sum + round2dp(toDecimal(allocation.liters) * unitPrice);
  }, 0));
  const remainingLiters = round2dp(totalLiters - allocatedLiters);
  const remainingAmount = round2dp(totalAmount - allocatedAmount);
  return {
    totalLiters,
    allocatedLiters,
    remainingLiters,
    totalAmount,
    allocatedAmount,
    remainingAmount,
    isComplete: round2dp(remainingLiters) === 0 && round2dp(remainingAmount) === 0,
  };
}

/** Invoice header fields — each missing/invalid field yields the same message. */
function invoiceHeaderError(form: FuelInvoiceFormState): string | null {
  const totalLiters = Number(form.totalLiters);
  const unitPrice = Number(form.unitPrice);
  if (!Number(form.supplierId)) return HEADER_ERROR;
  if (!form.invoiceNumber.trim()) return HEADER_ERROR;
  if (!form.invoiceDate) return HEADER_ERROR;
  if (!Number.isFinite(totalLiters) || totalLiters <= 0) return HEADER_ERROR;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return HEADER_ERROR;
  return null;
}

function invoiceAllocationsError(form: FuelInvoiceFormState): string | null {
  for (const row of form.allocations) {
    // A fully blank row is skipped, never validated.
    if (!row.tripId && !row.voucherReference.trim() && !row.liters) continue;
    const referencesComplete = Boolean(row.tripId) && Boolean(row.voucherReference.trim()) && Boolean(row.voucherDate) && row.tripExpenseId != null;
    const liters = Number(row.liters);
    const litersValid = Number.isFinite(liters) && liters > 0;
    if (!referencesComplete || !litersValid) return ALLOCATION_ERROR;
  }
  return null;
}

/**
 * First validation failure of the editor form, in the order the panel has
 * always reported them: header, then allocation rows, then the litre total.
 */
export function validateFuelInvoiceForm(form: FuelInvoiceFormState, completion: CompletionSummary): string | null {
  const headerError = invoiceHeaderError(form);
  if (headerError) return headerError;
  const allocationsError = invoiceAllocationsError(form);
  if (allocationsError) return allocationsError;
  if (!completion.isComplete) {
    return `Tổng lít phân bổ ${formatNumber(completion.allocatedLiters)} phải khớp số lít hóa đơn ${formatNumber(completion.totalLiters)}.`;
  }
  return null;
}

export function buildFuelInvoicePayload(
  form: FuelInvoiceFormState,
  supplierId: number,
  totalLiters: number,
  unitPrice: number,
): FuelInvoiceInput {
  return {
    supplierId,
    invoiceNumber: form.invoiceNumber.trim(),
    invoiceDate: form.invoiceDate,
    totalLiters,
    unitPrice,
    note: form.note.trim() || undefined,
    allocations: form.allocations
      .filter((row) => row.tripId && row.voucherReference.trim() && row.liters)
      .map((row) => ({
        tripId: Number(row.tripId),
        truckId: row.truckId,
        tripExpenseId: row.tripExpenseId,
        voucherReference: row.voucherReference.trim(),
        voucherDate: row.voucherDate,
        liters: Number(row.liters),
        note: row.note.trim() || undefined,
      })),
  };
}

/**
 * The invoice row the edit form is bound to. Null means the open detail row is
 * not this editor's invoice, and the caller reports it with the stale-detail
 * message before writing.
 */
export function resolveEditingInvoice(
  editorState: FuelInvoiceEditorState,
  detail: FuelInvoice | undefined,
): FuelInvoice | null {
  if (editorState?.mode !== 'edit' || editorState.invoiceId == null) return null;
  return detail?.id === editorState.invoiceId ? detail : null;
}
