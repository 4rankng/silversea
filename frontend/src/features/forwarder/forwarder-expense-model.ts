import { businessDateISO } from '../../lib/format';
import {
  DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
  OPS_EXPENSE_TYPE_DEFAULTS,
} from '@tingting/shared';
import { getLocationPermissionIssue, isGeolocationError } from '../../lib/gps/geolocation';
import type { ForwarderContainer } from './forwarder-trip-detail-sections';

/** Shape of the add/edit expense form. All inputs are string-typed. */
export function newExpenseForm() {
  return {
    expenseType: 'LIFTING' as string,
    buyAmount: '',
    sellAmount: '',
    settlementMethod: 'OPS_ADVANCE' as 'OPS_ADVANCE' | 'COMPANY_DIRECT',
    supplierId: '',
    tripContainerId: '',
    portId: '',
    containerTypeId: '',
    loadState: 'LOADED' as 'LOADED' | 'EMPTY',
    expenseDate: businessDateISO(),
    payeeName: '',
    invoiceNumber: '',
    invoiceDate: '',
    declarationNumber: '',
    note: '',
    noInvoiceEvidenceTypes: [] as string[],
  };
}
export type ExpenseFormState = ReturnType<typeof newExpenseForm>;

export interface ExpenseFormErrors {
  buyAmount?: string;
  declarationNumber?: string;
  supplierId?: string;
  expenseDate?: string;
  payeeName?: string;
  note?: string;
  evidence?: string;
}

export function expensePhotoUploadErrorMessage(error: unknown): string {
  if (isGeolocationError(error)) {
    const issue = getLocationPermissionIssue(error);
    switch (issue.type) {
      case 'denied':
        return 'Không thể tải ảnh chứng từ vì ứng dụng chưa được cấp quyền vị trí. Hãy cho phép truy cập vị trí rồi thử lại.';
      case 'timeout':
        return 'Không thể tải ảnh chứng từ vì GPS phản hồi chậm. Vui lòng thử lại khi thiết bị bắt được vị trí tốt hơn.';
      case 'unavailable':
        return 'Không thể tải ảnh chứng từ vì thiết bị chưa bắt được GPS. Vui lòng thử lại khi có tín hiệu tốt hơn.';
      case 'inaccurate':
        return 'Không thể tải ảnh chứng từ vì tín hiệu GPS chưa đủ chính xác. Vui lòng thử lại.';
      default:
        return 'Không thể tải ảnh chứng từ vì thiết bị không hỗ trợ GPS.';
    }
  }
  return error instanceof Error && error.message
    ? error.message
    : 'Không thể tải ảnh chứng từ. Vui lòng thử lại.';
}

/* ─── Lift (nâng/hạ) price-matrix context ──────────────────────────────── */

export interface LiftContext {
  isLiftExpense: boolean;
  liftDirection: 'LIFT_UP' | 'LIFT_DOWN';
  /** Rising-edge key: the suggestion effect applies each unique combination once. */
  suggestionKey: string;
}

export function resolveLiftContext(form: ExpenseFormState): LiftContext {
  const isLiftExpense = form.expenseType === 'LIFTING' || form.expenseType === 'LOWERING';
  const liftDirection = form.expenseType === 'LOWERING' ? ('LIFT_DOWN' as const) : ('LIFT_UP' as const);
  const suggestionKey = [
    form.portId,
    form.containerTypeId,
    liftDirection,
    form.loadState,
    form.expenseDate,
  ].join('|');
  return { isLiftExpense, liftDirection, suggestionKey };
}

/* ─── Validation ────────────────────────────────────────────────────────── */

export interface ExpenseValidationContext {
  isLiftExpense: boolean;
  /** True only when the matrix resolved a positive suggested price. */
  matrixPriceValid: boolean;
  noInvoiceAllowed: boolean;
}

export function validateExpenseForm(
  form: ExpenseFormState,
  ctx: ExpenseValidationContext,
): ExpenseFormErrors {
  const errors: ExpenseFormErrors = {};
  const buyAmount = parseFloat(form.buyAmount);

  if (ctx.isLiftExpense && !ctx.matrixPriceValid) {
    errors.buyAmount = 'Chưa có biểu giá nâng/hạ hợp lệ cho Cảng + Loại cont + Hàng/Rỗng đã chọn';
  }
  if ((!buyAmount || buyAmount <= 0) && !errors.buyAmount) errors.buyAmount = 'Giá mua vào phải lớn hơn 0';
  if (form.expenseType === 'CUSTOMS' && !form.declarationNumber.trim()) {
    errors.declarationNumber = 'Số tờ khai hải quan là bắt buộc cho phí hải quan';
  }
  if (form.settlementMethod === 'COMPANY_DIRECT' && !form.supplierId) {
    errors.supplierId = 'Cần chọn NCC khi công ty trả trực tiếp';
  }
  if (!form.invoiceNumber.trim()) {
    if (!form.expenseDate) errors.expenseDate = 'Ngày chi là bắt buộc';
    if (!form.payeeName.trim()) errors.payeeName = 'Người nhận là bắt buộc';
    if (!form.note.trim()) errors.note = 'Lý do chi là bắt buộc';
    if (form.noInvoiceEvidenceTypes.length === 0) {
      errors.evidence = 'Cần chọn ít nhất một loại chứng cứ thay thế';
    }
  }
  return errors;
}

/* ─── Payload builders ──────────────────────────────────────────────────── */

export interface CreateExpensePayload {
  tripId: number;
  expenseType: string;
  buyAmount: number;
  sellAmount: number;
  settlementMethod: ExpenseFormState['settlementMethod'];
  supplierId?: number;
  expenseDate?: string;
  payeeName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  declarationNumber?: string;
  tripContainerId?: number;
  portId?: number;
  containerTypeId?: number;
  loadState?: 'LOADED' | 'EMPTY';
  note?: string;
  noInvoiceEvidenceTypes: string[];
}

export function buildExpensePayload(
  form: ExpenseFormState,
  opts: { tripId: number; isLiftExpense: boolean },
): CreateExpensePayload {
  const buyAmount = parseFloat(form.buyAmount);
  const sellAmount = parseFloat(form.sellAmount) || 0;
  const supplierIdNum = form.supplierId ? parseInt(form.supplierId, 10) : undefined;
  return {
    tripId: opts.tripId,
    expenseType: form.expenseType,
    buyAmount,
    sellAmount: sellAmount >= 0 ? sellAmount : 0,
    settlementMethod: form.settlementMethod,
    supplierId: supplierIdNum,
    expenseDate: form.expenseDate || undefined,
    payeeName: form.payeeName.trim() || undefined,
    invoiceNumber: form.invoiceNumber.trim() || undefined,
    invoiceDate: form.invoiceDate || undefined,
    declarationNumber: form.declarationNumber.trim() || undefined,
    tripContainerId: form.tripContainerId ? parseInt(form.tripContainerId, 10) : undefined,
    // Port / container type / load state only apply to lift (nâng/hạ) rows.
    portId: opts.isLiftExpense && form.portId ? parseInt(form.portId, 10) : undefined,
    containerTypeId: opts.isLiftExpense && form.containerTypeId ? parseInt(form.containerTypeId, 10) : undefined,
    loadState: opts.isLiftExpense ? form.loadState : undefined,
    note: form.note.trim() || undefined,
    noInvoiceEvidenceTypes: form.noInvoiceEvidenceTypes,
  };
}

/**
 * Update payload: same base as create, but cleared optional fields are sent as
 * explicit `null` (not omitted) so the server un-sets them — plus the
 * optimistic-lock token from the row being edited.
 */
export function buildUpdateExpensePayload(
  base: CreateExpensePayload,
  form: ExpenseFormState,
  opts: { id: number; expectedUpdatedAt: string },
) {
  return {
    ...base,
    id: opts.id,
    expectedUpdatedAt: opts.expectedUpdatedAt,
    supplierId: base.supplierId ?? null,
    expenseDate: form.expenseDate || null,
    payeeName: form.payeeName.trim() || null,
    invoiceNumber: form.invoiceNumber.trim() || null,
    invoiceDate: form.invoiceDate || null,
    declarationNumber: form.declarationNumber.trim() || null,
    tripContainerId: form.tripContainerId ? parseInt(form.tripContainerId, 10) : null,
    note: form.note.trim() || null,
    noInvoiceEvidenceTypes: form.noInvoiceEvidenceTypes,
  };
}

/* ─── Edit-form builder + open-form prefill ─────────────────────────────── */

export interface EditableForwarderExpense {
  id: number;
  updatedAt: string;
  expenseType: string;
  /** APIs serialize money as strings; both accepted here. */
  buyAmount: string | number;
  sellAmount?: number | string | null;
  settlementMethod?: string | null;
  supplierId?: number | null;
  tripContainerId?: number | null;
  expenseDate?: string | null;
  payeeName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  declarationNumber?: string | null;
  note?: string | null;
  noInvoiceEvidenceTypes?: string[] | null;
}

export interface ForwarderTripLegRef {
  loadingType?: string | null;
}

export function buildEditExpenseForm(
  exp: EditableForwarderExpense,
  containers: ForwarderContainer[],
  legs: ForwarderTripLegRef[],
): ExpenseFormState {
  return {
    expenseType: exp.expenseType,
    buyAmount: String(exp.buyAmount),
    sellAmount: String(exp.sellAmount ?? ''),
    settlementMethod: exp.settlementMethod === 'COMPANY_DIRECT' ? 'COMPANY_DIRECT' : 'OPS_ADVANCE',
    supplierId: exp.supplierId ? String(exp.supplierId) : '',
    tripContainerId: exp.tripContainerId ? String(exp.tripContainerId) : '',
    portId: '',
    containerTypeId: containers.find(container => container.id === exp.tripContainerId)?.containerTypeId
      ? String(containers.find(container => container.id === exp.tripContainerId)!.containerTypeId)
      : '',
    loadState: legs[0]?.loadingType === 'VO' ? 'EMPTY' : 'LOADED',
    expenseDate: exp.expenseDate ? String(exp.expenseDate).slice(0, 10) : businessDateISO(),
    payeeName: exp.payeeName ?? '',
    invoiceNumber: exp.invoiceNumber ?? '',
    invoiceDate: exp.invoiceDate ? String(exp.invoiceDate).slice(0, 10) : '',
    declarationNumber: exp.declarationNumber ?? '',
    note: exp.note ?? '',
    noInvoiceEvidenceTypes: exp.noInvoiceEvidenceTypes ?? [],
  };
}

/**
 * When a trip has exactly one container, the add-form opens with that
 * container (and its type / load state) preselected.
 */
export function singleContainerPrefill(
  containers: ForwarderContainer[],
  legs: ForwarderTripLegRef[],
): Pick<ExpenseFormState, 'tripContainerId' | 'containerTypeId' | 'loadState'> | null {
  if (containers.length !== 1) return null;
  return {
    tripContainerId: String(containers[0].id),
    containerTypeId: containers[0].containerTypeId ? String(containers[0].containerTypeId) : '',
    loadState: legs[0]?.loadingType === 'VO' ? ('EMPTY' as const) : ('LOADED' as const),
  };
}

/** Catalog entry for a forwarder expense type, including its no-invoice policy. */
export interface ForwarderExpenseTypeOption {
  code: string;
  name: string;
  requiresInvoice?: boolean;
  substituteEvidenceAllowed?: boolean;
  noInvoiceEvidenceTypes?: string[];
  /** API serializes these as strings and may null them; coerced on read. */
  noInvoicePerItemLimit?: number | string | null;
  noInvoicePerDayLimit?: number | string | null;
}

/** True when the selected expense type may be paid without an invoice. */
export function resolveNoInvoicePolicy(
  config: ForwarderExpenseTypeOption | undefined,
): { noInvoiceAllowed: boolean; allowedEvidenceTypes: string[]; perItemLimit: number; perDayLimit: number } {
  return {
    noInvoiceAllowed: !config?.requiresInvoice && config?.substituteEvidenceAllowed !== false,
    allowedEvidenceTypes: config?.noInvoiceEvidenceTypes?.length
      ? config.noInvoiceEvidenceTypes
      : [...DEFAULT_NO_INVOICE_EVIDENCE_TYPES],
    perItemLimit: Number(config?.noInvoicePerItemLimit ?? 1_000_000),
    perDayLimit: Number(config?.noInvoicePerDayLimit ?? 5_000_000),
  };
}

/** Markup policy for an expense type — drives sell-amount auto-sync behavior. */
export function hasMarkupPolicy(expenseType: string): boolean {
  return OPS_EXPENSE_TYPE_DEFAULTS[expenseType]?.defaultMarkup ?? false;
}
