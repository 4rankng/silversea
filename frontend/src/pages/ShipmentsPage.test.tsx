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
      customerAppointmentEditable: true,
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
  const element = document.querySelector('button.cus-row-disclosure');
  if (!(element instanceof HTMLButtonElement)) throw new Error('shipment detail button not rendered');
  return element;
}

describe('ShipmentsPage — CUS closeout workspace', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
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

  it('keeps a 12-column master grid while putting container records in its inline detail row', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    const surface = within(table);
    expect(surface.queryByRole('columnheader', { name: 'Chi tiết' })).toBeNull();
    expect(surface.getByRole('columnheader', { name: 'Khách hàng / Nhà máy' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Bill/Book / Tờ khai' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Hãng tàu / Tuyến' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Loại hàng' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Số lượng' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Kế hoạch' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Thu có hóa đơn' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Thu không hóa đơn' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Tổng chi phí' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Phơi phiếu' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Kế toán duyệt' })).toBeTruthy();
    expect(surface.getByRole('columnheader', { name: 'Trạng thái / Hành động' })).toBeTruthy();
    expect(surface.getByText('12/8/2026').closest('.cus-operational-evidence')?.querySelector('svg')).toBeNull();
    expect(surface.getByText('12.000.000 ₫')).toBeTruthy();
    expect(surface.getByText('14.000.000 ₫')).toBeTruthy();
    expect(surface.getByLabelText('Lỗ 500.000 đồng')).toBeTruthy();
    expect(screen.getByLabelText('Tình trạng các lô đang hiển thị')).toBeTruthy();
    expect(screen.getByLabelText('Chú thích trạng thái lô hàng')).toBeTruthy();
    expect(surface.getByText('Lỗ')).toBeTruthy();
    expect(surface.getByText('Chờ thu hồi')).toBeTruthy();
    expect(surface.queryByText('Không cảnh báo')).toBeNull();
    expect((surface.getByRole('button', { name: 'Khóa lô' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(masterRowDetailButton());
    const inlineDetail = await screen.findByText('Chi phí không nhập tại đây. Kế toán đối soát chi phí thực tế sau khi lô hàng hoàn thành.');
    expect(inlineDetail.closest('.cus-inline-detail-row')).not.toBeNull();
    expect(within(inlineDetail.closest('.cus-inline-detail-row') as HTMLElement).queryByText('Đối soát và chứng từ')).toBeNull();
    expect(within(inlineDetail.closest('.cus-inline-detail-row') as HTMLElement).getByRole('article', { name: 'MSKU1234567' })).toBeTruthy();
    expect(within(inlineDetail.closest('.cus-inline-detail-row') as HTMLElement).getByRole('button', { name: 'Thu gọn chi tiết container' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByText(/Đã xác nhận:/)).toHaveLength(1);

    const mobileList = document.querySelector('.cus-mobile-list');
    expect(mobileList).not.toBeNull();
    const mobileSurface = within(mobileList as HTMLElement);
    expect(mobileSurface.getByText('Container')).toBeTruthy();
    expect(mobileSurface.getByText('2x40HC · Nhập')).toBeTruthy();
  });

  it('lets CUS hide optional columns without changing the core ledger fields', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Hãng tàu / Tuyến' })).toBeTruthy();

    const columnTrigger = screen.getByRole('button', { name: 'Chọn cột hiển thị' });
    fireEvent.pointerDown(columnTrigger, { button: 0, ctrlKey: false });
    const routeColumn = await screen.findByRole('menuitemcheckbox', { name: 'Hãng tàu / Tuyến' });
    expect(routeColumn.getAttribute('data-state')).toBe('checked');
    fireEvent.click(routeColumn);

    await waitFor(() => expect(within(table).queryByRole('columnheader', { name: 'Hãng tàu / Tuyến' })).toBeNull());
    expect(within(table).getByRole('columnheader', { name: 'Khách hàng / Nhà máy' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'Tổng chi phí' })).toBeTruthy();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('silversea:cus-shipments:master-columns:v3') ?? '{}').wide).not.toContain('route'));

    fireEvent.pointerDown(columnTrigger, { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Khôi phục mặc định' }));
    await waitFor(() => expect(within(table).getByRole('columnheader', { name: 'Hãng tàu / Tuyến' })).toBeTruthy());
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('silversea:cus-shipments:master-columns:v3') ?? '{}').wide).toContain('route'));
  });

  it('keeps details open independently for more than one shipment', async () => {
    const secondRow: ShipmentCusWorkspaceListItem = {
      ...row,
      id: 2,
      billOrBookNumber: 'BILL-54321',
      customerName: 'Công ty Sao Mai',
    };
    apiGet.mockImplementation((url: string) => {
      if (url === '/shipments/cus-workspace/1') return Promise.resolve(detail);
      if (url === '/shipments/cus-workspace/2') return Promise.resolve({ ...detail, summary: secondRow });
      return Promise.resolve(listResponse([row, secondRow]));
    });

    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    const rows = document.querySelectorAll('tr.cus-master-row');
    fireEvent.click(rows[0] as HTMLTableRowElement);
    fireEvent.click(rows[1] as HTMLTableRowElement);

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/2'));
    expect(document.querySelector('#cus-inline-detail-1')).not.toBeNull();
    expect(document.querySelector('#cus-inline-detail-2')).not.toBeNull();
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

  it('keeps custody control on the mobile shipment card, outside container detail', async () => {
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
    const mobileReference = document.querySelector('.cus-mobile-card__reference');
    expect(mobileReference).not.toBeNull();
    expect(within((mobileReference as HTMLElement).closest('.cus-mobile-card') as HTMLElement).getByRole('combobox', { name: /Trạng thái phơi phiếu/ })).toBeTruthy();

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
    await screen.findAllByText('Công ty Silver Sea');
    const referenceButton = document.querySelector('.cus-mobile-card__reference') as HTMLButtonElement | null;
    expect(referenceButton).not.toBeNull();
    const card = referenceButton?.closest('article');
    expect(card).not.toBeNull();
    fireEvent.click(card as HTMLElement);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xem chi tiết' })).toBeNull();
    expect(card?.getAttribute('role')).toBeNull();

    window.ResizeObserver = originalResizeObserver;
  });

  it('switches at the available-workspace boundaries without changing to cards too early', async () => {
    let observedCallback: ResizeObserverCallback | undefined;
    let workspaceWidth = 1040;
    class WorkspaceLayoutObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        observedCallback = this.callback;
        this.callback([], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    }
    const originalResizeObserver = window.ResizeObserver;
    const boundingBox = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      width: workspaceWidth,
      height: 800,
      top: 0,
      left: 0,
      right: workspaceWidth,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    window.ResizeObserver = WorkspaceLayoutObserver as unknown as typeof ResizeObserver;

    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    expect(document.querySelector(".cus-workspace[data-layout='wide']")).not.toBeNull();

    workspaceWidth = 1039;
    observedCallback?.([], {} as ResizeObserver);
    await waitFor(() => expect(document.querySelector(".cus-workspace[data-layout='compact']")).not.toBeNull());

    workspaceWidth = 760;
    observedCallback?.([], {} as ResizeObserver);
    await waitFor(() => expect(document.querySelector(".cus-workspace[data-layout='compact']")).not.toBeNull());

    workspaceWidth = 759;
    observedCallback?.([], {} as ResizeObserver);
    await waitFor(() => expect(document.querySelector(".cus-workspace[data-layout='cards']")).not.toBeNull());

    window.ResizeObserver = originalResizeObserver;
    boundingBox.mockRestore();
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
    expect(within(table).getByText('Chưa đủ dữ liệu xác nhận')).toBeTruthy();
    fireEvent.click(masterRowDetailButton());
    expect((await screen.findAllByText('Chưa đủ dữ liệu xác nhận')).length).toBe(1);
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
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Chờ Kế toán')).toBeTruthy();
    expect(within(table).queryByText('Xác nhận Kế toán đã hết hiệu lực.')).toBeNull();
    expect((within(table).getByRole('button', { name: 'Khóa lô' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(masterRowDetailButton());
    const note = await screen.findByText('Chi phí không nhập tại đây. Kế toán đối soát chi phí thực tế sau khi lô hàng hoàn thành.');
    expect(within(note.closest('.cus-inline-detail-row') as HTMLElement).queryByText('Xác nhận Kế toán đã hết hiệu lực.')).toBeNull();
  });

  it('loads operational container detail lazily and keeps finance entry outside the expansion', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    expect(apiGet).not.toHaveBeenCalledWith('/shipments/cus-workspace/1');

    const rowElement = masterRow();
    fireEvent.click(rowElement);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/shipments/cus-workspace/1'));
    expect(screen.queryByRole('dialog')).toBeNull();
    const ledger = await screen.findByLabelText('Chi tiết container');
    expect(within(ledger).getByText('MSKU1234567')).toBeTruthy();
    expect(within(ledger).getByText('Nhận diện')).toBeTruthy();
    expect(within(ledger).getByText('Vận hành')).toBeTruthy();
    expect(within(masterRow()).getByText('Maersk')).toBeTruthy();
    expect(within(ledger).getByText('Đã tạo chuyến')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chỉnh sửa' })).toBeTruthy();
    expect(screen.queryByLabelText(/Biển số xe của container MSKU1234567/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu container MSKU1234567' })).toBeNull();
    expect(screen.getByText('Chi phí không nhập tại đây. Kế toán đối soát chi phí thực tế sau khi lô hàng hoàn thành.')).toBeTruthy();
    expect(screen.queryByText('Cước đầu ra')).toBeNull();
    expect(screen.queryByText('Cước đầu vào')).toBeNull();
    expect(screen.queryByText('Phí chi hộ')).toBeNull();
    expect(screen.queryByText('Chưa thu hồi sửa chữa')).toBeNull();
  });

  it('uses the floating collapse control and protects unsaved container changes', async () => {
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRow());
    const inlineDetail = await screen.findByText('Chi tiết container');
    const collapse = within(inlineDetail.closest('.cus-inline-detail-row') as HTMLElement).getByRole('button', { name: 'Thu gọn chi tiết container' });

    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
    fireEvent.change(screen.getByLabelText(/Biển số xe của container MSKU1234567/), { target: { value: '15C-888.88' } });
    fireEvent.click(masterRow());
    expect(document.querySelector('#cus-inline-detail-1')).not.toBeNull();
    fireEvent.click(collapse);
    expect(screen.getByText('Có thay đổi container chưa lưu.')).toBeTruthy();
    expect(document.querySelector('#cus-inline-detail-1')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi và thu gọn' }));
    await waitFor(() => expect(document.querySelector('#cus-inline-detail-1')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(masterRowDetailButton()));
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
    fireEvent.click(document.querySelector('.cus-mobile-card__reference') as HTMLButtonElement);
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
    fireEvent.click(document.querySelector('.cus-mobile-card__reference') as HTMLButtonElement);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chỉnh sửa' }));
    fireEvent.change(await within(dialog).findByLabelText(/Biển số xe của container MSKU1234567/), { target: { value: '15C-666.66' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu container MSKU1234567' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Bỏ thay đổi container?' })).toBeNull();
    expect(screen.getByText('Đang lưu dữ liệu container. Vui lòng chờ hoàn tất.')).toBeTruthy();
    resolveSave?.({ line: { ...detail.containers[0], plateNumber: '15C-666.66', shipmentVersion: 4, factVersion: 2 } });
    await waitFor(() => expect(screen.queryByText('Đang lưu dữ liệu container. Vui lòng chờ hoàn tất.')).toBeNull());

    window.ResizeObserver = originalResizeObserver;
  });

  it('keeps the finance handoff when a shipment has no container rows', async () => {
    apiGet.mockImplementation((url: string) => (
      url === '/shipments/cus-workspace/1'
        ? Promise.resolve({ ...detail, containers: [] })
        : Promise.resolve(listResponse())
    ));
    renderPage();
    await screen.findAllByText('Công ty Silver Sea');
    fireEvent.click(masterRow());

    const emptyState = await screen.findByText('Lô hàng chưa có dữ liệu container.');
    const inlineDetail = emptyState.closest('.cus-inline-detail-row') as HTMLElement;
    expect(within(inlineDetail).getByText('Chi phí không nhập tại đây. Kế toán đối soát chi phí thực tế sau khi lô hàng hoàn thành.')).toBeTruthy();
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
    fireEvent.change(await screen.findByLabelText(/Ngày vận chuyển của BILL-12345/), { target: { value: '2026-08-14' } });
    fireEvent.click(screen.getByRole('button', { name: /Chốt ngày vận chuyển của BILL-12345/ }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shipments/1', {
      expectedVersion: 3,
      expectedDeliveryDate: '2026-08-14',
    }));
    expect(apiGet.mock.calls.filter(([url]) => url === '/shipments/cus-workspace/1')).toHaveLength(0);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Chỉnh sửa' }));

    const plate = await screen.findByLabelText(/Biển số xe của container MSKU1234567/);
    fireEvent.change(plate, { target: { value: '15C-999.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu container MSKU1234567' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/shipments/cus-workspace/1/containers/10',
      expect.objectContaining({
        expectedShipmentVersion: 3,
        expectedFactVersion: 1,
        plateNumber: '15C-999.99',
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
      .mockResolvedValueOnce({ line: { ...detail.containers[0], plateNumber: '15C-999.99', shipmentVersion: 4, factVersion: 2 } })
      .mockResolvedValueOnce({ line: { ...secondLine, plateNumber: '15C-888.88', shipmentVersion: 5, factVersion: 2 } });
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
      expect.objectContaining({ expectedShipmentVersion: 4, expectedFactVersion: 1, plateNumber: '15C-888.88' }),
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
    expect(screen.queryByRole('button', { name: 'Chỉnh sửa' })).toBeNull();
    expect(screen.queryByLabelText(/Biển số xe của container MSKU1234567/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu container MSKU1234567' })).toBeNull();
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

  it('uses a wrapping 12-column master ledger and responsive two-tier container detail without horizontal scrolling', () => {
    expect(css).toMatch(/\.cus-master-scroll\s*\{[^}]*overflow-x:\s*clip;/);
    expect(css).not.toMatch(/\.cus-master-scroll\s*\{[^}]*max-height:/);
    expect(css).not.toMatch(/\.cus-master-scroll\s*\{[^}]*overflow-y:\s*auto;/);
    expect(css).toMatch(/\.cus-master-table\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?table-layout:\s*fixed;/);
    expect(css).toMatch(/\.cus-master-table th\s*\{[\s\S]*?white-space:\s*normal;/);
    expect(css).toMatch(/\.cus-master-table td\s*\{[\s\S]*?font-size:\s*11px;/);
    expect(css).toMatch(/\.cus-operational-evidence strong,[\s\S]*?white-space:\s*normal;/);
    expect(css).not.toMatch(/\.cus-operational-evidence strong,[\s\S]*?text-overflow:\s*ellipsis;/);
    expect(css).toMatch(/\.cus-inline-detail-row > td\s*\{[\s\S]*?padding:\s*0;/);
    expect(css).toMatch(/\.cus-detail-content\s*\{[\s\S]*?overflow:\s*visible;/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='compact'\] \.cus-master-table th/);
    expect(css).toMatch(/\.cus-index-cell\s*\{[\s\S]*?display:\s*grid;/);
    expect(css).toMatch(/\.cus-index-cell > strong\s*\{[\s\S]*?white-space:\s*normal;/);
    expect(css).not.toMatch(/\.cus-cell-stack/);
    expect(css).not.toMatch(/\.cus-master-table\s*\{[\s\S]*?min-width:\s*2300px;/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-master-scroll\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-mobile-list\s*\{[\s\S]*?display:\s*grid;/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-mobile-card--interactive\s*\{\s*cursor:\s*pointer;/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-mobile-card__reference:focus-visible\s*\{/);
    expect(css).toMatch(/\.cus-workspace\[data-layout='cards'\] \.cus-toolbar\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).not.toMatch(/\.cus-drawer-actions|\.cus-drawer-transport-date|\.cus-drawer-custody/);
    expect(css).toMatch(/\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-page\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;/);
    expect(css).toMatch(/\.cus-container-ledger__finance-note\s*\{[\s\S]*?line-height:\s*1\.5;/);
    expect(css).toMatch(/\.cus-container-records\s*\{[\s\S]*?display:\s*grid;[\s\S]*?min-width:\s*0;/);
    expect(css).toMatch(/\.cus-container-record__tier\s*\{[\s\S]*?grid-template-columns:\s*78px minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.cus-detail-collapse\s*\{[\s\S]*?position:\s*sticky;/);
    expect(css).toMatch(/\.cus-row-disclosure\s*\{/);
    expect(css).toMatch(/\.cus-status-cell \.btn\s*\{[\s\S]*?justify-self:\s*start;[\s\S]*?width:\s*fit-content;[\s\S]*?max-width:\s*100%;[\s\S]*?min-height:\s*44px;/);
    expect(source).not.toMatch(/cus-master-table__col-detail|cus-row-toggle|<th scope="col">Chi tiết<\/th>/);
  });

  it('uses distinct semantic colors for running and locked shipments', () => {
    expect(source).toMatch(/\[ShipmentCusBucket\.RUNNING\]:\s*'var\(--accent\)'/);
    expect(source).toMatch(/\[ShipmentCusBucket\.LOCKED\]:\s*'var\(--slate-4\)'/);
    expect(css).toMatch(/\.cus-workflow-badge--locked\s*\{[^}]*background:\s*var\(--slate-5\);[^}]*color:\s*var\(--slate-4\);/);
  });
});
