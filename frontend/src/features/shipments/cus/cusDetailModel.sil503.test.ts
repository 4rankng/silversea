// SIL-503 — pure laws behind the lot-row (hàng lẻ) documents session on the
// /shipments-detail workboard:
//
// - `lotDeclarationWrite` — the shipment-declaration diff ONE documents save
//   issues: PUT the displayed row (metadata verbatim), POST when the lot has
//   no row, noop on echo/no-op clears. The cell displays the read model's
//   first non-empty declaration, so THAT row is the PUT target.
// - `lotPseudoLine` — the read-only stand-in line the session opens against:
//   every operational authority stays READ_ONLY (no container-line command
//   can ever be authorized by a lot row), identity mirrors the flat row.
import { describe, expect, it } from 'vitest';
import type { ShipmentCusContainerFlatRow, ShipmentCusWorkspaceDetail } from '@tingting/shared';
import { canEditMode, lotDeclarationWrite, lotPseudoLine } from './cusDetailModel';

const declarationRow = (overrides: Partial<{ id: number; declarationNumber: string | null; issuedAt: string | null; scope: 'SINGLE' | 'SHARED' | null; note: string | null }> = {}) => ({
  id: 301,
  declarationNumber: null,
  issuedAt: '2026-10-20T00:00:00.000Z',
  scope: 'SINGLE' as const,
  note: 'kèm hồ sơ',
  ...overrides,
});

const raw = (overrides: Partial<Parameters<typeof lotDeclarationWrite>[0]> = {}): Parameters<typeof lotDeclarationWrite>[0] => ({
  declarationNumber: null,
  declarationId: null,
  ...overrides,
} as Parameters<typeof lotDeclarationWrite>[0]);

describe('SIL-503 — lotDeclarationWrite diff', () => {
  it('lô chưa có row nào + nhập số mới → POST đúng số', () => {
    expect(lotDeclarationWrite(raw({ declarations: [] }), 'TK-503-NEW')).toEqual({
      kind: 'create',
      body: { declarationNumber: 'TK-503-NEW' },
    });
  });

  it('đã có row hiển thị số A, nhập số B → PUT row đó, metadata giữ nguyên verbatim', () => {
    const stored = [declarationRow({ id: 301, declarationNumber: 'TK-OLD', scope: 'SHARED', note: 'hồ sơ A' })];
    expect(lotDeclarationWrite(raw({ declarationNumber: 'TK-OLD', declarationId: 301, declarations: stored }), 'TK-NEW')).toEqual({
      kind: 'update',
      declarationId: 301,
      body: { declarationNumber: 'TK-NEW', issuedAt: '2026-10-20T00:00:00.000Z', scope: 'SHARED', note: 'hồ sơ A' },
    });
  });

  it('số trùng số đang hiển thị (kể khác khoảng trắng) → noop, không đụng API', () => {
    const stored = [declarationRow({ id: 301, declarationNumber: 'TK-OLD' })];
    expect(lotDeclarationWrite(raw({ declarationNumber: 'TK-OLD', declarationId: 301, declarations: stored }), '  TK-OLD ')).toEqual({ kind: 'noop' });
  });

  it('xoá số → PUT number null lên row đang hiển thị, metadata không mất', () => {
    const stored = [declarationRow({ id: 301, declarationNumber: 'TK-OLD', note: 'hồ sơ A' })];
    expect(lotDeclarationWrite(raw({ declarationNumber: 'TK-OLD', declarationId: 301, declarations: stored }), null)).toEqual({
      kind: 'update',
      declarationId: 301,
      body: { declarationNumber: null, issuedAt: '2026-10-20T00:00:00.000Z', scope: 'SINGLE', note: 'hồ sơ A' },
    });
  });

  it('xoá số khi lô vốn không có số → noop', () => {
    const stored = [declarationRow({ id: 301, declarationNumber: null })];
    expect(lotDeclarationWrite(raw({ declarationNumber: null, declarationId: 301, declarations: stored }), '')).toEqual({ kind: 'noop' });
  });

  it('row hiển thị rỗng nhưng có declarationId → target là row được pin (điền số vào row trống, không sinh row mới)', () => {
    const stored = [declarationRow({ id: 402, declarationNumber: null })];
    expect(lotDeclarationWrite(raw({ declarationNumber: null, declarationId: 402, declarations: stored }), 'TK-FILL')).toEqual({
      kind: 'update',
      declarationId: 402,
      body: { declarationNumber: 'TK-FILL', issuedAt: '2026-10-20T00:00:00.000Z', scope: 'SINGLE', note: 'kèm hồ sơ' },
    });
  });

  it('số mới đã tồn tại ở row khác của lô → noop (không ghi đè lên chính nó)', () => {
    const stored = [
      declarationRow({ id: 301, declarationNumber: 'TK-A' }),
      declarationRow({ id: 302, declarationNumber: 'TK-B' }),
    ];
    expect(lotDeclarationWrite(raw({ declarationNumber: 'TK-B', declarationId: 301, declarations: stored }), 'TK-B')).toEqual({ kind: 'noop' });
  });
});

const readOnly = { mode: 'READ_ONLY' as const, reason: 'r' };
const direct = { mode: 'DIRECT' as const, reason: 'd' };

const lotRow = (overrides: Partial<ShipmentCusContainerFlatRow> = {}) => ({
  id: -71,
  shipmentId: 71,
  shipmentVersion: 3,
  ordinal: 1,
  customerId: 1,
  customerName: 'LOG COM',
  factoryName: null,
  routeName: null,
  billOrBookNumber: 'EGLV503LOT0001',
  declarationNumber: 'TK-LOT-503',
  shippingLineName: null,
  isCombined: false,
  classification: 'LCL',
  direction: 'IMPORT',
  containerNumber: null,
  containerTypeLabel: null,
  dispatchStatus: 'AWAITING_VEHICLE',
  carrierName: 'Nhà xe Hùng',
  carrierType: null,
  plateNumber: null,
  actualTruckNo: null,
  billingTruckNo: null,
  revVehicleClassCode: null,
  costVehicleClassCode: null,
  liftSite: 'Kho CFS',
  dropoffSite: 'Nhà máy X',
  transportDate: '2026-10-26',
  closingAt: null,
  plannedReturnAt: null,
  customerAppointmentAt: null,
  customerNotes: null,
  operationalNotes: null,
  raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null },
  fieldAccess: {
    operationalSiteId: readOnly, containerNumber: readOnly, containerTypeId: readOnly,
    cargoWeightKg: readOnly, cargoVolumeCbm: readOnly, routeId: readOnly,
    liftSiteId: readOnly, dropoffSiteId: readOnly,
  },
  shipmentFieldAccess: {
    factoryName: direct, routeId: direct, deliveryLocation: direct, blNumber: direct,
    bookingRef: direct, tradeDirection: direct, shippingLineName: direct, declarationNumber: direct,
  },
  informationStatus: 'COMPLETE',
  missingFields: [],
  shipmentScheduleEditable: false,
  shipmentNotesEditable: false,
  carrierEditable: false,
  plateEditable: false,
  liftSiteEditable: false,
  dropoffEditable: false,
  routeEditable: false,
  customerAppointmentEditable: false,
  scheduleEditable: false,
  isLotLevel: true,
  ...overrides,
}) as ShipmentCusContainerFlatRow;

const detailFor = (version = 7) => ({
  summary: {
    id: 71,
    version,
    cargoMode: 'LCL',
    raw: { routeId: 9, declarationNumber: 'TK-LOT-503', factoryName: null, deliveryLocation: null },
    fieldAccess: {
      blNumber: direct, bookingRef: direct, tradeDirection: direct,
      shippingLineName: direct, declarationNumber: direct,
      factoryName: direct, routeId: direct, deliveryLocation: direct,
    },
  },
  containers: [],
}) as unknown as ShipmentCusWorkspaceDetail;

describe('SIL-503 — lotPseudoLine: phiên documents chạy trên line READ-ONLY', () => {
  it('mọi authority operational đều READ_ONLY; permissions rỗng; identity mirror flat row', () => {
    const row = lotRow();
    const line = lotPseudoLine(row, detailFor());
    expect(line.id).toBe(-71);
    expect(line.containerNumber).toBeNull();
    expect(line.declarationNumber).toBe('TK-LOT-503');
    expect(line.carrierName).toBe('Nhà xe Hùng');
    expect(line.routeId).toBe(9);
    expect(Object.values(line.fieldAccess).every((access) => access.mode === 'READ_ONLY')).toBe(true);
    expect(Object.values(line.permissions).every((editable) => editable === false)).toBe(true);
    expect(line.shipmentVersion).toBe(7);
  });

  it('documents mở được qua canEditMode (chỉ đọc summary); vehicle/route đóng vì line rỗng quyền', () => {
    const line = lotPseudoLine(lotRow(), detailFor());
    const detail = detailFor();
    expect(canEditMode(detail, line, 'documents')).toBe(true);
    expect(canEditMode(detail, line, 'vehicle')).toBe(false);
    expect(canEditMode(detail, line, 'route')).toBe(false);
    // identity reads summary-level access for LCL — the UI boundary for lots
    // is startEdit's documents-only mode guard + the read-only cell, pinned
    // in the ledger + hook suites, not in canEditMode.
    expect(canEditMode(detail, line, 'identity')).toBe(true);
  });

  it('summary fieldAccess READ_ONLY (lô khóa kế toán) → documents cũng đóng', () => {
    const detail = {
      summary: {
        id: 71,
        version: 7,
        cargoMode: 'LCL',
        raw: { routeId: 9, declarationNumber: 'TK-LOT-503' },
        fieldAccess: {
          blNumber: readOnly, bookingRef: readOnly, tradeDirection: readOnly,
          shippingLineName: readOnly, declarationNumber: readOnly,
        },
      },
      containers: [],
    } as unknown as ShipmentCusWorkspaceDetail;
    expect(canEditMode(detail, lotPseudoLine(lotRow(), detail), 'documents')).toBe(false);
  });
});
