import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  type ShipmentCusWorkspaceListItem,
} from '@tingting/shared';

const { apiGet, apiPost, apiPut, downloadCSV } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  downloadCSV: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: { get: apiGet, post: apiPost, put: apiPut },
  ApiError: class ApiError extends Error {},
}));

vi.mock('../lib/csv', () => ({ downloadCSV }));

import ShipmentsPage from './ShipmentsPage';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
const source = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.tsx'), 'utf8');
const defaultResizeObserver = window.ResizeObserver;

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
  packageCount: null,
  packageType: null,
  weightKg: '25000',
  volumeCbm: '52.5',
  transportDate: '2026-08-12',
  customsCutoffAt: '2026-08-11T08:00:00.000Z',
  closingAt: null,
  plannedReturnAt: '2026-08-12T10:00:00.000Z',
  deliveryLocation: 'Kho Long Biên',
  liftSiteNames: ['Cảng Đình Vũ'],
  dropoffSiteNames: ['Bãi Tân Vũ'],
  customerAppointmentAts: ['2026-08-12T02:30:00.000Z'],
  carrierAssignments: [{ carrierName: 'Nhà xe An Phát', plateNumber: '15C-123.45' }],
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

const detail = {
  summary: row,
  containers: [{
    id: 10,
    ordinal: 1,
    containerNumber: 'MSKU1234567',
    containerTypeId: 2,
    containerTypeLabel: '40HC',
    dispatchStatus: 'CREATED' as const,
    carrierType: 'EXTERNAL' as const,
    externalCarrierId: 8,
    externalCarrierVehicleId: 18,
    carrierName: 'Nhà xe An Phát',
    plateNumber: '15C-123.45',
    liftSiteId: 31,
    liftSite: 'Cảng Đình Vũ',
    dropoffSiteId: 32,
    dropoffSite: 'Bãi Tân Vũ',
    customerAppointmentAt: '2026-08-12T02:30:00.000Z',
    permissions: {
      carrierEditable: true,
      plateEditable: true,
      containerTypeEditable: true,
      liftSiteEditable: true,
      dropoffSiteEditable: true,
      customerAppointmentEditable: true,
    },
    shipmentVersion: 3,
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
  const element = document.querySelector('tr.cus-worksheet-row');
  if (!(element instanceof HTMLTableRowElement)) throw new Error('shipment master row not rendered');
  return element;
}

function masterRowDetailButton(): HTMLButtonElement {
  const element = document.querySelector('button.cus-row-disclosure');
  if (!(element instanceof HTMLButtonElement)) throw new Error('shipment detail button not rendered');
  return element;
}

describe('ShipmentsPage — CUS closeout workspace', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    downloadCSV.mockReset();
    window.localStorage.clear();
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1' ? Promise.resolve(detail) : Promise.resolve(listResponse())
    ));
    apiPost.mockResolvedValue({ replayed: false });
    apiPut.mockResolvedValue({ ...row, version: 4 });
  });

  afterEach(() => {
    window.ResizeObserver = defaultResizeObserver;
  });

  it('renders one focused shipment workspace without unfinished navigation', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Kế hoạch lô hàng' })).toBeTruthy();
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

  it('renders the fixed 16-column operational worksheet and opens detail in a drawer', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    const surface = within(table);
    const headers = [
      'Ngày giao hàng', 'Khách hàng', 'Nhà máy', 'Số Bill/Book', 'Hãng tàu',
      'Tổng số lượng', 'Trọng lượng tổng', 'Xuất / Nhập', 'Cutoff', 'Nâng', 'Hạ',
      'Điểm trả', 'Loại cont', 'Giờ đóng / trả', 'Ghi chú lưu ý', 'Nhà xe',
    ];
    for (const header of headers) {
      expect(surface.getByRole('columnheader', { name: header })).toBeTruthy();
    }
    expect(surface.getByText('Cảng Đình Vũ')).toBeTruthy();
    expect(surface.getByText('Bãi Tân Vũ')).toBeTruthy();
    expect(surface.getByText('Kho Long Biên')).toBeTruthy();
    expect(surface.getByText('Nhà xe An Phát · 15C-123.45')).toBeTruthy();
    expect(masterRowDetailButton().textContent).toContain('BILL-12345');
    expect(document.querySelector('.cus-mobile-list')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chọn cột hiển thị' })).toBeNull();

    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Điều hành lô hàng')).toBeTruthy();
    expect(within(dialog).getByRole('article', { name: 'MSKU1234567' })).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1');
  });

  it('uses the package authority instead of claiming zero containers and exports that same value', async () => {
    const lclRow: ShipmentCusWorkspaceListItem = {
      ...row,
      containerSummary: '4 Pallet',
      packageCount: 4,
      packageType: 'Pallet',
      operational: { ...row.operational, totalContainers: 0, vehicleReadiness: 'NO_CONTAINERS' },
    };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1' ? Promise.resolve({ ...detail, summary: lclRow }) : Promise.resolve(listResponse([lclRow]))
    ));

    renderPage();
    expect((await screen.findAllByText('4 Pallet')).length).toBe(2);
    expect(screen.queryByText('0 cont')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tải XLSX' }));
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledTimes(1));
    const rows = downloadCSV.mock.calls[0]?.[2] as Array<Array<string | number>>;
    expect(rows[0]?.[5]).toBe('4 Pallet');
  });

  it('sends the direction filter and keeps all worksheet columns fixed', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Xuất / Nhập'), { target: { value: 'EXPORT' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('direction=EXPORT')));
    expect(within(screen.getByRole('table')).getByRole('columnheader', { name: 'Nhà xe' })).toBeTruthy();
    expect(window.localStorage.getItem('silversea:cus-shipments:master-columns:v3')).toBeNull();
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

  it('uses the same horizontally scrollable worksheet at narrow widths', async () => {
    renderPage();
    await screen.findByRole('table');
    expect(document.querySelector('.cus-worksheet-viewport')).not.toBeNull();
    expect(document.querySelector('.cus-mobile-list')).toBeNull();
    expect(css).toMatch(/\.cus-worksheet-viewport\s*\{[\s\S]*?overflow:\s*auto;/);
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.cus-worksheet-toolbar\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
  });

  it('opens the governed shipment controls from the row button', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Điều hành lô hàng')).toBeTruthy();
    expect(within(dialog).getByText('Kế toán xác nhận')).toBeTruthy();
    expect(within(dialog).getByRole('combobox')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Khóa lô' })).toBeTruthy();
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
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    expect(within(await screen.findByRole('dialog')).getByText('Chưa đủ dữ liệu xác nhận')).toBeTruthy();
    expect(screen.queryByText('Chờ xác nhận')).toBeNull();
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
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Xác nhận Kế toán đã hết hiệu lực.')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Khóa lô' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('loads operational container detail lazily and keeps finance entry outside the expansion', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/cus-workspace/1');

    const rowElement = masterRow();
    fireEvent.click(rowElement);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    const ledger = await screen.findByLabelText('Chi tiết container');
    expect(within(ledger).getByText('MSKU1234567')).toBeTruthy();
    expect(within(ledger).getByText('Nhận diện')).toBeTruthy();
    expect(within(ledger).getByText('Vận hành')).toBeTruthy();
    expect(within(ledger).getByText('STT')).toBeTruthy();
    expect(within(ledger).getByText('Giờ hẹn đóng/trả')).toBeTruthy();
    expect(within(masterRow()).getByText('Maersk')).toBeTruthy();
    expect(within(ledger).queryByText('Maersk')).toBeNull();
    expect(within(ledger).getByText('Đã tạo chuyến')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chỉnh sửa' })).toBeTruthy();
    expect(screen.queryByLabelText(/Biển số xe của container MSKU1234567/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu container MSKU1234567' })).toBeNull();
    expect(within(ledger).queryByText(/Chi phí không nhập tại đây/)).toBeNull();
    expect(screen.queryByText('Cước đầu ra')).toBeNull();
    expect(screen.queryByText('Cước đầu vào')).toBeNull();
    expect(screen.queryByText('Phí chi hộ')).toBeNull();
    expect(screen.queryByText('Chưa thu hồi sửa chữa')).toBeNull();
  });

  it('protects unsaved container changes when closing the drawer', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chỉnh sửa' }));
    fireEvent.change(within(dialog).getByLabelText(/Biển số xe của container MSKU1234567/), { target: { value: '15C-888.88' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    expect(await screen.findByRole('dialog', { name: 'Bỏ thay đổi container?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi và đóng' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('actually discards drafts before leaving edit mode', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRow());
    fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa' }));
    fireEvent.change(screen.getByLabelText(/Biển số xe của container MSKU1234567/), { target: { value: '15C-555.55' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tất' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi và hoàn tất' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));

    expect((screen.getByLabelText(/Biển số xe của container MSKU1234567/) as HTMLInputElement).value).toBe('15C-123.45');
    expect((screen.getByRole('button', { name: 'Lưu container MSKU1234567' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks before closing the mobile container drawer with unsaved changes', async () => {
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
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chỉnh sửa' }));
    fireEvent.change(await within(dialog).findByLabelText(/Biển số xe của container MSKU1234567/), { target: { value: '15C-777.77' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    expect(await screen.findByRole('dialog', { name: 'Bỏ thay đổi container?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bỏ thay đổi và đóng' })).toBeTruthy();

    window.ResizeObserver = originalResizeObserver;
  });

  it('keeps the mobile drawer open while a container save is in progress', async () => {
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
    let resolveSave: ((value: { line: typeof detail.containers[0] }) => void) | undefined;
    apiPost.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));

    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chỉnh sửa' }));
    fireEvent.change(await within(dialog).findByLabelText(/Biển số xe của container MSKU1234567/), { target: { value: '15C-666.66' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu container MSKU1234567' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Bỏ thay đổi container?' })).toBeNull();
    expect(screen.getByText('Đang lưu dữ liệu container. Vui lòng chờ hoàn tất.')).toBeTruthy();
    resolveSave?.({ line: { ...detail.containers[0], plateNumber: '15C-666.66', shipmentVersion: 4 } });
    await waitFor(() => expect(screen.queryByText('Đang lưu dữ liệu container. Vui lòng chờ hoàn tất.')).toBeNull());

    window.ResizeObserver = originalResizeObserver;
  });

  it('keeps a clear empty state when a shipment has no container rows', async () => {
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...detail, containers: [] })
        : Promise.resolve(listResponse())
    ));
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRow());

    const emptyState = await screen.findByText('Lô hàng chưa có dữ liệu container.');
    const dialog = emptyState.closest('[role="dialog"]') as HTMLElement;
    expect(within(dialog).queryByText(/Chi phí không nhập tại đây/)).toBeNull();
  });

  it('lets CUS chốt lịch from the master schedule cell through the versioned shipment update', async () => {
    const waitingRow = {
      ...row,
      transportDate: null,
      operational: { ...row.operational, scheduleReadiness: 'WAITING_DATE' as const, transportDateEditable: true },
    };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...detail, summary: waitingRow })
        : Promise.resolve(listResponse([waitingRow]))
    ));
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRowDetailButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Ngày giao hàng'), { target: { value: '2026-08-14' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chốt lịch' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/1', {
      expectedVersion: 3,
      expectedDeliveryDate: '2026-08-14',
    }));
    expect(apiGet.mock.calls.filter(([url]) => url === '/shipments/cus-workspace/1').length).toBeGreaterThan(0);
  });

  it('saves only the server-permitted container fields with optimistic versions', async () => {
    apiPost.mockResolvedValueOnce({
      line: {
        ...detail.containers[0],
        plateNumber: '15C-999.99',
        shipmentVersion: 4,
      },
    });
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRow());
    fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa' }));

    const plate = await screen.findByLabelText(/Biển số xe của container MSKU1234567/);
    expect(screen.getByLabelText(/Loại container MSKU1234567/)).toBeTruthy();
    const customerAppointment = screen.getByLabelText(/Giờ hẹn đóng hoặc trả tại nhà máy của container MSKU1234567/) as HTMLInputElement;
    fireEvent.change(plate, { target: { value: '15C-999.99' } });
    fireEvent.change(customerAppointment, { target: { value: '2026-08-14T10:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu container MSKU1234567' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/shipments/cus-workspace/1/containers/10',
      expect.objectContaining({
        expectedShipmentVersion: 3,
        plateNumber: '15C-999.99',
        customerAppointmentAt: new Date('2026-08-14T10:30').toISOString(),
      }),
      expect.any(Object),
    ));
    const [, payload] = apiPost.mock.calls[0] ?? [];
    expect(payload.outboundCharges).toBeUndefined();
    expect(payload.inboundCharges).toBeUndefined();
    await waitFor(() => expect(apiGet.mock.calls.filter(([url]) => url === '/shipments/cus-workspace?page=1&limit=20').length).toBeGreaterThan(1));
  });

  it('keeps a sibling container draft while refreshing its shipment version after another save', async () => {
    const secondLine = { ...detail.containers[0], id: 11, ordinal: 2, containerNumber: 'MSKU7654321', plateNumber: '15C-456.78' };
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...detail, containers: [detail.containers[0], secondLine] })
        : Promise.resolve(listResponse())
    ));
    apiPost
      .mockResolvedValueOnce({ line: { ...detail.containers[0], plateNumber: '15C-999.99', shipmentVersion: 4 } })
      .mockResolvedValueOnce({ line: { ...secondLine, plateNumber: '15C-888.88', shipmentVersion: 5 } });
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRow());
    fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa' }));

    fireEvent.change(await screen.findByLabelText(/Biển số xe của container MSKU1234567/), { target: { value: '15C-999.99' } });
    fireEvent.change(screen.getByLabelText(/Biển số xe của container MSKU7654321/), { target: { value: '15C-888.88' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu container MSKU1234567' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(apiGet.mock.calls.filter(([url]) => url === '/shipments/cus-workspace?page=1&limit=20').length).toBeGreaterThan(1));
    expect((screen.getByLabelText(/Biển số xe của container MSKU7654321/) as HTMLInputElement).value).toBe('15C-888.88');

    fireEvent.click(screen.getByRole('button', { name: 'Lưu container MSKU7654321' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/shipments/cus-workspace/1/containers/11',
      expect.objectContaining({ expectedShipmentVersion: 4, plateNumber: '15C-888.88' }),
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
    fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Thêm nhà xe' }));
    fireEvent.change(screen.getByLabelText('Tên nhà xe mới'), { target: { value: 'Nhà xe Tân Cảng' } });
    fireEvent.change(screen.getByLabelText(/Biển số xe của container MSKU1234567/), { target: { value: '51D-888.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu container MSKU1234567' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/shipments/cus-workspace/1/containers/10',
      expect.objectContaining({
        expectedShipmentVersion: 3,
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
    expect(screen.queryByRole('button', { name: 'Chỉnh sửa' })).toBeNull();
    expect(screen.queryByLabelText(/Biển số xe của container MSKU1234567/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu container MSKU1234567' })).toBeNull();
  });

  it('confirms the consequential lock action and closes the dialog after success', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    const drawer = await screen.findByRole('dialog');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Khóa lô' }));

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
    await screen.findByRole('table');
    fireEvent.click(masterRowDetailButton());
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Khóa lô' }));

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

    fireEvent.click(masterRowDetailButton());
    const secondDrawer = await screen.findByRole('dialog');
    fireEvent.click(within(secondDrawer).getByRole('button', { name: 'Khóa lô' }));
    const secondDialog = await screen.findByRole('dialog');
    fireEvent.click(within(secondDialog).getByRole('button', { name: 'Khóa lô' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(3));
    const thirdKey = (apiPost.mock.calls[2]?.[2] as { headers?: Record<string, string> } | undefined)?.headers?.['Idempotency-Key'];
    expect(thirdKey).toBe('00000000-0000-4000-8000-000000000002');
    expect(thirdKey).not.toBe(firstKey);
    expect(randomUUID).toHaveBeenCalledTimes(2);
    randomUUID.mockRestore();
  });

  it('uses a bounded, sticky, keyboard-focusable worksheet without mobile card fallback', () => {
    expect(css).toMatch(/\.cus-worksheet-viewport\s*\{[\s\S]*?max-height:[\s\S]*?overflow:\s*auto;[\s\S]*?scrollbar-gutter:\s*stable both-edges;/);
    expect(css).toMatch(/\.cus-worksheet-table\s*\{[\s\S]*?width:\s*2368px;[\s\S]*?table-layout:\s*fixed;/);
    expect(css).toMatch(/\.cus-worksheet-table col\.cus-worksheet-col--control\s*\{\s*width:\s*144px;/);
    expect(css).toMatch(/\.cus-worksheet-table thead th\s*\{[\s\S]*?position:\s*sticky;/);
    expect(css).toMatch(/\.cus-worksheet-table \.cus-worksheet-sticky-control\s*\{[\s\S]*?left:\s*0;/);
    expect(css).toMatch(/\.cus-row-disclosure--worksheet\s*\{[\s\S]*?width:\s*128px;[\s\S]*?height:\s*44px;/);
    expect(source).toContain('tabIndex={0}');
    expect(source).toContain('scope="colgroup"');
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).not.toContain('cus-mobile-list');
    expect(source).not.toContain('MASTER_COLUMN_PREFERENCES_KEY');
  });

  it('uses distinct semantic colors for running and locked shipments', () => {
    expect(source).toMatch(/\[ShipmentCusBucket\.RUNNING\]:\s*'var\(--accent\)'/);
    expect(source).toMatch(/\[ShipmentCusBucket\.LOCKED\]:\s*'var\(--slate-4\)'/);
    expect(css).toMatch(/\.cus-workflow-badge--locked\s*\{[^}]*background:\s*var\(--slate-5\);[^}]*color:\s*var\(--slate-4\);/);
  });
});
