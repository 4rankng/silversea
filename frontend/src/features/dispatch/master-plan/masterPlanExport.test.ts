/**
 * Card 081026093510 — the /dispatch "Xuất file Excel" worksheet export.
 * Unit pins: the collect walk covers EVERY page of the filtered view (the
 * /shipments "Tải XLSX" precedent), and the eight mapped columns carry the
 * exact text the MasterPlanGrid cells show — named placeholders included
 * (design §1: empty values name the field).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentStatus } from '@tingting/shared';

const { listShipmentsMock, downloadCSVMock } = vi.hoisted(() => ({
  listShipmentsMock: vi.fn(),
  downloadCSVMock: vi.fn(),
}));

vi.mock('../../../api/shipmentClient', () => ({ listShipments: listShipmentsMock }));
vi.mock('../../../lib/csv', () => ({ downloadCSV: downloadCSVMock }));

import type { ShipmentListItem } from '../../../api/shipmentClient';
import {
  collectMasterPlanExportItems,
  exportMasterPlanWorksheet,
  mapMasterPlanExportRow,
  MASTER_PLAN_EXPORT_HEADERS,
} from './masterPlanExport';
import type { MasterPlanFilters } from './useDispatchMasterPlan';

const filters: MasterPlanFilters = {
  q: 'ABC',
  tradeDirection: 'IMPORT',
  allocationStatus: '',
  deliveryDateFrom: '',
  deliveryDateTo: '',
  portIds: [3],
  carrierKeys: [],
};

const row = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000100',
  customerName: 'Công ty ABC',
  routeName: 'LH — Biên Hòa',
  factoryName: 'Nhà máy XYZ',
  factoryNames: ['Nhà máy XYZ', 'Nhà máy DEF'],
  blNumber: 'BL-2026-001',
  bookingRef: null,
  shippingLineName: 'Maersk',
  tradeDirection: 'IMPORT',
  expectedDeliveryDate: '2026-08-20',
  customsCutoffAt: '2026-08-01T05:00:00.000Z',
  operationalNotes: 'Ghi chú cũ',
  factoryNotes: 'Đóng ca chiều',
  opsRecoveryNotes: ['Giao theo chứng từ'],
  containerCount20: 1,
  containerCount40: 2,
  containerTypeSummary: '2 x 40HC + 1 x 20DC',
  totalCargoWeightKg: 41000,
  allocationStatus: 'PARTIALLY_ALLOCATED',
  status: ShipmentStatus.READY_FOR_DISPATCH,
  carrierAllocationSummary: [
    { carrierType: 'OWN', externalCarrierId: null, carrierLabel: 'SilverSea', count20: 1, count40: 2 },
  ],
  appointmentGroups: [],
  containerPortGroups: [
    { pickupPortName: 'Cảng Cát Lái', dropoffPortName: 'Kho Bình Dương', containerSummary: '2 x 40HC + 1 x 20DC' },
  ],
  ...overrides,
} as ShipmentListItem);

beforeEach(() => {
  listShipmentsMock.mockReset();
  downloadCSVMock.mockReset().mockResolvedValue(undefined);
});

describe('collectMasterPlanExportItems', () => {
  it('walks every page of the filtered view with the board query', async () => {
    listShipmentsMock
      .mockResolvedValueOnce({ items: [row({ id: 1 }), row({ id: 2 })], total: 150 })
      .mockResolvedValueOnce({ items: [row({ id: 3 })], total: 150 });

    const items = await collectMasterPlanExportItems(filters);

    expect(items.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(listShipmentsMock).toHaveBeenCalledTimes(2);
    expect(listShipmentsMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      page: 1,
      limit: 100,
      q: 'ABC',
      tradeDirection: 'IMPORT',
      portIds: [3],
      status: [
        ShipmentStatus.READY_FOR_DISPATCH,
        ShipmentStatus.DISPATCHED,
        ShipmentStatus.IN_TRANSIT,
        ShipmentStatus.COMPLETED,
      ],
    }));
    expect(listShipmentsMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }));
    // The summary flag is board furniture — the export never asks for it.
    expect(listShipmentsMock.mock.calls[0]?.[0]?.includeDispatchSummary).toBeUndefined();
  });
});

describe('mapMasterPlanExportRow', () => {
  it('maps the eight grid columns with the same text the cells show', () => {
    const cells = mapMasterPlanExportRow(row());

    expect(cells).toHaveLength(8);
    expect(cells[0]).toBe('20/08/2026\nHạn hoàn tất hải quan: 12:00 01/08/2026');
    expect(cells[1]).toBe('Công ty ABC\nNhà máy XYZ + Nhà máy DEF\nBL-2026-001');
    expect(cells[2]).toBe('LH — Biên Hòa\nNhập\nMaersk');
    expect(cells[3]).toBe('Cảng Cát Lái\n2 x 40HC\n1 x 20DC');
    expect(cells[4]).toBe('Kho Bình Dương\n2 x 40HC\n1 x 20DC');
    expect(cells[5]).toBe('2 x 40HC\n1 x 20DC\n41.000 kg');
    expect(cells[6]).toBe("SilverSea: 1x20' · 2x40'");
    expect(cells[7]).toBe('Ghi chú cũ\nOPS: Giao theo chứng từ\nNM: Đóng ca chiều');
  });

  it('names the missing facts instead of bare dashes (design §1)', () => {
    const cells = mapMasterPlanExportRow(row({
      customerName: null,
      factoryNames: undefined,
      factoryName: null,
      blNumber: null,
      bookingRef: null,
      isAdHoc: true,
      routeName: null,
      tradeDirection: null,
      shippingLineName: null,
      expectedDeliveryDate: null,
      customsCutoffAt: null,
      operationalNotes: null,
      opsRecoveryNotes: undefined,
      factoryNotes: null,
      containerTypeSummary: null,
      totalCargoWeightKg: null,
      containerPortGroups: [],
      carrierAllocationSummary: [],
    }));

    expect(cells[0]).toBe('');
    expect(cells[1]).toBe('—\n—\n— · Chạy ngoài');
    expect(cells[2]).toBe('—\n—\n—');
    expect(cells[3]).toBe('Chưa có cont');
    expect(cells[4]).toBe('Chưa có cont');
    expect(cells[5]).toBe('Chưa có cont\n—');
    expect(cells[6]).toBe('Chưa phân bổ');
    expect(cells[7]).toBe('');
  });

  it('narrows schedule and cargo to the day on a single-day view, like the grid', () => {
    const item = row({
      appointmentGroups: [
        { at: '2026-08-20T02:00:00.000Z', localDate: '2026-08-20', factoryName: 'Nhà máy XYZ', factoryShortName: 'Nhà máy XYZ', factoryFullName: 'Nhà máy XYZ', containerSummary: '1 x 40HC' },
        { at: '2026-08-21T02:00:00.000Z', localDate: '2026-08-21', factoryName: 'Nhà máy XYZ', factoryShortName: 'Nhà máy XYZ', factoryFullName: 'Nhà máy XYZ', containerSummary: '1 x 20DC' },
      ],
    });

    const cells = mapMasterPlanExportRow(item, '2026-08-20');

    expect(cells[0]).toContain('Nhà máy XYZ · 1 x 40HC');
    expect(cells[0]).not.toContain('1 x 20DC');
    expect(cells[5]).toBe('1 x 40HC\n41.000 kg');
  });
});

describe('exportMasterPlanWorksheet', () => {
  it('writes the dated worksheet and returns the exported lot count', async () => {
    listShipmentsMock.mockResolvedValue({ items: [row()], totalPages: 1, total: 1 });

    const count = await exportMasterPlanWorksheet(filters, null);

    expect(count).toBe(1);
    expect(downloadCSVMock).toHaveBeenCalledTimes(1);
    const [filename, headers, rows, options] = downloadCSVMock.mock.calls[0];
    expect(filename).toMatch(/^ke-hoach-tong-quat-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(headers).toEqual([...MASTER_PLAN_EXPORT_HEADERS]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(8);
    expect(options.title).toBe('Kế hoạch Tổng quát');
    expect(options.subtitle).toBe('1 lô hàng');
    expect(options.hideTotals).toBe(true);
  });
});
