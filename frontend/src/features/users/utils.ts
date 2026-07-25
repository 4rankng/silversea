import { Role, ROLE_LABELS } from '@tingting/shared';

export interface UserRow {
  id: number;
  username: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  role: Role;
  status: string;
  createdAt: string;
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
