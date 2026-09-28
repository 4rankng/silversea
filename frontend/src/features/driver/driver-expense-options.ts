import { DRIVER_LOT_COST_EXPENSE_TYPES, DriverIncidentalCostType as Type } from '@tingting/shared';

export type DriverExpenseGroup = 'DRIVER_SHIPMENT' | 'DRIVER_ROAD';
export interface DriverExpenseOption {
  code: string; label: string; type: Type; group: DriverExpenseGroup; amount?: number; feeNormCode?: string;
  /** Card 20260928_163 — the CATALOG row this option classifies as. Present ⇒ the
   *  server reads `requires_invoice` from the catalog instead of guessing from the
   *  typed invoice number, and the form offers Số hóa đơn only when the row is
   *  invoice-bearing (card 20260928_164 AC2). Absent ⇒ legacy enum-only entry. */
  expenseTypeCode?: string;
}

/** How the CATALOG classifies a driver lot-cost row — the one answer the form and
 *  the hook both need, so the field rule and the payload rule cannot drift.
 *  `UNCLASSIFIED` = no catalog ref (legacy enum-only entries and the free
 *  "Chi phí lô hàng khác" option): keep the pre-catalog behaviour. */
export type DriverLotCostInvoiceClass = 'INVOICED' | 'NO_INVOICE' | 'UNCLASSIFIED';

export function driverLotCostInvoiceClass(code: string | null | undefined): DriverLotCostInvoiceClass {
  if (code == null || code === '') return 'UNCLASSIFIED';
  const type = DRIVER_LOT_COST_EXPENSE_TYPES.find((item) => item.code === code);
  if (!type) return 'UNCLASSIFIED';
  return type.invoiced ? 'INVOICED' : 'NO_INVOICE';
}

export function driverExpenseOptionInvoiceClass(option: DriverExpenseOption | undefined): DriverLotCostInvoiceClass {
  return driverLotCostInvoiceClass(option?.expenseTypeCode);
}

/** The canonical catalog rows the driver's invoiced fees classify as. Labels are
 *  the catalog's own names (Phí vệ sinh / Phí lưu bãi / Phí lưu kho — card
 *  20260928_163). */
export const DRIVER_EXPENSE_OPTIONS: DriverExpenseOption[] = [
  { code: 'lift', label: 'Phí nâng', type: Type.LIFT_FEE, group: 'DRIVER_SHIPMENT', expenseTypeCode: 'LIFTING' },
  { code: 'drop', label: 'Phí hạ', type: Type.DROP_FEE, group: 'DRIVER_SHIPMENT', expenseTypeCode: 'LOWERING' },
  { code: 'wash', label: 'Phí vệ sinh', type: Type.CONTAINER_WASH, group: 'DRIVER_SHIPMENT', expenseTypeCode: 'FEE_CLEANING' },
  { code: 'storage', label: 'Phí lưu bãi', type: Type.WAREHOUSE_FEE, group: 'DRIVER_SHIPMENT', expenseTypeCode: 'YARD_STORAGE' },
  { code: 'warehouse', label: 'Phí lưu kho', type: Type.WAREHOUSE_FEE, group: 'DRIVER_SHIPMENT', expenseTypeCode: 'FEE_WAREHOUSE' },
  { code: 'workers', label: 'Công nhân tại kho', type: Type.OTHER, group: 'DRIVER_SHIPMENT', expenseTypeCode: 'WAREHOUSE_LABOR' },
  { code: 'weld', label: 'Hàn container', type: Type.CONTAINER_WELD, group: 'DRIVER_SHIPMENT', expenseTypeCode: 'CONTAINER_WELD' },
  { code: 'weigh', label: 'Cân lốp', type: Type.TIRE_WEIGH, group: 'DRIVER_SHIPMENT', expenseTypeCode: 'TIRE_WEIGH' },
  { code: 'swap', label: 'Đảo vỏ', type: Type.OTHER, group: 'DRIVER_SHIPMENT', expenseTypeCode: 'CONTAINER_SWAP' },
  { code: 'two-stops', label: 'Đóng / trả hai điểm', type: Type.OTHER, group: 'DRIVER_SHIPMENT', expenseTypeCode: 'TWO_POINT_DROP' },
  { code: 'transload', label: 'Đảo hàng', type: Type.OTHER, group: 'DRIVER_SHIPMENT', expenseTypeCode: 'CARGO_RESTACK' },
  { code: 'forklift', label: 'Xe nâng / hạ', type: Type.OTHER, group: 'DRIVER_SHIPMENT', expenseTypeCode: 'FORKLIFT_DANGKHOA' },
  { code: 'other-shipment', label: 'Chi phí lô hàng khác', type: Type.OTHER, group: 'DRIVER_SHIPMENT' },
  { code: 'route', label: 'Tiền tuyến đã thỏa thuận', type: Type.ROAD_ALLOWANCE, group: 'DRIVER_ROAD' },
  { code: 'toll', label: 'Vé cầu đường', type: Type.TOLL, group: 'DRIVER_ROAD' },
  { code: 'scan', label: 'Soi / kiểm hóa', type: Type.OTHER, group: 'DRIVER_ROAD' },
  { code: 'repair', label: 'Sửa chữa dọc đường', type: Type.OTHER, group: 'DRIVER_ROAD' },
  { code: 'other-road', label: 'Tiền đường khác', type: Type.OTHER, group: 'DRIVER_ROAD' },
];

export function driverExpenseOptions(norms: Array<{ code: string; label: string; amount: string | number }>): DriverExpenseOption[] {
  return [...DRIVER_EXPENSE_OPTIONS, ...norms.map(norm => ({ code: `norm:${norm.code}`, label: norm.label, amount: Number(norm.amount), feeNormCode: norm.code, type: Type.OTHER, group: 'DRIVER_ROAD' as const }))];
}

export function driverExpenseOption(code: string, options = DRIVER_EXPENSE_OPTIONS) {
  return options.find(option => option.code === code) ?? DRIVER_EXPENSE_OPTIONS[0];
}
