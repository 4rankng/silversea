const tripDetailOverrides: { data?: Record<string, unknown> } = {};
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  awaitAccurateSampleMock,
  apiGetMock,
  uploadMock,
  listSuppliersMock,
  resolveLiftPriceMock,
  createExpenseMock,
  geotagSubmitMock,
  toastMock,
  confirmMock,
  deleteExpenseMock,
  renderHistory,
} = vi.hoisted(() => ({
  awaitAccurateSampleMock: vi.fn(),
  apiGetMock: vi.fn(),
  uploadMock: vi.fn(),
  listSuppliersMock: vi.fn(),
  resolveLiftPriceMock: vi.fn(),
  createExpenseMock: vi.fn(),
  geotagSubmitMock: vi.fn(),
  toastMock: vi.fn(),
  confirmMock: vi.fn(),
  deleteExpenseMock: vi.fn(),
  renderHistory: [] as Array<number | null>,
}));

vi.mock('../lib/api', () => ({
  api: {
    get: apiGetMock,
    upload: uploadMock,
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
    submit: geotagSubmitMock,
  },
}));

vi.mock('../hooks/useQueries', () => ({
  useForwarderTripDetail: () => ({
    data: tripDetailOverrides.data ?? {
      id: 15,
      routeName: 'Hải Phòng - ICD',
      status: 'IN_TRANSIT',
      tripCode: 'TRIP-015',
      customerName: 'SilverSea',
      truckPlate: '51C-12345',
      departureDate: '2026-07-28',
      cargoTypeName: null,
      customerReference: null,
      notes: null,
      instructions: null,
      containers: [{ id: 91, containerTypeId: 3, containerTypeName: '20 feet', containerNumber: 'MSKU1234567' }],
      legs: [{ id: 1, sequence: 1, origin: 'Hải Phòng', destination: 'ICD', km: 100, loadingType: 'HANG' }],
      completionScopes: [],
      expenses: [
        {
          id: 44,
          expenseType: 'LIFTING',
          buyAmount: 250000,
          settlementMethod: 'FORWARDER_ADVANCE',
          canEdit: true,
          activeSettlementId: null,
          updatedAt: '2026-08-04T10:00:00.000Z',
        },
      ],
    },
    isLoading: false,
    error: null,
  }),
  useCreateForwarderContainer: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateForwarderExpense: () => ({ mutate: createExpenseMock, isPending: false }),
  useDeleteForwarderExpense: () => ({ mutate: deleteExpenseMock, isPending: false }),
}));

vi.mock('../hooks/useForwarderQueries', () => ({
  useUpdateForwarderExpense: () => ({ mutate: vi.fn(), isPending: false }),
  useSetForwarderExpenseCompletion: () => ({ mutate: vi.fn(), isPending: false }),
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
    awaitAccurateSample: awaitAccurateSampleMock,
    fatalError: null,
    retry: vi.fn(),
    sample: null,
    isSubmitReady: false,
    isWatching: false,
  }),
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('../components/UI', () => ({
  StatusPill: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfirm: () => ({ confirm: confirmMock, dialog: null }),
}));

vi.mock('../components/trip/TripLegsPanel', () => ({
  default: () => null,
}));

vi.mock('../features/forwarder/forwarder-trip-detail-sections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/forwarder/forwarder-trip-detail-sections')>();
  return {
    ...actual,
    ForwarderTripLoading: () => <div>loading</div>,
    ForwarderTripError: () => <div>error</div>,
    ForwarderContainersSection: () => null,
    ForwarderExpenseRow: ({
      exp,
      uploadingExpenseId,
      onUpload,
      onDelete,
    }: {
      exp: { id: number };
      uploadingExpenseId: number | null;
      onUpload: (expenseId: number, file: File) => void;
      onDelete: (expenseId: number) => void;
    }) => {
      renderHistory.push(uploadingExpenseId);
      return (
        <div>
          <button type="button" onClick={() => onUpload(exp.id, new File(['photo'], 'proof.jpg', { type: 'image/jpeg' }))}>
            Tải ảnh chứng từ
          </button>
          <button type="button" onClick={() => onDelete(exp.id)}>Xóa chi phí thử nghiệm</button>
          <span>{uploadingExpenseId === exp.id ? 'Đang tải ảnh' : 'Sẵn sàng'}</span>
        </div>
      );
    },
  };
});

import ForwarderTripDetailPage from './ForwarderTripDetailPage';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/my-forwarder-trips/15']}>
        <Routes>
          <Route path="/my-forwarder-trips/:id" element={<ForwarderTripDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ForwarderTripDetailPage photo upload geolocation recovery', () => {
  beforeEach(() => {
    awaitAccurateSampleMock.mockReset();
    apiGetMock.mockReset();
    uploadMock.mockReset();
    listSuppliersMock.mockReset();
    resolveLiftPriceMock.mockReset();
    createExpenseMock.mockReset();
    geotagSubmitMock.mockReset();
    toastMock.mockReset();
    confirmMock.mockReset();
    deleteExpenseMock.mockReset();
    renderHistory.splice(0, renderHistory.length);
    listSuppliersMock.mockResolvedValue({ items: [] });
    resolveLiftPriceMock.mockResolvedValue({
      suggestedPrice: 950000,
      liftPricingId: 22,
      effectiveDate: '2026-07-01',
      source: 'MATRIX',
    });
    createExpenseMock.mockImplementation((_payload, options) => options?.onSuccess?.());
    apiGetMock.mockResolvedValue({ items: [] });
  });

  it('requires confirmation before deleting and preserves the concurrency token', async () => {
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Xóa chi phí thử nghiệm' }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(deleteExpenseMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Xóa chi phí thử nghiệm' }));
    await waitFor(() => expect(deleteExpenseMock).toHaveBeenCalledWith({
      id: 44,
      tripId: 15,
      expectedUpdatedAt: '2026-08-04T10:00:00.000Z',
    }));
  });

  it('fills the lift buy amount from the selected port and container matrix', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    fireEvent.change(screen.getByDisplayValue('— Chọn cảng —'), { target: { value: '7' } });

    await waitFor(() => expect(resolveLiftPriceMock).toHaveBeenCalledWith({
      portId: 7,
      containerTypeId: 3,
      direction: 'LIFT_UP',
      loadState: 'LOADED',
      date: expect.any(String),
    }));
    await waitFor(() => expect((screen.getAllByPlaceholderText('0')[0] as HTMLInputElement).value).toBe('950000'));
    expect(screen.getByText(/Áp tự động 950.000 VNĐ/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Số hóa đơn'), { target: { value: 'HD-LIFT-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chi phí' }));
    await waitFor(() => expect(createExpenseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        portId: 7,
        containerTypeId: 3,
        loadState: 'LOADED',
      }),
      expect.any(Object),
    ));
  });

  it('keeps the visible advance method and submitted payload on the canonical OPS_ADVANCE value', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    const method = screen.getByDisplayValue('Chi hộ tạm ứng');
    expect(method).toHaveValue('OPS_ADVANCE');
    fireEvent.change(method, { target: { value: 'COMPANY_DIRECT' } });
    expect(method).toHaveValue('COMPANY_DIRECT');
    fireEvent.change(method, { target: { value: 'OPS_ADVANCE' } });
    expect(method).toHaveValue('OPS_ADVANCE');
    fireEvent.change(screen.getByDisplayValue('— Chọn cảng —'), { target: { value: '7' } });
    await waitFor(() => expect((screen.getAllByPlaceholderText('0')[0] as HTMLInputElement).value).toBe('950000'));
    fireEvent.change(screen.getByPlaceholderText('Số hóa đơn'), { target: { value: 'HD-DIRECT-OPS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chi phí' }));
    await waitFor(() => expect(createExpenseMock).toHaveBeenCalledWith(
      expect.objectContaining({ settlementMethod: 'OPS_ADVANCE', buyAmount: 950000 }),
      expect.any(Object),
    ));
  });

  it('reapplies the same matrix suggestion for a consecutive expense entry', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    fireEvent.change(screen.getByDisplayValue('— Chọn cảng —'), { target: { value: '7' } });
    await waitFor(() => expect((screen.getAllByPlaceholderText('0')[0] as HTMLInputElement).value).toBe('950000'));
    fireEvent.change(screen.getByPlaceholderText('Số hóa đơn'), { target: { value: 'HD-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chi phí' }));
    await waitFor(() => expect(createExpenseMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    fireEvent.change(screen.getByDisplayValue('— Chọn cảng —'), { target: { value: '7' } });

    await waitFor(() => expect((screen.getAllByPlaceholderText('0')[0] as HTMLInputElement).value).toBe('950000'));
  });

  it.each([
    {
      name: 'permission denied',
      error: Object.assign(new Error('Ứng dụng chưa được cấp quyền truy cập vị trí'), { code: 1, name: 'GeolocationError' }),
      expectedMessage: 'cho phép truy cập vị trí',
    },
    {
      name: 'timeout',
      error: Object.assign(new Error('GPS phản hồi chậm'), { code: 3, name: 'GeolocationError' }),
      expectedMessage: 'GPS phản hồi chậm',
    },
  ])('clears the busy state and shows recoverable Vietnamese copy on $name', async ({ error, expectedMessage }) => {
    awaitAccurateSampleMock.mockRejectedValue(error);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Tải ảnh chứng từ' }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'error',
        message: expect.stringContaining(expectedMessage),
      })),
    );
    expect(uploadMock).not.toHaveBeenCalled();
    expect(geotagSubmitMock).not.toHaveBeenCalled();
    expect(renderHistory).toContain(44);
    expect(renderHistory.at(-1)).toBeNull();
    expect(screen.getByText('Sẵn sàng')).toBeTruthy();
  });

  it('keeps a stored photo visible and reports only the GPS metadata failure', async () => {
    awaitAccurateSampleMock.mockResolvedValue({
      lat: 10.77,
      lng: 106.7,
      accuracy: 8,
      timestamp: '2026-07-28T15:30:00.000Z',
    });
    uploadMock.mockResolvedValue({ id: 501 });
    geotagSubmitMock.mockRejectedValue(new Error('GPS metadata unavailable'));
    apiGetMock.mockResolvedValue({
      items: [{ id: 501, storageKey: 'forwarder-expenses/501.jpg' }],
    });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Tải ảnh chứng từ' }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        kind: 'warning',
        message: expect.stringContaining('Ảnh đã được tải lên'),
      }),
    );
    expect(apiGetMock).toHaveBeenCalledWith('/forwarder/me/expenses/44/photos');
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(geotagSubmitMock).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'trip_expense_photo',
      entityId: 501,
    }));
    expect(renderHistory.at(-1)).toBeNull();
    expect(screen.getByText('Sẵn sàng')).toBeTruthy();
  });
});


// Terminal handoff (QA-058): a completed/canceled trip never advertises the
// paper-handoff action the server guard would reject — the card explains the
// dispatcher-owned correction route instead; active trips keep the flow.
describe('ForwarderTripDetailPage terminal handoff', () => {
  const baseTrip = {
    id: 19,
    routeName: 'KCN Quế Võ',
    status: 'COMPLETED',
    tripCode: 'TRP-202609-0017',
    customerName: 'SilverSea',
    truckPlate: '15H-104.03',
    departureDate: '2026-09-13',
    orderExchangeStatus: 'COMPLETED',
    paperOrderCollectedAt: null,
    paperOrderCollectedByName: null,
    cargoTypeName: null,
    customerReference: null,
    notes: null,
    instructions: null,
    containers: [],
    legs: [],
    completionScopes: [],
    expenses: [],
  };

  it('shows the dispatcher-owned explanation and keeps confirm disabled on a completed trip', () => {
    tripDetailOverrides.data = baseTrip;
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ForwarderTripDetailPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/cần điều vận xử lý/)).toBeTruthy();
    const confirm = screen.queryByRole('button', { name: 'Xác nhận giao lệnh gốc' });
    if (confirm) expect((confirm as HTMLButtonElement).disabled).toBe(true);
    unmount();
    tripDetailOverrides.data = undefined;
  });

  it('keeps the handoff flow enabled on an active trip with exchange completed', () => {
    tripDetailOverrides.data = { ...baseTrip, status: 'IN_TRANSIT' };
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ForwarderTripDetailPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getAllByText(/Đã đổi lệnh/).length).toBeGreaterThan(0);
    const confirm = screen.getByRole('button', { name: 'Xác nhận giao lệnh gốc' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    unmount();
    tripDetailOverrides.data = undefined;
  });
});
