import { DRIVER_EXPENSE_SUGGESTIONS, DriverIncidentalCostType as Type } from '@tingting/shared';

export type DriverExpenseGroup = 'DRIVER_SHIPMENT' | 'DRIVER_ROAD';
export interface DriverExpenseOption { code: string; label: string; type: Type; group: DriverExpenseGroup; amount?: number }

export const DRIVER_EXPENSE_OPTIONS: DriverExpenseOption[] = [
  { code: 'lift', label: 'Phí nâng', type: Type.LIFT_FEE, group: 'DRIVER_SHIPMENT' },
  { code: 'drop', label: 'Phí hạ', type: Type.DROP_FEE, group: 'DRIVER_SHIPMENT' },
  { code: 'wash', label: 'Vệ sinh container', type: Type.CONTAINER_WASH, group: 'DRIVER_SHIPMENT' },
  { code: 'storage', label: 'Lưu bãi / lưu kho', type: Type.WAREHOUSE_FEE, group: 'DRIVER_SHIPMENT' },
  { code: 'workers', label: 'Công nhân tại kho', type: Type.OTHER, group: 'DRIVER_SHIPMENT' },
  { code: 'weld', label: 'Hàn container', type: Type.CONTAINER_WELD, group: 'DRIVER_SHIPMENT' },
  { code: 'weigh', label: 'Cân lốp', type: Type.TIRE_WEIGH, group: 'DRIVER_SHIPMENT' },
  { code: 'swap', label: 'Đảo vỏ', type: Type.OTHER, group: 'DRIVER_SHIPMENT' },
  { code: 'two-stops', label: 'Đóng / trả hai điểm', type: Type.OTHER, group: 'DRIVER_SHIPMENT' },
  { code: 'transload', label: 'Đảo hàng', type: Type.OTHER, group: 'DRIVER_SHIPMENT' },
  { code: 'forklift', label: 'Xe nâng / hạ Đăng Khoa', type: Type.OTHER, group: 'DRIVER_SHIPMENT' },
  { code: 'other-shipment', label: 'Chi phí lô hàng khác', type: Type.OTHER, group: 'DRIVER_SHIPMENT' },
  { code: 'route', label: 'Tiền tuyến đã thỏa thuận', type: Type.ROAD_ALLOWANCE, group: 'DRIVER_ROAD' },
  { code: 'toll', label: 'Vé cầu đường', type: Type.TOLL, group: 'DRIVER_ROAD' },
  { code: 'scan', label: 'Soi / kiểm hóa', type: Type.OTHER, group: 'DRIVER_ROAD' },
  { code: 'repair', label: 'Sửa chữa dọc đường', type: Type.OTHER, group: 'DRIVER_ROAD' },
  ...DRIVER_EXPENSE_SUGGESTIONS.map(item => ({ ...item, type: item.code === 'SHIFT' ? Type.ROAD_ALLOWANCE : Type.OTHER, group: 'DRIVER_ROAD' as const })),
  { code: 'other-road', label: 'Tiền đường khác', type: Type.OTHER, group: 'DRIVER_ROAD' },
];

export function driverExpenseOption(code: string) {
  return DRIVER_EXPENSE_OPTIONS.find(option => option.code === code) ?? DRIVER_EXPENSE_OPTIONS[0];
}
