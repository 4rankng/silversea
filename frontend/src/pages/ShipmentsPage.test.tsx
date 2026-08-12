import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  type ShipmentCusWorkspaceListItem,
} from '@tingting/shared';

const { apiGet, apiPost, apiPut } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: { get: apiGet, post: apiPost, put: apiPut },
  ApiError: class ApiError extends Error {},
}));

import ShipmentsPage from './ShipmentsPage';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
const source = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.tsx'), 'utf8');

const row: ShipmentCusWorkspaceListItem = {
  id: 1,
  version: 3,
  bucket: ShipmentCusBucket.PENDING_LOCK,
  bucketLabel: 'Chờ khóa',
  customerName: 'Công ty Silver Sea',
  factoryName: 'Nhà máy Hải Phòng',
  billOrBookNumber: 'BILL-12345',
  declarationNumber: 'TK-54321',
  shippingLineName: 'Maersk',
  routeName: 'Hải Phòng → Hà Nội',
  isCombined: false,
  direction: 'IMPORT' as const,
  containerSummary: '2x40HC',
  weightKg: '25000',
  volumeCbm: '52.5',
  transportDate: '2026-08-12',
  note: 'Giao buổi sáng',
  operational: {
    scheduleReadiness: 'SCHEDULED',
    vehicleReadiness: 'READY',
    totalContainers: 2,
    assignedContainers: 2,
    externalContainers: 1,
    plateAssignedContainers: 2,
    missingCarrierContainers: 0,
    missingPlateContainers: 0,
    transportDateEditable: true,
  },
  finance: {
    customerInvoiceTotal: '12000000',
    customerNoInvoiceTotal: '1500000',
    totalCost: '14000000',
    isLoss: true,
    hasPendingRecovery: true,
    customerChargeTotalsAvailable: true,
    totalCostAvailable: true,
  },
  debitNote: {
    available: true,
    billingDocumentId: 44,
    documentNumber: 'DN-2026-0044',
    issuedAt: '2026-08-12T01:00:00.000Z',
    debitNoteStatus: 'ISSUED',
    disabledReason: null,
  },
  documentCustody: {
    status: ShipmentDocumentCustody.SUBMITTED_TO_ACCOUNTING,
    label: 'Đã nộp Kế toán',
    available: true,
    editable: true,
  },
  accountingConfirmation: {
    status: 'CONFIRMED' as const,
    billingDocumentId: 44,
    confirmationId: 71,
    checksum: 'checksum-71',
    confirmedAt: '2026-08-12T01:30:00.000Z',
    confirmedByName: 'Kế toán',
  },
  activeLock: null,
  action: {
    kind: 'LOCK' as const,
    label: 'Khóa lô',
    enabled: true,
    disabledReason: null,
  },
};

const zeroComponent = {
  amount: '0',
  invoiceNumber: null,
  repairRecoveryPending: false,
  available: true,
};

const detail = {
  summary: row,
  containers: [{
    id: 10,
    ordinal: 1,
    containerNumber: 'MSKU1234567',
    containerTypeId: 2,
    containerTypeLabel: '40HC',
    carrierType: 'EXTERNAL' as const,
    externalCarrierId: 8,
    externalCarrierVehicleId: 18,
    carrierName: 'Nhà xe An Phát',
    plateNumber: '15C-123.45',
    liftSiteId: 31,
    liftSite: 'Cảng Đình Vũ',
    dropoffSiteId: 32,
    dropoffSite: 'Bãi Tân Vũ',
    closeOrReturnAt: '2026-08-12T02:30:00.000Z',
    outboundCharges: {
      transport: { ...zeroComponent, amount: '5000000' },
      handling: { ...zeroComponent, amount: '700000' },
      incidental: zeroComponent,
      total: '5700000',
      available: true,
    },
    inboundCharges: {
      transport: { ...zeroComponent, amount: '3600000' },
      handling: { ...zeroComponent, amount: '500000' },
      incidental: zeroComponent,
      total: '4100000',
      available: true,
    },
    passThroughChargesGrouped: {
      csht: zeroComponent,
      lift: { ...zeroComponent, amount: '350000', invoiceNumber: 'HD-001' },
      dropoff: zeroComponent,
      other: { ...zeroComponent, amount: '900000', repairRecoveryPending: true },
      total: '1250000',
      available: true,
    },
    passThroughCharges: [],
    recoveryFacts: [],
    repairRecoveryPending: true,
    permissions: {
      carrierEditable: true,
      plateEditable: true,
      containerTypeEditable: true,
      liftSiteEditable: true,
      dropoffSiteEditable: true,
      closeOrReturnTimeEditable: true,
      outboundEditable: true,
      inboundEditable: true,
      passThroughEditable: false,
    },
    shipmentVersion: 3,
    factVersion: 1,
    relatedTripVersion: 2,
  }],
  selectors: {
    containerTypes: [{ id: 2, code: '40HC', name: 'Container 40HC', label: '40HC · Container 40HC' }],
    operationalSites: [
      { id: 31, siteType: 'WAREHOUSE' as const, code: 'DV', name: 'Cảng Đình Vũ', label: 'DV · Cảng Đình Vũ' },
      { id: 32, siteType: 'WAREHOUSE' as const, code: 'TV', name: 'Bãi Tân Vũ', label: 'TV · Bãi Tân Vũ' },
    ],
    externalCarriers: [{ id: 8, name: 'Nhà xe An Phát', shortName: 'An Phát', label: 'Nhà xe An Phát' }],
    carrierVehicles: [{ id: 18, carrierId: 8, licensePlate: '15C-123.45', label: '15C-123.45' }],
  },
  dataState: {
    hasExplicitDocumentCustody: true,
    hasExplicitRecoveryFacts: true,
    hasAuthoritativeChargeBreakdown: true,
  },
};

function listResponse(items = [row]) {
  return {
    page: 1,
    limit: 20,
    total: items.length,
    totalPages: items.length ? 1 : 0,
    pageSummary: {
      needsSchedule: items.filter((item) => item.operational.scheduleReadiness === 'WAITING_DATE').length,
      needsVehicle: items.filter((item) => ['WAITING_CARRIER', 'WAITING_PLATE'].includes(item.operational.vehicleReadiness)).length,
      waitingAccounting: items.filter((item) => (
        item.accountingConfirmation.status === 'PENDING' || item.accountingConfirmation.status === 'STALE'
      )).length,
      readyToLock: items.filter((item) => item.action.kind === 'LOCK' && item.action.enabled).length,
      needsAttention: items.filter((item) => item.finance.isLoss || item.finance.hasPendingRecovery).length,
    },
    items,
  };
}

function renderPage(path = '/shipments') {
  return render(<MemoryRouter initialEntries={[path]}><ShipmentsPage /></MemoryRouter>);
}

function masterRow(): HTMLTableRowElement {
  const element = document.querySelector('tr.cus-master-row');
  if (!(element instanceof HTMLTableRowElement)) throw new Error('shipment master row not rendered');
  return element;
}

function masterRowDetailButton(): HTMLButtonElement {
  const element = document.querySelector('button.cus-row-toggle');
  if (!(element instanceof HTMLButtonElement)) throw new Error('shipment detail button not rendered');
  return element;
}

describe('ShipmentsPage — CUS closeout workspace', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1' ? Promise.resolve(detail) : Promise.resolve(listResponse())
    ));
    apiPost.mockResolvedValue({ replayed: false });
    apiPut.mockResolvedValue({ ...row, version: 4 });
  });

  it('renders one focused shipment workspace without unfinished navigation', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Quản lý lô hàng' })).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('Hóa đơn kết hợp')).toBeNull();
    expect(screen.getByLabelText('Bill/Book hoặc tờ khai').getAttribute('inputmode')).toBe('text');
  });

  it('rejects invalid suffixes locally and sends the exact mixed-case alphanumeric suffix', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    const input = screen.getByLabelText('Bill/Book hoặc tờ khai');

    fireEvent.change(input, { target: { value: 'A12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    expect(screen.getByRole('alert').textContent).toContain('Nhập đúng 4-5 ký tự chữ hoặc số');

    fireEvent.change(input, { target: { value: 'AB$1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    expect(screen.getByRole('alert').textContent).toContain('Nhập đúng 4-5 ký tự chữ hoặc số');

    fireEvent.change(input, { target: { value: 'ABC123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    expect(screen.getByRole('alert').textContent).toContain('Nhập đúng 4-5 ký tự chữ hoặc số');

    fireEvent.change(input, { target: { value: 'aB12C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('searchSuffix=aB12C')));
  });

  it('keeps the master index compact and moves complete finance evidence into the drawer', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    const surface = within(table);
    expect(surface.getByRole('columnheader', { name: 'Lô hàng' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Khách hàng / tuyến' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Kế hoạch' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Điều xe' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Trạng thái / ngoại lệ' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Đối soát / hành động' })).toBeTruthy();
    expect(surface.queryByText('Có hóa đơn')).toBeNull();
    expect(surface.queryByText('Tổng chi')).toBeNull();
    expect(surface.queryByText('12.000.000')).toBeNull();
    expect(surface.getByLabelText('Lỗ 500.000 đồng')).toBeTruthy();
    expect(surface.getByLabelText('Thông tin xe đã đủ')).toBeTruthy();
    expect(screen.getByLabelText('Tình trạng các lô đang hiển thị')).toBeTruthy();
    expect(screen.getByLabelText('Chú thích trạng thái lô hàng')).toBeTruthy();
    expect(surface.getByText('Lỗ')).toBeTruthy();
    expect(surface.getByText('Chờ thu hồi')).toBeTruthy();
    expect(surface.queryByText('Không cảnh báo')).toBeNull();
    expect((surface.getByRole('button', { name: 'Khóa lô' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(masterRowDetailButton());
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Đối soát và chứng từ')).toBeTruthy();
    expect(within(drawer).getByText('12.000.000 ₫')).toBeTruthy();
    expect(within(drawer).getByText('14.000.000 ₫')).toBeTruthy();
    expect(within(drawer).getByText(/Đã xác nhận:/)).toBeTruthy();

    const mobileList = document.querySelector('.cus-mobile-list');
    expect(mobileList).not.toBeNull();
    const mobileSurface = within(mobileList as HTMLElement);
    expect(mobileSurface.getByText('Container')).toBeTruthy();
    expect(mobileSurface.getByText('2x40HC · Nhập')).toBeTruthy();
  });

  it('shows active filters and clears the suffix from the visible chip', async () => {
    renderPage('/shipments?searchSuffix=AB12');
    await screen.findByRole('table');
    const chip = screen.getByRole('button', { name: 'Xóa bộ lọc Mã: AB12' });
    expect(chip).toBeTruthy();

    fireEvent.click(chip);
    await waitFor(() => {
      const latestUrl = String(apiGet.mock.calls.at(-1)?.[0] ?? '');
      expect(latestUrl).not.toContain('searchSuffix=');
    });
    expect((screen.getByLabelText('Bill/Book hoặc tờ khai') as HTMLInputElement).value).toBe('');
  });

  it('clears an applied suffix immediately from the search-field control', async () => {
    renderPage('/shipments?searchSuffix=AB12');
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));

    await waitFor(() => {
      const latestUrl = String(apiGet.mock.calls.at(-1)?.[0] ?? '');
      expect(latestUrl).not.toContain('searchSuffix=');
    });
    expect(screen.queryByRole('button', { name: 'Xóa bộ lọc Mã: AB12' })).toBeNull();
  });

  it('offers a co-located reset action from the filtered no-results state', async () => {
    apiGet.mockResolvedValue(listResponse([]));
    renderPage('/shipments?searchSuffix=ZZZZ9');

    expect(await screen.findByText('Không có lô hàng phù hợp')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xóa bộ lọc Mã: ZZZZ9' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Xóa bộ lọc$/ }));

    await waitFor(() => {
      const latestUrl = String(apiGet.mock.calls.at(-1)?.[0] ?? '');
      expect(latestUrl).not.toContain('searchSuffix=');
    });
  });

  it('renders the drawer custody control in card composition', async () => {
    class CardLayoutObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 759 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    }
    const originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = CardLayoutObserver as unknown as typeof ResizeObserver;

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mở chi tiết lô hàng của Công ty Silver Sea' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('combobox', { name: /Trạng thái phơi phiếu/ })).toBeTruthy();

    window.ResizeObserver = originalResizeObserver;
  });

  it('opens the mobile card by clicking the card itself instead of a separate CTA', async () => {
    class CardLayoutObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 759 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    }
    const originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = CardLayoutObserver as unknown as typeof ResizeObserver;

    renderPage();
    const referenceButton = await screen.findByRole('button', { name: 'Mở chi tiết lô hàng của Công ty Silver Sea' });
    const card = referenceButton.closest('article');
    expect(card).not.toBeNull();
    fireEvent.click(card as HTMLElement);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xem chi tiết' })).toBeNull();
    expect(card?.getAttribute('role')).toBeNull();

    window.ResizeObserver = originalResizeObserver;
  });

  it('uses compact direct actions on tablet cards only when the action is enabled', async () => {
    class TabletLayoutObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 900 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    }
    const originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = TabletLayoutObserver as unknown as typeof ResizeObserver;

    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    const mobileList = await waitFor(() => {
      const element = document.querySelector('.cus-mobile-list');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(await within(mobileList).findByRole('button', { name: 'Khóa lô' })).toBeTruthy();

    window.ResizeObserver = originalResizeObserver;
  });

  it('states unavailable financial confirmation honestly instead of presenting it as pending', async () => {
    apiGet.mockResolvedValueOnce(listResponse([{
      ...row,
      debitNote: {
        ...row.debitNote,
        billingDocumentId: null,
      },
      accountingConfirmation: {
        status: 'UNAVAILABLE' as const,
        billingDocumentId: null,
        confirmationId: null,
        checksum: null,
        confirmedAt: null,
        confirmedByName: null,
      },
    }]));

    renderPage();
    const table = await screen.findByRole('table');
    expect(screen.getByLabelText('Tình trạng các lô đang hiển thị').textContent).toContain('0 chờ Kế toán');
    expect(within(table).queryByText('Chưa đủ dữ liệu xác nhận')).toBeNull();
    fireEvent.click(masterRowDetailButton());
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Chưa đủ dữ liệu xác nhận')).toBeTruthy();
    expect(within(drawer).queryByText('Chờ xác nhận')).toBeNull();
  });

  it('shows the reason for a disabled consequential action without relying on a tooltip', async () => {
    apiGet.mockResolvedValueOnce(listResponse([{
      ...row,
      action: {
        kind: 'LOCK' as const,
        label: 'Khóa lô',
        enabled: false,
        disabledReason: 'Xác nhận Kế toán đã hết hiệu lực.',
      },
    }]));

    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Chờ Kế toán')).toBeTruthy();
    expect(within(table).queryByText('Xác nhận Kế toán đã hết hiệu lực.')).toBeNull();
    expect((within(table).getByRole('button', { name: 'Khóa lô' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(masterRowDetailButton());
    expect(within(await screen.findByRole('dialog')).getByText('Xác nhận Kế toán đã hết hiệu lực.')).toBeTruthy();
  });

  it('loads container detail lazily and renders all three grouped charge sections', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/cus-workspace/1');

    const rowElement = masterRow();
    fireEvent.click(rowElement);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(await screen.findByText('MSKU1234567')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Cước đầu ra' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Cước đầu vào' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Phí chi hộ' })).toBeTruthy();
    expect(screen.getAllByText('Chưa thu hồi sửa chữa').length).toBeGreaterThan(0);
  });

  it('lets CUS chốt lịch from the drawer through the versioned shipment update', async () => {
    const waitingRow = {
      ...row,
      transportDate: null,
      operational: { ...row.operational, scheduleReadiness: 'WAITING_DATE' as const },
    };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...detail, summary: waitingRow })
        : Promise.resolve(listResponse([waitingRow]))
    ));
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());
    const drawer = await screen.findByRole('dialog');
    fireEvent.change(within(drawer).getByLabelText('Ngày vận chuyển'), { target: { value: '2026-08-14' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Chốt lịch' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/1', {
      expectedVersion: 3,
      expectedDeliveryDate: '2026-08-14',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('saves only the server-permitted container fields with optimistic versions', async () => {
    apiPost.mockResolvedValueOnce({
      line: {
        ...detail.containers[0],
        plateNumber: '15C-999.99',
        shipmentVersion: 4,
        factVersion: 2,
      },
    });
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRow());

    const plate = await screen.findByLabelText('Biển số xe');
    fireEvent.change(plate, { target: { value: '15C-999.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu container' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/shipments/cus-workspace/1/containers/10',
      expect.objectContaining({
        expectedShipmentVersion: 3,
        expectedFactVersion: 1,
        plateNumber: '15C-999.99',
      }),
      expect.any(Object),
    ));
  });

  it('creates a new external carrier through the container workflow', async () => {
    apiPost.mockResolvedValueOnce({
      line: {
        ...detail.containers[0],
        carrierName: 'Nhà xe Tân Cảng',
        plateNumber: '51D-888.99',
        shipmentVersion: 4,
      },
    });
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRow());

    fireEvent.click(await screen.findByRole('button', { name: 'Nhập nhà xe mới' }));
    fireEvent.change(screen.getByLabelText('Tên nhà xe mới'), { target: { value: 'Nhà xe Tân Cảng' } });
    fireEvent.change(screen.getByLabelText('Biển số xe'), { target: { value: '51D-888.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu container' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/shipments/cus-workspace/1/containers/10',
      expect.objectContaining({
        expectedShipmentVersion: 3,
        expectedFactVersion: 1,
        carrierType: 'EXTERNAL',
        newExternalCarrier: {
          name: 'Nhà xe Tân Cảng',
          plateNumber: '51D-888.99',
        },
      }),
      expect.any(Object),
    ));
    const payload = apiPost.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.externalCarrierId).toBeUndefined();
    expect(payload.externalCarrierVehicleId).toBeUndefined();
    expect(payload.plateNumber).toBeUndefined();
  });

  it('renders locked container detail without active inputs or save controls', async () => {
    const lockedRow: ShipmentCusWorkspaceListItem = {
      ...row,
      bucket: ShipmentCusBucket.LOCKED,
      bucketLabel: 'Đã khóa',
      activeLock: {
        id: 91,
        billingDocumentId: 44,
        activatedAt: '2026-08-12T02:00:00.000Z',
        activatedByName: 'CUS',
        reason: 'Đã chốt lô',
      },
      action: { kind: 'REQUEST_REOPEN', label: 'Đề nghị điều chỉnh', enabled: true, disabledReason: null },
    };
    const lockedDetail = {
      ...detail,
      summary: lockedRow,
      containers: detail.containers.map((line) => ({
        ...line,
        permissions: Object.fromEntries(Object.keys(line.permissions).map((key) => [key, false])) as typeof line.permissions,
      })),
    };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1' ? Promise.resolve(lockedDetail) : Promise.resolve(listResponse([lockedRow]))
    ));

    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRow());
    expect(await screen.findByText('15C-123.45')).toBeTruthy();
    expect(screen.queryByLabelText('Biển số xe')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu container' })).toBeNull();
  });

  it('confirms the consequential lock action and closes the dialog after success', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'Khóa lô' }));
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/cus-workspace/1');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/chế độ chỉ đọc/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Khóa lô' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/shipments/cus-workspace/1/lock',
      expect.objectContaining({ expectedVersion: 3 }),
      expect.any(Object),
    ));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('reuses the same idempotency key for a retried lock action and rotates after success', async () => {
    const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
    apiPost.mockRejectedValueOnce(new Error('Mất kết nối'));

    renderPage();
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'Khóa lô' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Khóa lô' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const firstKey = (apiPost.mock.calls[0]?.[2] as { headers?: Record<string, string> } | undefined)?.headers?.['Idempotency-Key'];
    expect(firstKey).toBe('00000000-0000-4000-8000-000000000001');
    expect(screen.getByText('Mất kết nối')).toBeTruthy();

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Khóa lô' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    const secondKey = (apiPost.mock.calls[1]?.[2] as { headers?: Record<string, string> } | undefined)?.headers?.['Idempotency-Key'];
    expect(secondKey).toBe(firstKey);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(within(await screen.findByRole('table')).getByRole('button', { name: 'Khóa lô' }));
    const secondDialog = await screen.findByRole('dialog');
    fireEvent.click(within(secondDialog).getByRole('button', { name: 'Khóa lô' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(3));
    const thirdKey = (apiPost.mock.calls[2]?.[2] as { headers?: Record<string, string> } | undefined)?.headers?.['Idempotency-Key'];
    expect(thirdKey).toBe('00000000-0000-4000-8000-000000000002');
    expect(thirdKey).not.toBe(firstKey);
    expect(randomUUID).toHaveBeenCalledTimes(2);
    randomUUID.mockRestore();
  });

  it('uses a page-scrolling wrapping ledger and container-aware card mode', () => {
    expect(css).toMatch(/\.cus-master-scroll\s*\{[^}]*overflow-x:\s*clip;/);
    expect(css).not.toMatch(/\.cus-master-scroll\s*\{[^}]*max-height:/);
    expect(css).not.toMatch(/\.cus-master-scroll\s*\{[^}]*overflow-y:\s*auto;/);
    expect(css).toMatch(/\.cus-master-table\s*\{[\s\S]*?width:\s*0;[\s\S]*?min-width:\s*100%;[\s\S]*?table-layout:\s*fixed;/);
    expect(css).toMatch(/\.cus-master-table__col-shipment\s*\{\s*width:\s*17%;\s*\}/);
    expect(css).toMatch(/\.cus-master-table__col-finance\s*\{\s*width:\s*16%;\s*\}/);
    expect(css).toMatch(/\.cus-master-table__col-status/);
    expect(css).not.toMatch(/\.cus-master-table__col-action/);
    expect(css).toMatch(/\.cus-index-cell\s*\{[\s\S]*?display:\s*grid;/);
    expect(css).toMatch(/\.cus-index-cell > strong,[\s\S]*?font-family:\s*var\(--font-body\);/);
    expect(css).not.toMatch(/\.cus-cell-stack/);
    expect(css).toMatch(/\.cus-master-row:hover \.cus-row-hover-action,[\s\S]*?\.cus-master-row:focus-within \.cus-row-hover-action/);
    expect(css).not.toMatch(/\.cus-master-table\s*\{[\s\S]*?min-width:\s*2300px;/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-master-scroll\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-mobile-list\s*\{[\s\S]*?display:\s*grid;/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-mobile-card--interactive\s*\{\s*cursor:\s*pointer;/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-mobile-card__reference:focus-visible\s*\{/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-toolbar\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/padding:\s*16px 0 max\(16px, env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-page\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;/);
    expect(css).toMatch(/\.cus-detail-facts\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).not.toMatch(/cus-master-table__col-expand|cus-expand-button|cus-mobile-card__open/);
  });

  it('uses distinct semantic colors for running and locked shipments', () => {
    expect(source).toMatch(/\[ShipmentCusBucket\.RUNNING\]:\s*'var\(--accent\)'/);
    expect(source).toMatch(/\[ShipmentCusBucket\.LOCKED\]:\s*'var\(--slate-4\)'/);
    expect(css).toMatch(/\.cus-workflow-badge--locked\s*\{[^}]*background:\s*var\(--slate-5\);[^}]*color:\s*var\(--slate-4\);/);
  });
});
