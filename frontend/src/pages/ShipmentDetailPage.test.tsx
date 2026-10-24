import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, ShipmentCusBucket, ShipmentDocumentCustody, ShipmentStatus } from '@tingting/shared';
import type { ShipmentCusWorkspaceListItem, ShipmentCusWorkspaceDetail } from '@tingting/shared';
import type { ShipmentDetail as ShipmentDetailData } from '../api/shipmentClient';

const { getShipmentDetailMock, listShipmentEventsMock, deleteCusShipmentMock, createDeclarationMock, deleteDeclarationMock, getCusShipmentWorkspaceDetailMock, updateShipmentMock, updateShipmentDeclarationMock, currentUser } = vi.hoisted(() => ({
  getShipmentDetailMock: vi.fn(),
  listShipmentEventsMock: vi.fn(),
  deleteCusShipmentMock: vi.fn(),
  createDeclarationMock: vi.fn(),
  deleteDeclarationMock: vi.fn(),
  getCusShipmentWorkspaceDetailMock: vi.fn(),
  updateShipmentMock: vi.fn(),
  updateShipmentDeclarationMock: vi.fn(),
  currentUser: {
    userId: 11,
    role: 'ADMIN',
    capabilities: ['shipments.read', 'shipments.write'],
  },
}));

vi.mock('../api/shipmentClient', () => ({
  getShipmentDetail: getShipmentDetailMock,
  getCusShipmentWorkspaceDetail: getCusShipmentWorkspaceDetailMock,
  deleteCusShipment: deleteCusShipmentMock,
  createShipmentDeclaration: createDeclarationMock,
  deleteShipmentDeclaration: deleteDeclarationMock,
  updateShipment: updateShipmentMock,
  updateShipmentDeclaration: updateShipmentDeclarationMock,
}));

vi.mock('../api/customerServiceFinanceClient', () => ({
  customerServiceFinanceClient: { listShipmentEvents: listShipmentEventsMock },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: currentUser,
  }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import ShipmentDetailPage from './ShipmentDetailPage';
import { ToastProvider } from '../components/shared/Toast';

const detail: ShipmentDetailData = {
  shipment: {
    id: 1,
    shipmentCode: 'CUS-0001',
    version: 7,
    customerId: 101,
    responsibleUnitId: null,
    status: ShipmentStatus.READY_FOR_DISPATCH,
    bookingRef: 'BOOK-001',
    blNumber: 'BL-001',
    expectedDeliveryDate: '2026-08-15',
    pickupLocation: 'Cảng Hải Phòng',
    deliveryLocation: 'Kho Hà Nội',
    contactName: 'Nguyễn Văn A',
    contactPhone: '0909123456',
    tradeDirection: 'IMPORT',
    cargoMode: 'FCL',
    operationalSiteId: null,
    pickupWarehouseSiteId: null,
    factoryName: 'Nhà máy Hải Phòng',
    shippingLineName: 'Maersk',
    customsCutoffAt: null,
    closingAt: null,
    plannedReturnAt: null,
    cargoWeightKg: null,
    cargoVolumeCbm: null,
    packageCount: null,
    packageType: null,
    operationalNotes: 'Lô thử nghiệm',
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    pricingProjection: null,
    carrierAllocationSummary: null,
    accountingLock: null,
    customerName: 'Công ty Silver Sea',
    effectiveFactoryName: 'Nhà máy Hải Phòng',
    pickupWarehouseSiteName: null,
    pickupWarehouseSiteType: null,
    routeName: 'Hải Phòng – NEWEB',
  },
  containers: [],
  documents: [],
  declarations: [],
  statusHistory: [],
  pendingChangeRequests: [],
  podReviews: [],
  carrierAssignments: [],
  accountingLock: {
    billingDocumentId: 44,
    billingDocumentNumber: 'DN-2026-0044',
    activatedAt: '2026-08-11T02:00:00.000Z',
    activatedByName: 'Nguyễn CUS',
    reason: 'Khóa theo nguồn CUS hiện hành',
  },
};

describe('ShipmentDetailPage', () => {
  beforeEach(() => {
    getShipmentDetailMock.mockReset();
    getShipmentDetailMock.mockResolvedValue(detail);
    listShipmentEventsMock.mockResolvedValue({ items: [] });
    getCusShipmentWorkspaceDetailMock.mockReset();
    updateShipmentMock.mockReset();
    updateShipmentMock.mockResolvedValue({ version: 8 });
    updateShipmentDeclarationMock.mockReset();
  });

  it('uses padded Vietnam business datetimes in details and lock metadata', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      shipment: { ...detail.shipment, createdAt: '2026-09-01T18:04:59.000Z' },
    });
    listShipmentEventsMock.mockResolvedValue({ items: [{
      id: 21, eventType: 'DOCUMENT_UPDATE', title: 'Đã cập nhật chứng từ',
      message: 'Đã nhận tờ khai', occurredAt: '2026-09-01T18:05:59.000Z', version: 1,
    }] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('01:04 02/09/2026')).toBeTruthy();
    expect(await screen.findByText('01:05 02/09/2026')).toBeTruthy();
    expect(screen.getByText(/Khóa lô do CUS/).textContent).toContain('09:00 11/08/2026');
    expect(screen.getByText('Cut-off hải quan').nextElementSibling?.textContent).toBe('—');
  });

  // Card 101026163030 (FB-069) + the format half of card 101026163040
  // (FB-074): the detail header echoed the raw numeric columns, so an LCL
  // lot's "500.00" / "2.000" leaked their storage decimals while the
  // overview showed "0,5 tấn" / "2 CBM". Weight rides the house measure axis
  // (formatWeight, tấn since CUS-08) and volume the same formatQuantity the
  // overview rows use.
  it('formats weight and volume through the house measure axis, not the raw column', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      shipment: {
        ...detail.shipment,
        cargoMode: 'LCL',
        cargoWeightKg: '500.00',
        cargoVolumeCbm: '2.000',
        packageCount: 10,
        packageType: 'thùng',
      },
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    // Both the header fact and the containers card now label the fact
    // "Trọng lượng" (the tấn unit rides the value), so scope to the first.
    const weightCell = (await screen.findAllByText('Trọng lượng'))[0]!.nextElementSibling;
    expect(weightCell?.textContent).toBe('0,5 tấn');
    expect(screen.queryByText('500.00')).toBeNull();

    const volumeCell = screen.getByText('Thể tích').nextElementSibling;
    expect(volumeCell?.textContent).toBe('2 CBM');
    expect(screen.queryByText('2.000 CBM')).toBeNull();
  });

  // Card 101026163040 (FB-074): the overview identity line names the lot's
  // route while the detail header had no route fact at all — for a
  // container-less LCL lot the route appeared nowhere on the detail page.
  it('names the lot route in the detail header (same fact as the overview)', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    const routeCell = (await screen.findByText('Tuyến đường')).nextElementSibling;
    expect(routeCell?.textContent).toBe('Hải Phòng – NEWEB');
  });

  // FB-113 (card 171026122140) — R24/R25 "standing": /shipments/:id shares the
  // nav title "Chi tiết lô hàng" with the /shipments-detail ledger and is the
  // surface QA's "header thiếu Số tờ khai, thứ tự sai" points at (the popup
  // v1 and ledger v2 fixes never reached it). The header card presents the
  // documents group in the card's order — Bill/Booking → Số tờ khai →
  // Xuất/Nhập → Hãng tàu — with the lot's tờ khai numbers carried in the
  // header itself, not only in the section below.
  it('presents the documents group in the FB-113 order with Số tờ khai in the header', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      declarations: [
        { id: 9, shipmentId: 1, declarationNumber: 'TK-2026-001', issuedAt: '2026-08-10T00:00:00.000Z', scope: 'SINGLE', note: null, createdBy: 11, createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z' },
        { id: 10, shipmentId: 1, declarationNumber: 'TK-2026-002', issuedAt: '2026-08-10T00:00:00.000Z', scope: 'SINGLE', note: null, createdBy: 11, createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z' },
      ],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    await screen.findByText('Số Bill / Số Booking');
    const dts = Array.from(document.querySelectorAll('.shipment-detail__fields dt')).map((dt) => dt.textContent?.trim());
    const idx = (name: string) => {
      const at = dts.indexOf(name);
      expect(at).toBeGreaterThanOrEqual(0);
      return at;
    };
    // The documents group sits right after Khách hàng and reads in the
    // FB-113 order — adjacent, no unrelated field interleaved.
    expect(dts.slice(idx('Khách hàng') + 1, idx('Hãng tàu') + 1)).toEqual([
      'Số Bill / Số Booking',
      'Số tờ khai',
      'Xuất / Nhập',
      'Hãng tàu',
    ]);
    // Số Bill / Số Booking is ONE direction-exclusive reference line (BL wins).
    expect(screen.getByText('Số Bill / Số Booking').nextElementSibling?.textContent).toBe('BL-001');
    // Số tờ khai joins every declaration number, right in the header.
    expect(screen.getByText('Số tờ khai').nextElementSibling?.textContent).toBe('TK-2026-001, TK-2026-002');
  });

  // Card 261022213755c (TiepVu 22/10-2): hàng lẻ đọc "Nhập lẻ"/"Xuất lẻ" ở
  // dòng Xuất / Nhập — FCL giữ nguyên "Nhập"/"Xuất".
  it.each([
    { cargoMode: 'FCL', tradeDirection: 'IMPORT', expected: 'Nhập' },
    { cargoMode: 'FCL', tradeDirection: 'EXPORT', expected: 'Xuất' },
    { cargoMode: 'LCL', tradeDirection: 'IMPORT', expected: 'Nhập lẻ' },
    { cargoMode: 'LCL', tradeDirection: 'EXPORT', expected: 'Xuất lẻ' },
  ] as const)('header Xuất / Nhập reads "$expected" for a $cargoMode $tradeDirection lot', async ({ cargoMode, tradeDirection, expected }) => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      shipment: { ...detail.shipment, cargoMode, tradeDirection },
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );
    expect((await screen.findByText('Xuất / Nhập')).nextElementSibling?.textContent).toBe(expected);
  });

  // ── CUS-11 (card 211026125915) ────────────────────────────────────────────
  // The header used to read ONLY the lot-level declaration rows, so a lot
  // whose containers each carry their per-cont số tờ khai (card 261013200312
  // — CUS enters it per container) still showed "—": QA read the header as an
  // unimplemented feature. Lot rows keep precedence; the first per-container
  // number stands in when the lot has none; only zero-declarations-anywhere
  // reads "Chưa có", with the add-flow link beside it.
  const containerRow = (id: number, containerNumber: string, declarationNumber: string | null) => ({
    id,
    shipmentId: 1,
    containerTypeId: null,
    containerNumber,
    sealNumber: null,
    cargoWeightKg: null,
    notes: null,
    declarationNumber,
  });

  const renderDetail = async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('Số Bill / Số Booking');
  };

  it('CUS-11: header shows the FIRST per-container tờ khai when the lot has no lot-level declaration', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      accountingLock: null,
      declarations: [],
      containers: [
        containerRow(21, 'MSCU1111111', null),
        containerRow(22, 'MSCU2222222', 'TK-CONT-222'),
        containerRow(23, 'MSCU3333333', 'TK-CONT-333'),
      ],
    });
    await renderDetail();

    const dd = screen.getByText('Số tờ khai').nextElementSibling;
    // First NON-EMPTY per-container number in the lot — not "—", not a join.
    expect(dd?.textContent).toBe('TK-CONT-222');
    // The value names its source so the provenance is not a guess.
    expect(dd?.getAttribute('title')).toContain('container');
  });

  it('CUS-11: lot-level declarations keep precedence over per-container numbers', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      accountingLock: null,
      declarations: [
        { id: 9, shipmentId: 1, declarationNumber: 'TK-LOT-1', issuedAt: null, scope: 'SINGLE', note: null, createdBy: 11, createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z' },
      ],
      containers: [containerRow(21, 'MSCU1111111', 'TK-CONT-1')],
    });
    await renderDetail();

    expect(screen.getByText('Số tờ khai').nextElementSibling?.textContent).toBe('TK-LOT-1');
  });

  it('CUS-11: a zero-decl lot reads "Chưa có" with all 4 labels, and the header link opens the shared Thêm tờ khai modal', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      accountingLock: null,
      declarations: [],
      containers: [containerRow(21, 'MSCU1111111', null)],
    });
    await renderDetail();

    const dd = screen.getByText('Số tờ khai').nextElementSibling;
    expect(dd?.textContent).toContain('Chưa có');
    // The documents group stays complete and in the FB-113 order — an empty
    // value never drops its label.
    const dts = Array.from(document.querySelectorAll('.shipment-detail__fields dt')).map((dt) => dt.textContent?.trim());
    const four = ['Số Bill / Số Booking', 'Số tờ khai', 'Xuất / Nhập', 'Hãng tàu'];
    const at = four.map((f) => dts.indexOf(f)).sort((a, b) => a - b);
    expect(at.every((v) => v >= 0)).toBe(true);
    expect(at[3]! - at[0]!).toBe(3);

    // The link opens the SAME modal the section's button owns.
    fireEvent.click(screen.getByRole('button', { name: 'Thêm tờ khai' }));
    expect(await screen.findByPlaceholderText('Nhập số tờ khai...')).toBeTruthy();
    expect(createDeclarationMock).not.toHaveBeenCalled();
  });

  it('CUS-11: roles that cannot manage declarations see the honest "Chưa có" without the header link', async () => {
    currentUser.role = Role.ACCOUNTANT;
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      accountingLock: null,
      declarations: [],
      containers: [],
    });
    await renderDetail();

    const dd = screen.getByText('Số tờ khai').nextElementSibling;
    expect(dd?.textContent).toContain('Chưa có');
    // No header link for a role the declaration writes reject — the value
    // states the gap without offering an affordance the API would 403.
    expect(dd?.querySelector('.shipment-detail__decl-link')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm tờ khai' })).toBeNull();
    // Restore the shared mock's default for tests declared after this one.
    currentUser.role = Role.ADMIN;
  });

  it('keeps the FB-113 header reference readable when the lot has neither Bill nor Booking yet', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      shipment: { ...detail.shipment, blNumber: null, bookingRef: null },
      declarations: [],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    await screen.findByText('Số Bill / Số Booking');
    expect(screen.getByText('Số Bill / Số Booking').nextElementSibling?.textContent).toBe('Chưa có số Bill/Booking');
    // CUS-11 (card 211026125915): zero-decl lot reads the named "Chưa có"
    // (never the dead "—"), and the header carries the add-flow link — this
    // fixture's lot is accounting-locked, so the link renders disabled with
    // the lock reason, mirroring the section button.
    expect(screen.getByText('Số tờ khai').nextElementSibling?.textContent).toContain('Chưa có');
    const headerDeclLink = screen.getByRole('button', { name: 'Thêm tờ khai' });
    expect(headerDeclLink).toBeDisabled();
    expect(headerDeclLink.getAttribute('title')).toBe('Lô hàng đã khóa kế toán; không thể sửa tờ khai.');
  });

  it('shows CUS lock metadata without exposing the removed dossier action', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Khóa lô do CUS/)).toBeTruthy();
    expect(screen.getAllByText('BL-001').length).toBeGreaterThan(0);
    expect(screen.queryByText('CUS-0001')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Cập nhật & điều xe' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đã khóa bởi CUS' })).toBeNull();
    expect(screen.queryByText(/Đã khóa bởi Kế toán/)).toBeNull();
    await waitFor(() => expect(getShipmentDetailMock).toHaveBeenCalledWith(1));
  });

  it('renders the [KẸP]/[KẾT HỢP] tag next to the container number (LoHangKepKetHop §3.2)', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      containers: [{
        id: 7,
        shipmentId: 1,
        containerTypeId: null,
        containerNumber: 'TGHU1234567',
        sealNumber: null,
        cargoWeightKg: null,
        notes: null,
        pairKind: 'KEP',
      }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('TGHU1234567')).toBeTruthy();
    expect(screen.getByText('[KẸP]')).toBeTruthy();
  });

  it('renders the state-aware carrier section for an unassigned lot', async () => {
    getShipmentDetailMock.mockResolvedValue({ ...detail, carrierAssignments: [] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Nhà xe')).toBeTruthy();
    expect(screen.getByText('Chưa phân nhà xe')).toBeTruthy();
    // No "đã gán" heading on an unassigned lot (user ruling).
    expect(screen.queryByText('Nhà xe đã gán')).toBeNull();
  });

  it('keeps the assigned rendering when carrier assignments exist', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      containers: [{
        id: 21,
        shipmentId: 1,
        containerTypeId: 4,
        containerTypeCode: '40HC',
        containerTypeName: "40'HC",
        containerNumber: 'QATU0900001',
        sealNumber: null,
        cargoWeightKg: null,
        deletedAt: null,
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      }],
      carrierAssignments: [{
        fulfillmentId: 31,
        fulfillmentVersion: 1,
        shipmentContainerId: 21,
        containerTypeCode: '40HC',
        containerTypeName: "40'HC",
        carrierType: 'OWN',
        externalCarrierId: null,
        externalCarrierName: null,
      }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    // The heading and the containers-table column share the label.
    expect((await screen.findAllByText('Nhà xe đã gán')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Đội xe nội bộ SilverSea').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Chưa phân nhà xe')).toBeNull();
  });

  it('keeps the assigned rendering for a 45ft container too (non-20/40 size)', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      containers: [{
        id: 21,
        shipmentId: 1,
        containerTypeId: 7,
        containerTypeCode: '45HC',
        containerTypeName: "45'HC",
        containerNumber: 'MEDU4927126',
        sealNumber: null,
        cargoWeightKg: null,
        deletedAt: null,
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      }],
      carrierAssignments: [{
        fulfillmentId: 31,
        fulfillmentVersion: 1,
        shipmentContainerId: 21,
        containerTypeCode: '45HC',
        containerTypeName: "45'HC",
        carrierType: 'OWN',
        externalCarrierId: null,
        externalCarrierName: null,
      }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    // A 45'HC has no 20/40 bucket but IS a real carrier assignment — the
    // section must not fall back to the unassigned wording (the chip simply
    // omits the size counts).
    expect((await screen.findAllByText('Nhà xe đã gán')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Đội xe nội bộ SilverSea').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Chưa phân nhà xe')).toBeNull();
  });

  it('renders unassigned wording when a fulfillment exists but no carrier does (decomposed-carrier-null)', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      containers: [{
        id: 22,
        shipmentId: 1,
        containerTypeId: 4,
        containerTypeCode: '40HC',
        containerTypeName: "40'HC",
        containerNumber: 'QATU0900043',
        sealNumber: null,
        cargoWeightKg: null,
        deletedAt: null,
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      }],
      carrierAssignments: [{
        fulfillmentId: 41,
        fulfillmentVersion: 1,
        shipmentContainerId: 22,
        containerTypeCode: '40HC',
        containerTypeName: "40'HC",
        carrierType: null,
        externalCarrierId: null,
        externalCarrierName: null,
      }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    // Fulfillment presence must NOT flip the section to "đã gán": the state
    // keys on carrier presence (user's reported scenario, 9e refined ruling).
    expect((await screen.findAllByText('Nhà xe')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Chưa phân nhà xe')).toBeTruthy();
    expect(screen.queryByText('Nhà xe đã gán')).toBeNull();
  });

  it('keeps the assigned rendering for an LCL fulfillment with no container row', async () => {
    getShipmentDetailMock.mockResolvedValue({
      ...detail,
      containers: [],
      carrierAssignments: [{
        fulfillmentId: 51,
        fulfillmentVersion: 1,
        shipmentContainerId: null,
        containerTypeCode: null,
        containerTypeName: null,
        carrierType: 'OWN',
        externalCarrierId: null,
        externalCarrierName: null,
      }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
          <Routes>
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          </Routes>
        </MemoryRouter></ToastProvider>
      </QueryClientProvider>,
    );

    // An LCL assignment has no container to resolve (the backend left join
    // returns null container fields for it) — it is still a real carrier
    // assignment, so the section must not fall back to the unassigned
    // wording and the OWN fleet chip must render.
    expect((await screen.findAllByText('Nhà xe đã gán')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Đội xe nội bộ SilverSea').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Chưa phân nhà xe')).toBeNull();
  });

  describe('Xóa lô affordance (card 091026225720)', () => {
    it('offers the lot-delete button to ADMIN and CUS on a deletable lot', async () => {
      currentUser.role = Role.ADMIN;
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      expect(await screen.findByRole('button', { name: /Xóa lô/ })).toBeTruthy();

      currentUser.role = Role.CUS;
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      expect(await screen.findByRole('button', { name: /Xóa lô/ })).toBeTruthy();
    });

    it('hides the lot-delete button from roles the delete route refuses (ACCOUNTANT, DISPATCHER)', async () => {
      currentUser.role = Role.ACCOUNTANT;
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      await screen.findByText('Khách hàng');
      expect(screen.queryByRole('button', { name: /Xóa lô/ })).toBeNull();

      currentUser.role = Role.DISPATCHER;
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      await screen.findByText('Khách hàng');
      expect(screen.queryByRole('button', { name: /Xóa lô/ })).toBeNull();
    });

    it('blocks deletion with warning when shipment status is DISPATCHED', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue({
        ...detail,
        shipment: { ...detail.shipment, status: ShipmentStatus.DISPATCHED },
      });
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      const deleteBtn = await screen.findByRole('button', { name: /Xóa lô/ });
      fireEvent.click(deleteBtn);
      expect(await screen.findByText(/Không thể xóa lô hàng đã có container được điều xe/)).toBeTruthy();
      expect(deleteCusShipmentMock).not.toHaveBeenCalled();
    });

    it('opens confirm modal, requires reason, and calls deleteCusShipment on confirm', async () => {
      currentUser.role = Role.ADMIN;
      deleteCusShipmentMock.mockResolvedValue(undefined);
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      const deleteBtn = await screen.findByRole('button', { name: /Xóa lô/ });
      fireEvent.click(deleteBtn);

      expect(await screen.findByText(/Xóa lô hàng sẽ loại bỏ hoàn toàn dữ liệu/)).toBeTruthy();
      const confirmBtn = screen.getByRole('button', { name: 'Xác nhận xóa' });
      expect(confirmBtn).toBeDisabled();

      const reasonInput = screen.getByPlaceholderText(/Nhập lý do xóa lô hàng/);
      fireEvent.change(reasonInput, { target: { value: 'Lô tạo nhầm trong đợt kiểm thử FB-031' } });
      expect(confirmBtn).not.toBeDisabled();

      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(deleteCusShipmentMock).toHaveBeenCalledWith(1, 7, 'Lô tạo nhầm trong đợt kiểm thử FB-031');
      });
    });
  });

  // FB-005 (round 16): the 'Tờ khai hải quan' section on the detail page was
  // read-only only — authorized roles had no '+ Thêm tờ khai' button and no
  // per-row delete, while declaration CRUD already serves the CUS quick-edit.
  // The affordances mirror the workspace fieldAccess model for
  // declarationNumber: CUS/ADMIN/MANAGER may write, a locked lot disables.
  describe('Tờ khai hải quan affordances (FB-005)', () => {
    const unlocked = { ...detail, accountingLock: null };
    const declarationRow: ShipmentDetailData['declarations'][number] = {
      id: 9,
      shipmentId: 1,
      declarationNumber: 'TK-0055',
      issuedAt: '2026-08-10T00:00:00.000Z',
      scope: 'SINGLE',
      note: null,
      createdBy: 11,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };

    beforeEach(() => {
      createDeclarationMock.mockReset();
      deleteDeclarationMock.mockReset();
    });

    it('renders the add affordance for ADMIN and CUS on an unlocked lot, empty or not', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue(unlocked);
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      expect(await screen.findByText('Chưa có tờ khai nào.')).toBeTruthy();
      expect(screen.getByRole('button', { name: '+ Thêm tờ khai' })).toBeTruthy();

      currentUser.role = Role.CUS;
      getShipmentDetailMock.mockResolvedValue({ ...unlocked, declarations: [declarationRow] });
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/2']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      expect(await screen.findByRole('button', { name: '+ Thêm tờ khai' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Xóa tờ khai TK-0055' })).toBeTruthy();
    });

    it('hides both affordances from roles the declaration routes refuse (ACCOUNTANT, DISPATCHER)', async () => {
      currentUser.role = Role.ACCOUNTANT;
      getShipmentDetailMock.mockResolvedValue({ ...unlocked, declarations: [declarationRow] });
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      await screen.findAllByText('TK-0055');
      expect(screen.queryByRole('button', { name: '+ Thêm tờ khai' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Xóa tờ khai TK-0055' })).toBeNull();

      currentUser.role = Role.DISPATCHER;
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      await screen.findAllByText('TK-0055');
      expect(screen.queryByRole('button', { name: '+ Thêm tờ khai' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Xóa tờ khai TK-0055' })).toBeNull();
    });

    it('disables both affordances while the accounting lock is active', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue({ ...detail, declarations: [declarationRow] });
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      expect(await screen.findAllByText('TK-0055')).toBeTruthy();
      expect(screen.getByRole('button', { name: '+ Thêm tờ khai' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Xóa tờ khai TK-0055' })).toBeDisabled();
    });

    it('add flow requires a number, then creates the declaration and refetches', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue(unlocked);
      createDeclarationMock.mockResolvedValue({ ...declarationRow, declarationNumber: 'TK-0721' });
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole('button', { name: '+ Thêm tờ khai' }));

      // CUS-11: the header also links into this flow on a zero-decl lot, so
      // the modal's confirm button is scoped to the dialog, never ambiguous
      // against the header link.
      const dialog = await screen.findByRole('dialog');
      const confirmBtn = within(dialog).getByRole('button', { name: 'Thêm tờ khai' });
      expect(confirmBtn).toBeDisabled();

      const numberInput = within(dialog).getByPlaceholderText('Nhập số tờ khai...');
      expect(numberInput.className).toContain('input');
      fireEvent.change(numberInput, { target: { value: ' TK-0721 ' } });
      expect(confirmBtn).not.toBeDisabled();

      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(createDeclarationMock).toHaveBeenCalledWith(1, { declarationNumber: 'TK-0721' });
      });
      await waitFor(() => {
        expect(getShipmentDetailMock).toHaveBeenCalledTimes(2);
      });
    });

    it('delete flow confirms, then removes the declaration row and refetches', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue({ ...unlocked, declarations: [declarationRow] });
      deleteDeclarationMock.mockResolvedValue(undefined);
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Xóa tờ khai TK-0055' }));

      expect(await screen.findByText(/Xóa tờ khai TK-0055 khỏi lô hàng/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận xóa' }));
      await waitFor(() => {
        expect(deleteDeclarationMock).toHaveBeenCalledWith(1, 9);
      });
      await waitFor(() => {
        expect(getShipmentDetailMock).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Khai chi phí affordance (FB-098 — card 141026230750)', () => {
    it('offers Khai chi phí to the cost-declaring roles on an unlocked lot and opens the drawer flow', async () => {
      currentUser.role = Role.ACCOUNTANT;
      getShipmentDetailMock.mockResolvedValue({ ...detail, accountingLock: null });
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole('button', { name: /Khai chi phí/ }));
      expect(await screen.findByText('Đang tải danh mục khoản chi…')).toBeTruthy();
    });

    it('hides Khai chi phí from roles without cost write and while the accounting lock is active', async () => {
      currentUser.role = Role.DISPATCHER;
      getShipmentDetailMock.mockResolvedValue({ ...detail, accountingLock: null });
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      await screen.findByText('Khách hàng');
      expect(screen.queryByRole('button', { name: /Khai chi phí/ })).toBeNull();

      currentUser.role = Role.ACCOUNTANT;
      getShipmentDetailMock.mockResolvedValue(detail);
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      await screen.findByText(/Khóa lô do CUS/);
      expect(screen.queryByRole('button', { name: /Khai chi phí/ })).toBeNull();
    });
  });

  // ── FB-086 (card 171026113520): container composition on the detail screen ─
  // The helpdesk report was "Containers (0)" with no way to add one. The lot's
  // container rows are already written by the create path, so the detail
  // surface owes the user two things: the REAL count and the composition
  // point.
  describe('Containers + Thêm container (FB-086)', () => {
    const container = (
      overrides: Partial<ShipmentDetailData['containers'][number]>,
    ): ShipmentDetailData['containers'][number] => ({
      id: 501,
      shipmentId: 1,
      containerTypeId: 4,
      containerTypeCode: '40DC',
      containerTypeName: "40'DC",
      containerNumber: 'MSKU1234567',
      sealNumber: null,
      cargoWeightKg: null,
      notes: null,
      ...overrides,
    });

    // Card 261022095235b: the management host's workspace-detail feed — the
    // same shape the drawer's ledger consumes.
    const managementWorkspaceDetail = {
      summary: {
        id: 1,
        version: 4,
        cargoMode: 'FCL',
        fieldAccess: { declarationNumber: { mode: 'DIRECT', reason: null } },
      },
      containers: [],
      selectors: { routes: [], containerTypes: [], operationalSites: [], externalCarriers: [], carrierVehicles: [], ports: [] },
    } as unknown as ShipmentCusWorkspaceDetail;

    function renderLot() {
      return render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
    }

    it('lists the lot’s containers with the real count', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue({
        ...detail,
        containers: [container({ id: 501 }), container({ id: 502, containerNumber: 'TGHU7654321' })],
      });
      renderLot();
      expect(await screen.findByText('Containers (2)')).toBeTruthy();
      expect(screen.getByText('MSKU1234567')).toBeTruthy();
      expect(screen.getByText('TGHU7654321')).toBeTruthy();
    });

    it('offers the shared management ledger with Thêm container to writers (card 261022095235b supersedes TICKET-09)', async () => {
      currentUser.role = Role.ADMIN;
      // Customer ruling 22/10 09:50 reverses card 171026182554 (TICKET-09):
      // add/remove container works FROM the detail screen again — hosted as
      // the SAME management ledger the /shipments drawer mounts, not a
      // second bespoke dialog.
      getShipmentDetailMock.mockResolvedValue({ ...detail, accountingLock: null, containers: [] });
      getCusShipmentWorkspaceDetailMock.mockResolvedValue(managementWorkspaceDetail);
      renderLot();
      expect(await screen.findByRole('button', { name: /Thêm container/ })).toBeTruthy();
      expect(screen.getByText('Lô hàng chưa có dữ liệu container.')).toBeTruthy();
      // The read-only facts card must not double-list the containers.
      expect(screen.queryByText('Containers (0)')).toBeNull();
    });

    it('keeps the read-only facts section for reader roles (ACCOUNTANT)', async () => {
      currentUser.role = Role.ACCOUNTANT;
      getShipmentDetailMock.mockResolvedValue({ ...detail, accountingLock: null, containers: [] });
      getCusShipmentWorkspaceDetailMock.mockResolvedValue(managementWorkspaceDetail);
      renderLot();
      await screen.findByText('Containers (0)');
      expect(screen.queryByRole('button', { name: /Thêm container/ })).toBeNull();
      // The reader host never even asks for the workspace detail.
      expect(getCusShipmentWorkspaceDetailMock).not.toHaveBeenCalledWith(1);
    });

    it('keeps the read-only facts section on a terminal (COMPLETED) lot', async () => {
      currentUser.role = Role.CUS;
      getShipmentDetailMock.mockResolvedValue({
        ...detail,
        accountingLock: null,
        shipment: { ...detail.shipment, status: 'COMPLETED' },
        containers: [],
      });
      getCusShipmentWorkspaceDetailMock.mockResolvedValue(managementWorkspaceDetail);
      renderLot();
      await screen.findByText('Containers (0)');
      expect(screen.queryByRole('button', { name: /Thêm container/ })).toBeNull();
    });

    it('withholds Thêm container on an LCL lot (an LCL lot owns no container)', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue({
        ...detail,
        shipment: { ...detail.shipment, cargoMode: 'LCL' },
        containers: [],
      });
      renderLot();
      await screen.findByText('Containers (0)');
      expect(screen.queryByRole('button', { name: /Thêm container/ })).toBeNull();
      // Review 22/10 medium #3: LCL keeps the read-only facts section — no
      // dead management card, no workspace-detail fetch for a containerless lot.
      expect(screen.queryByText('Lô hàng chưa có dữ liệu container.')).toBeNull();
      expect(getCusShipmentWorkspaceDetailMock).not.toHaveBeenCalledWith(1);
    });

    it('hides Thêm container while the accounting lock is active', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue({ ...detail, containers: [] });
      renderLot();
      await screen.findByText('Containers (0)');
      expect(screen.queryByRole('button', { name: /Thêm container/ })).toBeNull();
    });
  });

  // ── Sửa lô (FB-086 R29 remainder, steer 21/10; SIL-171 24/10) ────────────
  // Reconciliation: TICKET-09 (card 171026182554) superseded FB-086 at this
  // surface for CONTAINERS — the read-only Containers section here IS the
  // correct state (QA's R29 "no add container" observation is
  // invalid-at-surface). The valid remainder is lot-INFORMATION editing.
  // SIL-171 (FB-147, khách Zalo 24/10 + QA R41): "Sửa lô" now opens the FULL
  // edit FORM (/shipments/:id/edit — the Tạo lô hàng workspace pre-filled,
  // submit = PATCH). The former six-group picker stays reachable as "Sửa
  // nhanh" and still hands the picked group to the SAME shared quick-edit
  // modal (one lot-info editor, two hosts). Roles =
  // SHIPMENT_INTAKE_MUTATION_ROLES (testplan/roles/01-cus.md: CUS "read &
  // write the shipment workspace: create, edit, …").
  describe('Sửa lô affordance (FB-086 R29 remainder)', () => {
    const directAccess = { mode: 'DIRECT' as const, reason: 'Có thể sửa.' };
    const workspaceSummary: ShipmentCusWorkspaceListItem = {
      id: 1,
      version: 7,
      status: ShipmentStatus.READY_FOR_DISPATCH,
      cargoMode: 'FCL',
      bucket: ShipmentCusBucket.PENDING_LOCK,
      bucketLabel: 'Chờ khóa',
      customerName: 'Công ty Silver Sea',
      factoryName: null,
      billOrBookNumber: 'BL-001',
      declarationNumber: null,
      declarationNumbers: [],
      shippingLineName: 'Maersk',
      routeName: null,
      isCombined: false,
      direction: 'IMPORT' as const,
      containerSummary: '0x',
      packageCount: null,
      packageType: null,
      weightKg: null,
      volumeCbm: null,
      transportDate: null,
      customsCutoffAt: null,
      closingAt: null,
      plannedReturnAt: null,
      deliveryLocation: null,
      liftSiteNames: [],
      dropoffSiteNames: [],
      customerAppointmentAts: [],
      effectiveFactoryNames: [],
      appointmentGroups: [],
      carrierAssignments: [],
      customerNotes: null,
      operationalNotes: 'Lô thử nghiệm',
      raw: {
        customerId: 101,
        isAdHoc: false,
        factoryName: null,
        routeId: null,
        deliveryLocation: null,
        blNumber: 'BL-001',
        bookingRef: null,
        declarationNumber: null,
        tradeDirection: 'IMPORT',
        shippingLineName: 'Maersk',
        packageCount: null,
        packageType: null,
        cargoWeightKg: null,
        cargoVolumeCbm: null,
        customsCutoffAt: null,
        closingAt: null,
        plannedReturnAt: null,
        customerNotes: null,
        operationalNotes: 'Lô thử nghiệm',
        declarationId: null,
        declarationIssuedAt: null,
        declarationScope: null,
        declarationNote: null,
        declarations: [],
      },
      fieldAccess: {
        customerId: directAccess,
        factoryName: directAccess,
        routeId: directAccess,
        deliveryLocation: directAccess,
        blNumber: directAccess,
        bookingRef: directAccess,
        declarationNumber: directAccess,
        tradeDirection: directAccess,
        shippingLineName: directAccess,
        packageCount: directAccess,
        packageType: directAccess,
        cargoWeightKg: directAccess,
        cargoVolumeCbm: directAccess,
        customsCutoffAt: directAccess,
        closingAt: directAccess,
        plannedReturnAt: directAccess,
        customerNotes: directAccess,
        operationalNotes: directAccess,
      },
      operational: {
        scheduleReadiness: 'WAITING_DATE',
        vehicleReadiness: 'NO_CONTAINERS',
        totalContainers: 0,
        assignedContainers: 0,
        externalContainers: 0,
        plateAssignedContainers: 0,
        orderIssuedContainers: 0,
        missingCarrierContainers: 0,
        missingPlateContainers: 0,
        transportDateEditable: true,
        deletable: true,
      },
      finance: {
        customerInvoiceTotal: null,
        customerNoInvoiceTotal: null,
        totalCost: null,
        isLoss: false,
        hasPendingRecovery: false,
        customerChargeTotalsAvailable: false,
        totalCostAvailable: false,
      },
      debitNote: {
        available: false,
        billingDocumentId: null,
        documentNumber: null,
        issuedAt: null,
        debitNoteStatus: null,
        disabledReason: null,
      },
      documentCustody: {
        status: ShipmentDocumentCustody.OPS_HOLDING,
        label: 'Ops đang giữ',
        available: true,
        editable: true,
      },
      accountingConfirmation: {
        status: 'UNAVAILABLE' as const,
        confirmationId: null,
        checksum: null,
        billingDocumentId: null,
        confirmedAt: null,
        confirmedByName: null,
      },
      activeLock: null,
      action: {
        kind: 'LOCK' as const,
        label: 'Khóa lô',
        enabled: true,
        disabledReason: null,
      },
    };
    const workspaceDetail = {
      summary: workspaceSummary,
      containers: [],
      selectors: {
        routes: [],
        containerTypes: [],
        operationalSites: [],
        externalCarriers: [],
        carrierVehicles: [],
        ports: [],
      },
      dataState: { hasExplicitDocumentCustody: false },
    };

    function renderLot() {
      return render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
    }

    it.each([Role.ADMIN, Role.CUS, Role.MANAGER, Role.DISPATCHER])(
      'offers Sửa lô to %s — the roles PUT /shipments/:id authorizes',
      async (role) => {
        currentUser.role = role;
        getShipmentDetailMock.mockResolvedValue({ ...detail, accountingLock: null });
        renderLot();
        expect(await screen.findByRole('button', { name: /Sửa lô/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Sửa nhanh' })).toBeTruthy();
      },
    );

    it('hides Sửa lô from ACCOUNTANT (the one reader role the update route refuses)', async () => {
      currentUser.role = Role.ACCOUNTANT;
      getShipmentDetailMock.mockResolvedValue({ ...detail, accountingLock: null });
      renderLot();
      await screen.findByText('Khách hàng');
      expect(screen.queryByRole('button', { name: /Sửa lô/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Sửa nhanh' })).toBeNull();
    });

    it('hides Sửa lô while the accounting lock is active — narrower than the server (notes stay editable on Tổng quan only)', async () => {
      currentUser.role = Role.CUS;
      renderLot();
      await screen.findByText(/Khóa lô do CUS/);
      expect(screen.queryByRole('button', { name: /Sửa lô/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Sửa nhanh' })).toBeNull();
    });

    it('sits before Tạo lô mới, which still sits immediately before Xóa lô', async () => {
      currentUser.role = Role.CUS;
      getShipmentDetailMock.mockResolvedValue({ ...detail, accountingLock: null });
      renderLot();
      const editBtn = await screen.findByRole('button', { name: /Sửa lô/ });
      const quickBtn = screen.getByRole('button', { name: 'Sửa nhanh' });
      const createBtn = screen.getByRole('button', { name: /Tạo lô mới/ });
      const deleteBtn = screen.getByRole('button', { name: /Xóa lô/ });
      expect(editBtn.parentElement).toBe(createBtn.parentElement);
      expect(editBtn.nextElementSibling).toBe(quickBtn);
      expect(quickBtn.nextElementSibling).toBe(createBtn);
      expect(createBtn.nextElementSibling).toBe(deleteBtn);
    });

    // SIL-171 (FB-147, 24/10): "Sửa lô" rời dialog 6 nút — nó mở FORM SỬA
    // (dùng lại Tạo lô hàng) tại /shipments/:id/edit; dialog cũ chỉ còn qua
    // "Sửa nhanh".
    it('Sửa lô navigates to the edit form (/shipments/:id/edit) — SIL-171', async () => {
      currentUser.role = Role.CUS;
      getShipmentDetailMock.mockResolvedValue({ ...detail, accountingLock: null });
      const { unmount } = render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
              <Route path="/shipments/:id/edit" element={<div>edit form surface</div>} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole('button', { name: /Sửa lô/ }));
      expect(await screen.findByText('edit form surface')).toBeTruthy();
      // Dialog 6 nút KHÔNG mở cùng lúc.
      expect(screen.queryByText('Sửa thông tin lô')).toBeNull();
      unmount();
    });

    it('Sửa nhanh opens the group picker from the workspace detail; FCL Lịch trình is per-container and stays disabled', async () => {
      currentUser.role = Role.CUS;
      getShipmentDetailMock.mockResolvedValue({ ...detail, accountingLock: null });
      getCusShipmentWorkspaceDetailMock.mockResolvedValue(workspaceDetail);
      renderLot();
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa nhanh' }));
      expect(await screen.findByText('Sửa thông tin lô')).toBeTruthy();
      expect(getCusShipmentWorkspaceDetailMock).toHaveBeenCalledWith(1);
      for (const label of ['Khách hàng & nhà máy', 'Chứng từ', 'Phân loại & hãng tàu', 'Tổng quan hàng hóa', 'Lịch trình', 'Ghi chú']) {
        expect(screen.getByRole('button', { name: label })).toBeTruthy();
      }
      const scheduleBtn = screen.getByRole('button', { name: 'Lịch trình' });
      expect(scheduleBtn.hasAttribute('disabled')).toBe(true);
      expect(scheduleBtn.getAttribute('title')).toBe('Lịch FCL được cập nhật theo từng container.');
    });

    it('picking Chứng từ (qua Sửa nhanh) opens the shared quick-edit modal and Lưu thay đổi PATCHes the lot with its version', async () => {
      currentUser.role = Role.CUS;
      getShipmentDetailMock.mockResolvedValue({ ...detail, accountingLock: null });
      getCusShipmentWorkspaceDetailMock.mockResolvedValue(workspaceDetail);
      renderLot();
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa nhanh' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Chứng từ' }));
      const billInput = await screen.findByLabelText('Số Bill');
      expect((billInput as HTMLInputElement).value).toBe('BL-001');
      fireEvent.change(billInput, { target: { value: 'BL-999' } });
      fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
      await waitFor(() => {
        expect(updateShipmentMock).toHaveBeenCalledTimes(1);
      });
      expect(updateShipmentMock).toHaveBeenCalledWith(1, { expectedVersion: 7, blNumber: 'BL-999', bookingRef: null });
      // The page reloads its own detail AND the editor's summary seed after
      // the save (the shared hook's loadList dependency, repointed here).
      await waitFor(() => {
        expect(getShipmentDetailMock.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(getCusShipmentWorkspaceDetailMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  // ── FB-106 (card 171026115810): 'Tạo lô mới' beside the lot actions ────────
  describe('Tạo lô mới affordance (FB-106)', () => {
    it('navigates to the create workspace', async () => {
      currentUser.role = Role.ADMIN;
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
              <Route path="/shipments/new" element={<div>Tạo lô hàng mới</div>} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole('button', { name: /Tạo lô mới/ }));
      expect(await screen.findByText('Tạo lô hàng mới')).toBeTruthy();
    });

    it('sits immediately before Xóa lô in the header action cluster', async () => {
      // The card (171026115810) asks for the button NEXT TO 'Xóa lô' — a
      // presence-only pin would still pass if the two drifted apart.
      currentUser.role = Role.CUS;
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
      const createBtn = await screen.findByRole('button', { name: /Tạo lô mới/ });
      const deleteBtn = await screen.findByRole('button', { name: /Xóa lô/ });
      expect(createBtn.parentElement).toBe(deleteBtn.parentElement);
      expect(createBtn.nextElementSibling).toBe(deleteBtn);
    });

    it.each([Role.ADMIN, Role.CUS, Role.MANAGER, Role.DISPATCHER])(
      'offers the button to %s — the roles the /shipments/new route admits',
      async (role) => {
        currentUser.role = role;
        render(
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
              <Routes>
                <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
              </Routes>
            </MemoryRouter></ToastProvider>
          </QueryClientProvider>,
        );
        expect(await screen.findByRole('button', { name: /Tạo lô mới/ })).toBeTruthy();
      },
    );

    it.each([Role.ACCOUNTANT, Role.DRIVER, Role.OPS, Role.CUSTOMER])(
      'hides the button from %s — a role the create route refuses',
      async (role) => {
        currentUser.role = role;
        render(
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
              <Routes>
                <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
              </Routes>
            </MemoryRouter></ToastProvider>
          </QueryClientProvider>,
        );
        await screen.findByText('Khách hàng');
        expect(screen.queryByRole('button', { name: /Tạo lô mới/ })).toBeNull();
      },
    );
  });

  // ── FB-107 (card 171026115820): the rows are Nâng / Hạ, the real points ──
  // Both rows used to render the dormant pickup_location/delivery_location
  // columns under the vague 'Nơi nhận'/'Nơi giao' labels, which every
  // form-created lot leaves empty — so both read '—'. The card asked for the
  // operation's own words: 'Nâng' (điểm lấy/nâng hàng) and 'Hạ' (điểm hạ/trả
  // hàng). The values come from the one shared rule (`resolveLiftDropPoints`).
  describe('Nâng / Hạ (FB-107)', () => {
    function fieldValue(label: string): string | null {
      const dt = screen.getByText(label);
      return dt.nextElementSibling?.textContent ?? null;
    }

    function renderLot() {
      return render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider><MemoryRouter initialEntries={['/shipments/1']}>
            <Routes>
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            </Routes>
          </MemoryRouter></ToastProvider>
        </QueryClientProvider>,
      );
    }

    it("labels the two rows Nâng / Hạ — the card dropped 'Nơi nhận'/'Nơi giao'", async () => {
      currentUser.role = Role.ADMIN;
      renderLot();
      await screen.findByText('Khách hàng');
      // The card's whole ask: the operation's own words replace the vague pair.
      expect(screen.getByText('Nâng').tagName).toBe('DT');
      expect(screen.getByText('Hạ').tagName).toBe('DT');
      expect(screen.queryByText('Nơi nhận')).toBeNull();
      expect(screen.queryByText('Nơi giao')).toBeNull();
    });

    it('FCL: names the container ports, never direction-swapped, joining several points', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue({
        ...detail,
        // The dormant free-text columns stay empty, as a form-created lot has them.
        shipment: { ...detail.shipment, pickupLocation: null, deliveryLocation: null },
        containers: [
          { id: 501, shipmentId: 1, containerTypeId: 4, containerNumber: 'MSKU1234567', sealNumber: null, cargoWeightKg: null, notes: null, pickupPortName: 'Cảng nâng A', dropoffPortName: 'Cảng hạ B' },
          { id: 502, shipmentId: 1, containerTypeId: 4, containerNumber: 'TGHU7654321', sealNumber: null, cargoWeightKg: null, notes: null, pickupPortName: 'Cảng nâng A', dropoffPortName: 'Cảng hạ C' },
        ],
      });
      renderLot();
      await screen.findByText('Containers (2)');
      expect(fieldValue('Nâng')).toBe('Cảng nâng A');
      expect(fieldValue('Hạ')).toBe('Cảng hạ B · Cảng hạ C');
    });

    it('LCL Nhập: Nâng = Kho lấy hàng (CFS), Hạ = Nhà máy', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue({
        ...detail,
        shipment: {
          ...detail.shipment,
          cargoMode: 'LCL',
          tradeDirection: 'IMPORT',
          pickupLocation: null,
          deliveryLocation: null,
          pickupWarehouseSiteName: 'Kho ICD Hà Nội',
          pickupWarehouseSiteType: 'WAREHOUSE',
          effectiveFactoryName: 'Nhà máy Long Minh',
        },
        containers: [],
      });
      renderLot();
      await screen.findByText('Containers (0)');
      expect(fieldValue('Nâng')).toBe('Kho ICD Hà Nội');
      expect(fieldValue('Hạ')).toBe('Nhà máy Long Minh');
    });

    it('LCL Xuất: the two sides swap — Nâng = Nhà máy, Hạ = Kho trả hàng', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue({
        ...detail,
        shipment: {
          ...detail.shipment,
          cargoMode: 'LCL',
          tradeDirection: 'EXPORT',
          pickupLocation: null,
          deliveryLocation: null,
          pickupWarehouseSiteName: 'Kho ICD Hà Nội',
          pickupWarehouseSiteType: 'WAREHOUSE',
          effectiveFactoryName: 'Nhà máy Long Minh',
        },
        containers: [],
      });
      renderLot();
      await screen.findByText('Containers (0)');
      expect(fieldValue('Nâng')).toBe('Nhà máy Long Minh');
      expect(fieldValue('Hạ')).toBe('Kho ICD Hà Nội');
    });

    it('falls back to the stored free text when a side was never picked', async () => {
      currentUser.role = Role.ADMIN;
      getShipmentDetailMock.mockResolvedValue({
        ...detail,
        shipment: {
          ...detail.shipment,
          cargoMode: 'LCL',
          tradeDirection: 'IMPORT',
          pickupLocation: null,
          deliveryLocation: null,
          pickupWarehouseSiteName: null,
          pickupWarehouseSiteType: null,
          effectiveFactoryName: null,
          factoryName: 'Nhà máy không catalog',
        },
        containers: [],
      });
      renderLot();
      await screen.findByText('Containers (0)');
      expect(fieldValue('Nâng')).toBe('—');
      expect(fieldValue('Hạ')).toBe('Nhà máy không catalog');
    });
  });
});
