import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  tripDetailRef,
  createExpenseMock,
  completionMutateMock,
  listSuppliersMock,
  resolveLiftPriceMock,
} = vi.hoisted(() => ({
  tripDetailRef: {
    current: {
      id: 2,
      routeName: 'Kho CFS - ICD',
      status: 'IN_TRANSIT',
      tripCode: 'TRIP-LCL-002',
      customerName: 'SilverSea',
      truckPlate: '51H-67890',
      departureDate: '2026-08-03',
      cargoTypeName: null,
      customerReference: null,
      notes: null,
      instructions: null,
      containers: [
        {
          id: 501,
          containerTypeId: 3,
          containerTypeName: '20 feet',
          notes: '__fulfillment_lcl:1',
        },
      ],
      legs: [{ id: 1, sequence: 1, origin: 'Kho CFS', destination: 'ICD', km: 28, loadingType: 'HANG' }],
      completionScopes: [{ tripContainerId: 501, status: 'PENDING', completedAt: null }],
      expenses: [
        {
          id: 77,
          expenseType: 'LIFTING',
          buyAmount: 250000,
          settlementMethod: 'FORWARDER_ADVANCE',
          canEdit: true,
          activeSettlementId: null,
          tripContainerId: 501,
        },
      ],
    },
  },
  createExpenseMock: vi.fn(),
  completionMutateMock: vi.fn(),
  listSuppliersMock: vi.fn(),
  resolveLiftPriceMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ items: [] }),
    upload: vi.fn(),
  },
  fileCommandFingerprint: () => 'fingerprint',
}));

vi.mock('../api/forwarderClient', () => ({
  forwarderClient: {
    listSuppliers: listSuppliersMock,
    resolveLiftPrice: resolveLiftPriceMock,
  },
}));

vi.mock('../api/geotagClient', () => ({
  geotagClient: {
    submit: vi.fn(),
  },
}));

vi.mock('../hooks/useQueries', () => ({
  useForwarderTripDetail: () => ({
    data: tripDetailRef.current,
    isLoading: false,
    error: null,
  }),
  useCreateForwarderContainer: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateForwarderExpense: () => ({ mutate: createExpenseMock, isPending: false }),
  useDeleteForwarderExpense: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/useForwarderQueries', () => ({
  useUpdateForwarderExpense: () => ({ mutate: vi.fn(), isPending: false }),
  useSetForwarderExpenseCompletion: () => ({ mutate: completionMutateMock, isPending: false }),
}));

vi.mock('../hooks/useCatalogs', () => ({
  useCatalogs: () => ({ data: {
    forwarderExpenseTypes: [],
    ports: [{ id: 7, name: 'Cảng Tân Vũ', code: 'TV', city: 'Hải Phòng' }],
    containerTypes: [{ id: 3, code: '20DC', name: '20 feet' }],
  } }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../hooks/useBackShortcut', () => ({
  useBackShortcut: vi.fn(),
}));

vi.mock('../hooks/useGeolocation', () => ({
  useGeolocation: () => ({
    awaitAccurateSample: vi.fn(),
    fatalError: null,
    retry: vi.fn(),
    sample: null,
    isSubmitReady: false,
    isWatching: false,
  }),
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../components/UI', () => ({
  StatusPill: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormGroup: ({ label, children }: { label?: string; children: React.ReactNode }) => (
    <label>
      {label ? <span>{label}</span> : null}
      {children}
    </label>
  ),
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
}));

vi.mock('../components/trip/TripLegsPanel', () => ({
  default: () => null,
}));

import ForwarderTripDetailPage from './ForwarderTripDetailPage';
import { ForwarderContainersSection } from '../features/forwarder/forwarder-trip-detail-sections';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/my-forwarder-trips/2']}>
        <Routes>
          <Route path="/my-forwarder-trips/:id" element={<ForwarderTripDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ForwarderTripDetailPage LCL virtual scope UI', () => {
  beforeEach(() => {
    createExpenseMock.mockReset();
    completionMutateMock.mockReset();
    listSuppliersMock.mockReset();
    resolveLiftPriceMock.mockReset();
    listSuppliersMock.mockResolvedValue({ items: [] });
    resolveLiftPriceMock.mockResolvedValue({
      suggestedPrice: 950000,
      liftPricingId: 22,
      effectiveDate: '2026-08-01',
      source: 'MATRIX',
    });
    createExpenseMock.mockImplementation((_payload, options) => options?.onSuccess?.());
    tripDetailRef.current = {
      id: 2,
      routeName: 'Kho CFS - ICD',
      status: 'IN_TRANSIT',
      tripCode: 'TRIP-LCL-002',
      customerName: 'SilverSea',
      truckPlate: '51H-67890',
      departureDate: '2026-08-03',
      cargoTypeName: null,
      customerReference: null,
      notes: null,
      instructions: null,
      containers: [
        {
          id: 501,
          containerTypeId: 3,
          containerTypeName: '20 feet',
          notes: '__fulfillment_lcl:1',
        },
      ],
      legs: [{ id: 1, sequence: 1, origin: 'Kho CFS', destination: 'ICD', km: 28, loadingType: 'HANG' }],
      completionScopes: [{ tripContainerId: 501, status: 'PENDING', completedAt: null }],
      expenses: [
        {
          id: 77,
          expenseType: 'LIFTING',
          buyAmount: 250000,
          settlementMethod: 'FORWARDER_ADVANCE',
          canEdit: true,
          activeSettlementId: null,
          tripContainerId: 501,
        },
      ],
    };
  });

  it('hides synthetic LCL container UI but preserves its scope id for expense and completion actions', async () => {
    renderPage();

    expect(screen.queryByText(/Số Container \/ Seal/)).toBeNull();
    expect(screen.queryByText('__fulfillment_lcl:1')).toBeNull();
    expect(screen.queryByText('Container null')).toBeNull();
    expect(screen.getByText('Lô hàng lẻ')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));

    expect(screen.queryByText('Container áp dụng')).toBeNull();
    fireEvent.change(screen.getByDisplayValue('— Chọn cảng —'), { target: { value: '7' } });

    await waitFor(() => expect(resolveLiftPriceMock).toHaveBeenCalledWith({
      portId: 7,
      containerTypeId: 3,
      direction: 'LIFT_UP',
      loadState: 'LOADED',
      date: expect.any(String),
    }));
    fireEvent.change(screen.getByPlaceholderText('Số hóa đơn'), { target: { value: 'HD-LCL-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chi phí' }));

    await waitFor(() => expect(createExpenseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tripContainerId: 501,
      }),
      expect.any(Object),
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu đã kê xong cho Lô hàng lẻ' }));
    expect(completionMutateMock).toHaveBeenCalledWith({ tripId: 2, tripContainerId: 501, completed: true });
  });

  it('keeps the visible FCL container management panel unchanged', () => {
    const onSelectContainer = vi.fn();
    const { rerender } = render(
      <ForwarderContainersSection
        containers={[{ id: 1, notes: '__fulfillment_lcl:1' }]}
        show={false}
        setShow={vi.fn()}
        form={{ containerNumber: '', sealNumber: '', notes: '' }}
        setForm={vi.fn()}
        onAdd={vi.fn()}
        pending={false}
        selectedContainerId=""
        onSelectContainer={onSelectContainer}
      />,
    );

    expect(screen.queryByText(/Số Container \/ Seal/)).toBeNull();

    rerender(
      <ForwarderContainersSection
        containers={[{ id: 91, containerNumber: 'MSKU1234567', sealNumber: 'SEAL-001' }]}
        show={false}
        setShow={vi.fn()}
        form={{ containerNumber: '', sealNumber: '', notes: '' }}
        setForm={vi.fn()}
        onAdd={vi.fn()}
        pending={false}
        selectedContainerId=""
        onSelectContainer={onSelectContainer}
      />,
    );

    expect(screen.getByText('Số Container / Seal (1)')).toBeTruthy();
    expect(screen.getByText('MSKU1234567')).toBeTruthy();
    expect(screen.getByText(/Seal:/)).toBeTruthy();
    const containerButton = screen.getByRole('button', { name: 'Chọn Container MSKU1234567 cho chi phí' });
    expect(containerButton.tagName).toBe('BUTTON');
    expect(containerButton.getAttribute('aria-pressed')).toBe('false');
    containerButton.focus();
    fireEvent.click(containerButton);
    expect(onSelectContainer).toHaveBeenCalledWith('91');

    rerender(
      <ForwarderContainersSection
        containers={[]}
        show={false}
        setShow={vi.fn()}
        form={{ containerNumber: '', sealNumber: '', notes: '' }}
        setForm={vi.fn()}
        onAdd={vi.fn()}
        pending={false}
        selectedContainerId=""
        onSelectContainer={onSelectContainer}
      />,
    );

    expect(screen.getByText('Số Container / Seal (0)')).toBeTruthy();
    expect(screen.getByText('Chưa có số container/seal nào')).toBeTruthy();
  });
});

// Soft-voided fee rows (approvalStatus VOIDED/REJECTED, Q10) must render as
// voided — badge, deletion reason, disabled actions — instead of looking
// active and 409-ing on click.
describe('ForwarderTripDetailPage voided fee rows', () => {
  const baseTrip = {
    id: 3,
    routeName: 'Kho CFS - ICD',
    status: 'IN_TRANSIT',
    tripCode: 'TRIP-VOID-003',
    customerName: 'SilverSea',
    truckPlate: '51H-67890',
    departureDate: '2026-08-03',
    cargoTypeName: null,
    customerReference: null,
    notes: null,
    instructions: null,
    containers: [
      { id: 601, containerTypeId: 3, containerTypeName: '20 feet', containerNumber: 'MSKU7654321' },
    ],
    legs: [{ id: 1, sequence: 1, origin: 'Kho CFS', destination: 'ICD', km: 28, loadingType: 'HANG' }],
    completionScopes: [],
    expenses: [
      {
        id: 88,
        expenseType: 'LIFTING',
        buyAmount: 250000,
        settlementMethod: 'FORWARDER_ADVANCE',
        canEdit: true,
        activeSettlementId: null,
        tripContainerId: 601,
        approvalStatus: 'RECORDED',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 89,
        expenseType: 'LIFTING',
        buyAmount: 77000,
        settlementMethod: 'OPS_ADVANCE',
        canEdit: true,
        activeSettlementId: null,
        tripContainerId: 601,
        approvalStatus: 'VOIDED',
        deletionReason: 'Sai khoản — kê trùng cước lift up',
        deletedByName: 'Nguyễn Văn Dũng',
        deletedAt: '2026-09-23T02:30:00.000Z',
        updatedAt: '2026-09-23T02:30:00.000Z',
      },
    ],
  };

  function renderVoidedTrip(expenses: Array<Record<string, unknown>>) {
    const fixture = { ...baseTrip, expenses };
    tripDetailRef.current = fixture as unknown as typeof tripDetailRef.current;
    renderPage();
    return document.body.querySelectorAll('.fwd-expense-record');
  }

  it('renders a VOIDED row with badge, deletion reason, and disabled actions next to an active row', () => {
    const rows = renderVoidedTrip(baseTrip.expenses as Array<Record<string, unknown>>);
    expect(rows).toHaveLength(2);

    const activeRow = within(rows[0] as HTMLElement);
    const voidedRow = within(rows[1] as HTMLElement);

    expect(voidedRow.getByText('Đã hủy')).toBeTruthy();
    expect(voidedRow.getByText(/Lý do hủy: Sai khoản — kê trùng cước lift up/)).toBeTruthy();
    expect(voidedRow.getByText(/Nguyễn Văn Dũng/)).toBeTruthy();
    expect((voidedRow.getByRole('button', { name: /Điều chỉnh/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((voidedRow.getByRole('button', { name: 'Xóa chi phí' }) as HTMLButtonElement).disabled).toBe(true);

    expect(activeRow.queryByText('Đã hủy')).toBeNull();
    expect(activeRow.queryByText(/Lý do hủy:/)).toBeNull();
    expect((activeRow.getByRole('button', { name: /Điều chỉnh/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((activeRow.getByRole('button', { name: 'Xóa chi phí' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders a legacy REJECTED row with the refused label and the same disabled-actions treatment', () => {
    const rows = renderVoidedTrip([
      { ...baseTrip.expenses[1], id: 90, approvalStatus: 'REJECTED' } as Record<string, unknown>,
    ]);
    expect(rows).toHaveLength(1);

    const voidedRow = within(rows[0] as HTMLElement);
    expect(voidedRow.getByText('Đã từ chối')).toBeTruthy();
    expect((voidedRow.getByRole('button', { name: /Điều chỉnh/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((voidedRow.getByRole('button', { name: 'Xóa chi phí' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
