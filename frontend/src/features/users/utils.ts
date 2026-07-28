import { CustomerAccountType, Role, ROLE_LABELS, ShipmentStatus } from '@tingting/shared';

export interface BusinessUnit {
  id: number;
  code: string | null;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentScopeOption {
  id: number;
  shipmentCode: string | null;
  customerId: number;
  customerName: string | null;
  responsibleUnitId: number | null;
  status: ShipmentStatus;
  bookingRef: string | null;
  blNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserRow {
  id: number;
  username: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  role: Role;
  status: string;
  createdAt: string;
  customerId?: number | null;
  customerIds?: number[];
  customerAccountType?: CustomerAccountType;
  businessUnitIds?: number[];
  shipmentIds?: number[];
  // Linked driver profile (null for non-driver users or users without a profile row).
  driverId: number | null;
  assignedTruckId: number | null;
  baseSalary: string | null;
  socialInsurance: string | null;
}

export interface EditData {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  role: Role;
  status: string;
  password: string;
  // Driver-profile fields — sent only when role === DRIVER.
  baseSalary?: string;
  socialInsurance?: string;
  assignedTruckId?: number | null;
  customerId?: number | null;
  customerIds?: number[];
  customerAccountType?: CustomerAccountType;
  businessUnitIds?: number[];
  shipmentIds?: number[];
}

export interface CreateData {
  username: string;
  email: string;
  phone: string;
  fullName: string;
  role: Role;
  password: string;
  // Driver-profile fields — sent only when role === DRIVER.
  baseSalary?: string;
  socialInsurance?: string;
  assignedTruckId?: number | null;
  customerId?: number | null;
  customerIds?: number[];
  customerAccountType?: CustomerAccountType;
  businessUnitIds?: number[];
  shipmentIds?: number[];
}

export const ROLE_PILL: Record<Role, { cls: string; label: string }> = {
  [Role.ADMIN]:      { cls: 'pill pill--danger',  label: 'Quản trị' },
  [Role.MANAGER]:    { cls: 'pill pill--warn',    label: 'Quản lý' },
  [Role.ACCOUNTANT]: { cls: 'pill pill--neutral', label: 'Kế toán' },
  [Role.DRIVER]:     { cls: 'pill pill--success', label: 'Lái xe' },
  [Role.FORWARDER]:  { cls: 'pill pill--info',    label: 'Giao nhận' },
  [Role.CUSTOMER]:   { cls: 'pill pill--info',    label: 'Khách hàng' },
  [Role.CLERK]:      { cls: 'pill pill--neutral', label: 'Chứng từ' },
};

export type FilterKey = 'all' | Role;

export { Role, ROLE_LABELS };
