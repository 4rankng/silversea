import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const {
  useAuthMock,
  useAllSuppliersMock,
  useFuelInvoicesMock,
  useFuelInvoiceMock,
  useFuelInvoiceTripOptionsMock,
  useCreateFuelInvoiceMock,
  useUpdateFuelInvoiceMock,
  useApproveFuelInvoiceMock,
  listTripExpensesMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useAllSuppliersMock: vi.fn(),
  useFuelInvoicesMock: vi.fn(),
  useFuelInvoiceMock: vi.fn(),
  useFuelInvoiceTripOptionsMock: vi.fn(),
  useCreateFuelInvoiceMock: vi.fn(),
  useUpdateFuelInvoiceMock: vi.fn(),
  useApproveFuelInvoiceMock: vi.fn(),
  listTripExpensesMock: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../hooks/useCatalogQueries', () => ({
  useAllSuppliers: useAllSuppliersMock,
}));

vi.mock('../hooks/useQueries', () => ({
  useFuelInvoices: useFuelInvoicesMock,
  useFuelInvoice: useFuelInvoiceMock,
  useFuelInvoiceTripOptions: useFuelInvoiceTripOptionsMock,
  useCreateFuelInvoice: useCreateFuelInvoiceMock,
  useUpdateFuelInvoice: useUpdateFuelInvoiceMock,
  useApproveFuelInvoice: useApproveFuelInvoiceMock,
}));

vi.mock('../api/tripClient', () => ({
  tripClient: {
    listTripExpenses: listTripExpensesMock,
  },
}));

vi.mock('../components/UI', () => ({
  Panel: ({ title, subtitle, action, children }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {subtitle ? <p>{subtitle}</p> : null}
      {action}
      {children}
    </section>
  ),
  Modal: ({ isOpen, title, children, footer }: { isOpen: boolean; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) => (
    isOpen ? (
      <div role="dialog" aria-label={String(title)}>
        <h3>{title}</h3>
        {children}
        {footer}
      </div>
    ) : null
  ),
}));

vi.mock('../design-system', () => ({
  SearchableSelect: ({
    id,
    value,
    onChange,
    options,
    placeholder,
  }: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    placeholder?: string;
  }) => (
    <select id={id} aria-label={id} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder ?? 'Chọn'}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
  UuiSelectField: ({
    id,
    label,
    value,
    onChange,
    options,
  }: {
    id?: string;
    label?: string;
    value: string;
    onChange: (e: { target: { value: string } }) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <div>
      {label && <label>{label}</label>}
      <select id={id} aria-label={label || id} value={value} onChange={onChange}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  ),
  DateInput: ({ id, value, onChange, ...rest }: { id?: string; value: string; onChange: (value: string) => void; [k: string]: unknown }) => (
    <input
      id={id}
      type="date"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...rest}
    />
  ),
}));

import { FuelInvoicesPanel } from './payables-fuel-invoices';

const suppliers = [
  {
    id: 7,
    name: 'Petrolimex',
    isFuelSupplier: true,
    types: ['FUEL'],
  },
];

const tripOptions = [
  {
    id: 101,
    tripCode: 'TRIP-101',
    truckId: 88,
    truckPlate: '51H-123.45',
    departureDate: '2026-07-20',
    routeName: 'Hà Nội - Hải Phòng',
  },
];

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    version: 3,
    supplierId: 7,
    invoiceNumber: 'HD-PTX-001',
    invoiceDate: '2026-07-20',
    currency: 'VND',
    totalLiters: '100',
    unitPrice: '22000',
    totalAmount: '2200000',
    approvalStatus: 'PENDING',
    note: 'Hoá đơn tháng 7',
    createdBy: 9,
    approvedBy: null,
    approvedAt: null,
    createdAt: '2026-07-20T08:00:00.000Z',
    updatedAt: '2026-07-20T08:00:00.000Z',
    allocations: [
      {
        id: 11,
        tripId: 101,
        truckId: 88,
        tripExpenseId: 501,
        voucherReference: 'PXD-001',
        voucherDate: '2026-07-20',
        liters: '60',
        amount: '1320000',
        note: 'Ca sáng',
      },
    ],
    ...overrides,
  };
}

function setRole(role: Role) {
  useAuthMock.mockReturnValue({
    user: {
      userId: 99,
      username: role.toLowerCase(),
      role,
    },
  });
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FuelInvoicesPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAllSuppliersMock.mockReturnValue({ data: suppliers });
  useFuelInvoiceTripOptionsMock.mockReturnValue({ data: tripOptions });
  useCreateFuelInvoiceMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
  useUpdateFuelInvoiceMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
  useApproveFuelInvoiceMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
  listTripExpensesMock.mockResolvedValue({
    items: [
      {
        id: 501,
        supplierId: 7,
        expenseType: 'FUEL_DIESEL',
        approvalStatus: 'APPROVED',
        expenseDate: '2026-07-20',
        createdAt: '2026-07-20T08:00:00.000Z',
        buyAmount: '2200000',
      },
    ],
  });
  useFuelInvoicesMock.mockReturnValue({
    data: [makeInvoice()],
    isLoading: false,
    error: null,
  });
  useFuelInvoiceMock.mockReturnValue({
    data: makeInvoice(),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
});

describe('FuelInvoicesPanel', () => {
  it('lets ACCOUNTANT open the draft form', () => {
    setRole(Role.ACCOUNTANT);

    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Tạo hóa đơn nhiên liệu/i }));
    expect(screen.getByRole('dialog', { name: 'Tạo hóa đơn nhiên liệu' })).toBeTruthy();
  });

  it('keeps MANAGER in read-and-approve mode and disables approval for incomplete allocation', () => {
    setRole(Role.MANAGER);

    renderPanel();

    expect(screen.queryByRole('button', { name: /Tạo hóa đơn nhiên liệu/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Xem' }));

    expect(screen.getByRole('alert').textContent ?? '').toMatch(/Còn thiếu 40 lít/i);
    expect(screen.queryByRole('button', { name: /Sửa bản nháp/i })).toBeNull();
    expect((screen.getByRole('button', { name: /Gửi yêu cầu duyệt/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows computed line amounts and lets MANAGER submit a governed approval request when complete', () => {
    setRole(Role.MANAGER);
    const approveMutateAsync = vi.fn();
    useApproveFuelInvoiceMock.mockReturnValue({ isPending: false, mutateAsync: approveMutateAsync });
    useFuelInvoicesMock.mockReturnValue({
      data: [makeInvoice({
        allocations: [
          {
            id: 11,
            tripId: 101,
            truckId: 88,
            tripExpenseId: 501,
            voucherReference: 'PXD-001',
            voucherDate: '2026-07-20',
            liters: '60',
            amount: '1320000',
            note: 'Ca sáng',
          },
          {
            id: 12,
            tripId: 101,
            truckId: 88,
            tripExpenseId: 501,
            voucherReference: 'PXD-002',
            voucherDate: '2026-07-20',
            liters: '40',
            amount: '880000',
            note: 'Ca chiều',
          },
        ],
      })],
      isLoading: false,
      error: null,
    });
    useFuelInvoiceMock.mockReturnValue({
      data: makeInvoice({
        allocations: [
          {
            id: 11,
            tripId: 101,
            truckId: 88,
            tripExpenseId: 501,
            voucherReference: 'PXD-001',
            voucherDate: '2026-07-20',
            liters: '60',
            amount: '1320000',
            note: 'Ca sáng',
          },
          {
            id: 12,
            tripId: 101,
            truckId: 88,
            tripExpenseId: 501,
            voucherReference: 'PXD-002',
            voucherDate: '2026-07-20',
            liters: '40',
            amount: '880000',
            note: 'Ca chiều',
          },
        ],
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Xem' }));

    expect(screen.getByText('1.320.000 ₫')).toBeTruthy();
    expect(screen.getByText('880.000 ₫')).toBeTruthy();
    expect(screen.queryByText(/Còn thiếu 40 lít/i)).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: /Lý do đề nghị duyệt/i }), {
      target: { value: 'Đã đối soát hóa đơn và phiếu bơm' },
    });
    expect((screen.getByRole('button', { name: /Gửi yêu cầu duyệt/i }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Gửi yêu cầu duyệt/i }));
    expect(approveMutateAsync).toHaveBeenCalledWith({
      id: 1,
      expectedVersion: 3,
      reason: 'Đã đối soát hóa đơn và phiếu bơm',
    });
  });

  it('passes the current version when saving an edited draft invoice', () => {
    setRole(Role.ACCOUNTANT);
    const updateMutateAsync = vi.fn().mockResolvedValue(makeInvoice());
    useUpdateFuelInvoiceMock.mockReturnValue({ isPending: false, mutateAsync: updateMutateAsync });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Xem' }));
    fireEvent.click(screen.getByRole('button', { name: /Sửa bản nháp/i }));
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/i }));

    expect(updateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      expectedVersion: 3,
    }));
  });

  it('sorts columns client-side: money sorts numerically, asc flips to desc, default order intact', () => {
    setRole(Role.MANAGER);
    // Server order (by id) deliberately not ascending by amount.
    useFuelInvoicesMock.mockReturnValue({
      data: [
        makeInvoice({ id: 1, invoiceNumber: 'HD-PTX-001', totalAmount: '3000000' }),
        makeInvoice({ id: 2, invoiceNumber: 'HD-PTX-002', totalAmount: '1000000' }),
        makeInvoice({ id: 3, invoiceNumber: 'HD-PTX-003', totalAmount: '2000000' }),
      ],
      isLoading: false,
      error: null,
    });

    const { container } = renderPanel();
    const order = () =>
      [...container.querySelectorAll('.fuel-invoices-table tbody tr')]
        .map(row => row.querySelector('.fuel-invoice-cell-title')?.textContent ?? '');

    expect(order()).toEqual(['HD-PTX-001', 'HD-PTX-002', 'HD-PTX-003']);
    expect(screen.getByRole('columnheader', { name: 'Thành tiền' }).getAttribute('aria-sort')).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: 'Thành tiền' }));
    expect(order()).toEqual(['HD-PTX-002', 'HD-PTX-003', 'HD-PTX-001']);
    expect(screen.getByRole('columnheader', { name: 'Thành tiền' }).getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: 'Thành tiền' }));
    expect(order()).toEqual(['HD-PTX-001', 'HD-PTX-003', 'HD-PTX-002']);
    expect(screen.getByRole('columnheader', { name: 'Thành tiền' }).getAttribute('aria-sort')).toBe('descending');

    // A fresh column starts ascending.
    fireEvent.click(screen.getByRole('button', { name: 'Hóa đơn' }));
    expect(order()).toEqual(['HD-PTX-001', 'HD-PTX-002', 'HD-PTX-003']);
    expect(screen.getByRole('columnheader', { name: 'Hóa đơn' }).getAttribute('aria-sort')).toBe('ascending');
  });
});
