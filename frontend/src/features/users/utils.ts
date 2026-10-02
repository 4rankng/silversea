import { CustomerAccountType, Role, ROLE_LABELS, ShipmentStatus } from '@tingting/shared';

export interface BusinessUnit {
  id: number;
  code: string | null;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export const BUSINESS_UNIT_STATUS_LABELS: Record<BusinessUnit['status'], string> = {
  ACTIVE: 'Đang sử dụng',
  INACTIVE: 'Ngừng sử dụng',
};

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
  employeeCode: string | null;
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
  employeeCode?: string;
  role: Role;
  status: string;
  password: string;
  // Driver-profile fields — sent only when role === DRIVER.
  baseSalary?: string;
  socialInsurance?: string;
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
  employeeCode?: string;
  role: Role;
  password: string;
  // Driver-profile fields — sent only when role === DRIVER.
  baseSalary?: string;
  socialInsurance?: string;
  customerId?: number | null;
  customerIds?: number[];
  customerAccountType?: CustomerAccountType;
  businessUnitIds?: number[];
  shipmentIds?: number[];
}

// Card 20260921_25: pill labels DERIVE from the shared ROLE_LABELS registry —
// one business name per role everywhere (the CUS pill used to sit next to a
// "CUS" filter chip for the same role).
export const ROLE_PILL: Record<Role, { cls: string; label: string }> = {
  [Role.ADMIN]:      { cls: 'pill pill--danger',  label: ROLE_LABELS[Role.ADMIN] },
  [Role.MANAGER]:    { cls: 'pill pill--warn',    label: ROLE_LABELS[Role.MANAGER] },
  [Role.ACCOUNTANT]: { cls: 'pill pill--neutral', label: ROLE_LABELS[Role.ACCOUNTANT] },
  [Role.DRIVER]:     { cls: 'pill pill--success', label: ROLE_LABELS[Role.DRIVER] },
  [Role.OPS]:        { cls: 'pill pill--info',    label: ROLE_LABELS[Role.OPS] },
  [Role.CUSTOMER]:   { cls: 'pill pill--info',    label: ROLE_LABELS[Role.CUSTOMER] },
  [Role.CUS]:        { cls: 'pill pill--neutral', label: ROLE_LABELS[Role.CUS] },
  [Role.DISPATCHER]: { cls: 'pill pill--info',    label: ROLE_LABELS[Role.DISPATCHER] },
};

export type FilterKey = 'all' | Role;

export { Role, ROLE_LABELS };
