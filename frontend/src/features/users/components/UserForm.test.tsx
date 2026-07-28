import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Role, ShipmentStatus } from '@tingting/shared';
import type { Customer } from '@tingting/shared';
import { AddPanel, EditPanel } from './UserForm';
import type { BusinessUnit, ShipmentScopeOption, UserRow } from '../utils';

vi.mock('../../../components/UI', () => ({
  Drawer: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    children: ReactNode;
    footer?: ReactNode;
  }) => isOpen ? (
    <section aria-label={title}>
      <h2>{title}</h2>
      {children}
      {footer}
    </section>
  ) : null,
  Btn: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  FormGroup: ({
    label,
    children,
    error,
  }: {
    label: string;
    children: ReactNode;
    error?: string;
  }) => (
    <label>
      <span>{label}</span>
      {children}
      {error && <span>{error}</span>}
    </label>
  ),
}));

const customers = [
  { id: 7, name: 'SilverSea Miền Nam', taxCode: '0312345678' },
  { id: 9, name: 'SilverSea Miền Bắc', taxCode: '0109876543' },
] as Customer[];

const businessUnits: BusinessUnit[] = [
  {
    id: 11,
    code: 'HCM',
    name: 'Điều hành miền Nam',
    status: 'ACTIVE',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  },
  {
    id: 12,
    code: 'HAN',
    name: 'Điều hành miền Bắc',
    status: 'ACTIVE',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  },
];

const shipmentOptions: ShipmentScopeOption[] = [
  {
    id: 101,
    shipmentCode: 'SHP-2607-00101',
    customerId: 7,
    customerName: 'SilverSea Miền Nam',
    responsibleUnitId: 11,
    status: ShipmentStatus.DRAFT,
    bookingRef: null,
    blNumber: null,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  },
  {
    id: 102,
    shipmentCode: 'SHP-2607-00102',
    customerId: 9,
    customerName: 'SilverSea Miền Bắc',
    responsibleUnitId: 12,
    status: ShipmentStatus.IN_PROGRESS,
    bookingRef: null,
    blNumber: null,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  },
];

describe('customer account scope', () => {
  it('requires and submits every selected customer when creating an active CUSTOMER account', async () => {
    const onSave = vi.fn().mockResolvedValue(true);

    render(
      <AddPanel
        isOpen
        saving={false}
        error={null}
        truckList={[]}
        customerList={customers}
        businessUnits={businessUnits}
        shipmentOptions={shipmentOptions}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByText('Vai trò').closest('label')!.querySelector('select')!, {
      target: { value: Role.CUSTOMER },
    });

    const submitButton = screen.getByRole('button', { name: 'Tạo tài khoản' });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Cần chọn ít nhất một khách hàng.')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('checkbox', { name: /SilverSea Miền Nam/ })[0]!);
    fireEvent.click(screen.getByRole('checkbox', { name: /SilverSea Miền Bắc/ }));
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        role: Role.CUSTOMER,
        customerId: 7,
        customerIds: [7, 9],
      }));
    });
  });

  it('loads and updates an existing multi-customer scope', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const user: UserRow = {
      id: 42,
      username: 'daily.customer',
      fullName: 'Khách hàng tập đoàn',
      email: 'customer@example.com',
      phone: '0900000000',
      role: Role.CUSTOMER,
      status: 'ACTIVE',
      createdAt: '2026-07-27T00:00:00.000Z',
      customerId: 7,
      customerIds: [7, 9],
      driverId: null,
      assignedTruckId: null,
      baseSalary: null,
      socialInsurance: null,
    };

    render(
      <EditPanel
        isOpen
        user={user}
        isMe={false}
        saving={false}
        error={null}
        truckList={[]}
        customerList={customers}
        businessUnits={businessUnits}
        shipmentOptions={shipmentOptions}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByText(/Đã chọn 2:/).textContent).toContain('SilverSea Miền Nam, SilverSea Miền Bắc');
    fireEvent.click(screen.getAllByRole('checkbox', { name: /SilverSea Miền Nam/ })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(42, expect.objectContaining({
        role: Role.CUSTOMER,
        customerId: 9,
        customerIds: [9],
      }));
    });
  });

  it('allows an inactive CUSTOMER account to remain temporarily unmapped', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const user: UserRow = {
      id: 43,
      username: 'inactive.customer',
      fullName: 'Khách hàng đã khóa',
      email: null,
      phone: null,
      role: Role.CUSTOMER,
      status: 'INACTIVE',
      createdAt: '2026-07-27T00:00:00.000Z',
      customerId: null,
      customerIds: [],
      driverId: null,
      assignedTruckId: null,
      baseSalary: null,
      socialInsurance: null,
    };

    render(
      <EditPanel
        isOpen
        user={user}
        isMe={false}
        saving={false}
        error={null}
        truckList={[]}
        customerList={customers}
        businessUnits={businessUnits}
        shipmentOptions={shipmentOptions}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByText('Tài khoản đã khóa có thể tạm thời chưa liên kết khách hàng.')).toBeTruthy();
    const saveButton = screen.getByRole('button', { name: 'Lưu thay đổi' });
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(43, expect.objectContaining({
        status: 'INACTIVE',
        customerId: null,
        customerIds: [],
      }));
    });
  });

  it('requires a CLERK to have at least one business unit and one customer or shipment', async () => {
    const onSave = vi.fn().mockResolvedValue(true);

    render(
      <AddPanel
        isOpen
        saving={false}
        error={null}
        truckList={[]}
        customerList={customers}
        businessUnits={businessUnits}
        shipmentOptions={shipmentOptions}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByText('Vai trò').closest('label')!.querySelector('select')!, {
      target: { value: Role.CLERK },
    });

    const submitButton = screen.getByRole('button', { name: 'Tạo tài khoản' });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Cần chọn ít nhất một đơn vị phụ trách.')).toBeTruthy();
    expect(screen.getByText('Cần chọn ít nhất một khách hàng hoặc một lô hàng cho nhân viên chứng từ.')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: /Điều hành miền Nam/ }));
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /SHP-2607-00101/ }));
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        role: Role.CLERK,
        businessUnitIds: [11],
        shipmentIds: [101],
        customerIds: [],
        customerId: null,
      }));
    });
  });

  it('submits selected payroll business units for a DRIVER account', async () => {
    const onSave = vi.fn().mockResolvedValue(true);

    render(
      <AddPanel
        isOpen
        saving={false}
        error={null}
        truckList={[]}
        customerList={customers}
        businessUnits={businessUnits}
        shipmentOptions={shipmentOptions}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByText('Đơn vị tính lương')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('checkbox', { name: /Điều hành miền Nam/ })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lái xe' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        role: Role.DRIVER,
        businessUnitIds: [11],
      }));
    });
  });

  it('loads and updates an existing CLERK assignment set', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const user: UserRow = {
      id: 52,
      username: 'doc.clerk',
      fullName: 'Nhân viên chứng từ',
      email: 'clerk@example.com',
      phone: '0901000000',
      role: Role.CLERK,
      status: 'ACTIVE',
      createdAt: '2026-07-27T00:00:00.000Z',
      customerId: 7,
      customerIds: [7],
      businessUnitIds: [11],
      shipmentIds: [101],
      driverId: null,
      assignedTruckId: null,
      baseSalary: null,
      socialInsurance: null,
    };

    render(
      <EditPanel
        isOpen
        user={user}
        isMe={false}
        saving={false}
        error={null}
        truckList={[]}
        customerList={customers}
        businessUnits={businessUnits}
        shipmentOptions={shipmentOptions}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getAllByText(/Đã chọn 1:/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('checkbox', { name: /SilverSea Miền Nam/ })[0]!);
    fireEvent.click(screen.getByRole('checkbox', { name: /Điều hành miền Bắc/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(52, expect.objectContaining({
        role: Role.CLERK,
        businessUnitIds: [11, 12],
        shipmentIds: [101],
        customerIds: [],
        customerId: null,
      }));
    });
  });

  it('allows an admin to optionally scope an ACCOUNTANT to selected customers', async () => {
    const onSave = vi.fn().mockResolvedValue(true);

    render(
      <AddPanel
        isOpen
        saving={false}
        error={null}
        truckList={[]}
        customerList={customers}
        businessUnits={businessUnits}
        shipmentOptions={shipmentOptions}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByText('Vai trò').closest('label')!.querySelector('select')!, {
      target: { value: Role.ACCOUNTANT },
    });

    expect(screen.getByText('Phạm vi khách hàng của kế toán')).toBeTruthy();
    expect(screen.getByText(/Nếu để trống, kế toán có phạm vi tài chính toàn công ty/)).toBeTruthy();

    const submitButton = screen.getByRole('button', { name: 'Tạo tài khoản' });
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('checkbox', { name: /SilverSea Miền Bắc/ }));
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        role: Role.ACCOUNTANT,
        customerId: 9,
        customerIds: [9],
      }));
    });
  });
});
