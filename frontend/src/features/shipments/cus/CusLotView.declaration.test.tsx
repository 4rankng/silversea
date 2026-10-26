// SIL-498 (khách 25/10): drawer Tổng quan phải cho NHẬP số tờ khai THEO TỪNG
// CONT ngay trong bảng Thông tin hàng + nút copy ở dòng đầu điền các dòng
// TRỐNG (không ghi đè dòng đã có số khác). Cell inline là ngoại lệ read-only
// duy nhất của drawer — gate ghi do trang truyền xuống (fieldAccess + role +
// khóa kế toán), còn hành vi lưu/copy là callback của host.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { CusLotView } from './CusLotView';

function makeLine(overrides: Partial<ShipmentCusWorkspaceContainerLine> & { id: number; ordinal: number }): ShipmentCusWorkspaceContainerLine {
  return {
    operationalSiteId: null,
    containerNumber: `MSKU${String(100000 + overrides.id).slice(0, 7)}0`,
    declarationNumber: null,
    containerTypeId: null,
    containerTypeLabel: '40DC',
    routeId: null,
    routeName: null,
    dispatchStatus: 'AWAITING_VEHICLE',
    tripId: null,
    tripStatus: null,
    carrierType: null,
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    carrierName: null,
    plateNumber: null,
    liftSiteId: null,
    liftSite: null,
    dropoffSiteId: null,
    dropoffSite: null,
    customerAppointmentAt: null,
    raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null, routeId: null },
    fieldAccess: {},
    permissions: {
      carrierEditable: false, plateEditable: false, containerTypeEditable: false,
      routeEditable: false, liftSiteEditable: false, dropoffSiteEditable: false,
      customerAppointmentEditable: false,
    },
    shipmentVersion: 1,
    relatedTripVersion: null,
    ...overrides,
  } as ShipmentCusWorkspaceContainerLine;
}

function makeItem(): ShipmentCusWorkspaceListItem {
  return {
    id: 77,
    customerName: 'Khách SIL-498',
    cargoMode: 'FCL',
    isCombined: false,
    declarationNumbers: [],
    billOrBookNumber: 'BILL-498',
    shippingLineName: null,
    appointmentGroups: [],
    plannedReturnAt: null,
    customerNotes: null,
    operationalNotes: null,
    raw: { tradeDirection: 'IMPORT', isAdHoc: false },
    operational: { scheduleReadiness: 'SCHEDULED', vehicleReadiness: 'READY', missingCarrierContainers: 0, missingPlateContainers: 0 },
    finance: { isLoss: false, hasPendingRecovery: false, customerChargeTotalsAvailable: false, customerInvoiceTotal: null, customerNoInvoiceTotal: null, totalCost: null },
    documentCustody: { status: 'NONE', label: null },
    accountingConfirmation: { status: 'PENDING' },
    activeLock: null,
    action: { kind: 'NONE', enabled: false },
    debitNote: { available: true },
  } as unknown as ShipmentCusWorkspaceListItem;
}

function makeDetail(lines: ShipmentCusWorkspaceContainerLine[]): ShipmentCusWorkspaceDetail {
  return { summary: makeItem(), containers: lines, selectors: { operationalSites: [] } } as unknown as ShipmentCusWorkspaceDetail;
}

const threeLines = () => [
  makeLine({ id: 11, ordinal: 1, containerNumber: 'MSKU1000110', declarationNumber: 'TK-DẦU' }),
  makeLine({ id: 12, ordinal: 2, containerNumber: 'MSKU1000120', declarationNumber: null }),
  makeLine({ id: 13, ordinal: 3, containerNumber: 'MSKU1000130', declarationNumber: 'TK-KHÁC' }),
];

function renderView(
  lines: ShipmentCusWorkspaceContainerLine[],
  editable: boolean,
  actions?: {
    onSaveDeclaration: (line: ShipmentCusWorkspaceContainerLine, value: string) => Promise<void>;
    onCopyDeclaration: (line: ShipmentCusWorkspaceContainerLine) => Promise<void>;
  },
) {
  return render(
    <CusLotView
      item={makeItem()}
      detail={makeDetail(lines)}
      loading={false}
      error={undefined}
      onRetry={() => {}}
      canEditDeclaration={editable}
      declarationActions={actions}
    />,
  );
}

describe('CusLotView — SIL-498 tờ khai per-cont trong drawer', () => {
  it('R1: cột Số tờ khai render GIÁ TRỊ RIÊNG từng dòng (lô nhiều tờ khai khác nhau không bị gộp)', () => {
    const onSaveDeclaration = vi.fn().mockResolvedValue(undefined);
    const onCopyDeclaration = vi.fn().mockResolvedValue(undefined);
    renderView(threeLines(), true, { onSaveDeclaration, onCopyDeclaration });
    expect(screen.getByLabelText('Số tờ khai — container 1 (MSKU1000110)')).toHaveValue('TK-DẦU');
    expect(screen.getByLabelText('Số tờ khai — container 2 (MSKU1000120)')).toHaveValue('');
    expect(screen.getByLabelText('Số tờ khai — container 3 (MSKU1000130)')).toHaveValue('TK-KHÁC');
  });

  it('R1: Enter commit gọi onSaveDeclaration với giá trị đã trim; unchanged không gọi', async () => {
    const onSaveDeclaration = vi.fn().mockResolvedValue(undefined);
    const onCopyDeclaration = vi.fn().mockResolvedValue(undefined);
    renderView(threeLines(), true, { onSaveDeclaration, onCopyDeclaration });
    const row2 = screen.getByLabelText(/Số tờ khai — container 2/);
    fireEvent.change(row2, { target: { value: '  TK-MỚI  ' } });
    fireEvent.keyDown(row2, { key: 'Enter' });
    await waitFor(() => expect(onSaveDeclaration).toHaveBeenCalledTimes(1));
    expect(onSaveDeclaration).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }), 'TK-MỚI');
    // Dòng 3 giữ nguyên số → Enter không tạo lệnh lưu (không fan-out ảo).
    fireEvent.keyDown(screen.getByLabelText(/Số tờ khai — container 3/), { key: 'Enter' });
    expect(onSaveDeclaration).toHaveBeenCalledTimes(1);
    // Dòng 1: draft khớp persisted → không gọi.
    fireEvent.keyDown(screen.getByLabelText(/Số tờ khai — container 1/), { key: 'Enter' });
    expect(onSaveDeclaration).toHaveBeenCalledTimes(1);
  });

  it('R1: clear (xóa trắng + blur) gọi onSaveDeclaration với chuỗi rỗng — clear là local', async () => {
    const onSaveDeclaration = vi.fn().mockResolvedValue(undefined);
    const onCopyDeclaration = vi.fn().mockResolvedValue(undefined);
    renderView(threeLines(), true, { onSaveDeclaration, onCopyDeclaration });
    const row3 = screen.getByLabelText(/Số tờ khai — container 3/);
    fireEvent.change(row3, { target: { value: '' } });
    fireEvent.blur(row3);
    await waitFor(() => expect(onSaveDeclaration).toHaveBeenCalledWith(expect.objectContaining({ id: 13 }), ''));
  });

  it('R2: nút Copy tờ khai CHỈ ở dòng đầu, chỉ khi dòng đầu đã lưu số và còn dòng trống', () => {
    const onCopyDeclaration = vi.fn().mockResolvedValue(undefined);
    const onSaveDeclaration = vi.fn().mockResolvedValue(undefined);
    renderView(threeLines(), true, { onSaveDeclaration, onCopyDeclaration });
    const copy = screen.getByRole('button', { name: /Copy tờ khai cho các dòng dưới \(1 dòng trống\)/ });
    expect(copy).toBeInTheDocument();
    // Draft chưa lưu không được nhìn thấy là copy-được (copy là số persisted).
    fireEvent.change(screen.getByLabelText(/Số tờ khai — container 1/), { target: { value: 'TK-DRAFT' } });
    expect(screen.queryByRole('button', { name: /Copy tờ khai cho các dòng dưới/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Số tờ khai — container 1/), { target: { value: 'TK-DẦU' } });
    fireEvent.click(screen.getByRole('button', { name: /Copy tờ khai cho các dòng dưới/ }));
    expect(onCopyDeclaration).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }));
  });

  it('R2: hết dòng trống hoặc dòng đầu chưa có số → không có nút copy', () => {
    const onSaveDeclaration = vi.fn().mockResolvedValue(undefined);
    const onCopyDeclaration = vi.fn().mockResolvedValue(undefined);
    const allFilled = [
      makeLine({ id: 11, ordinal: 1, containerNumber: 'MSKU1000110', declarationNumber: 'TK-1' }),
      makeLine({ id: 12, ordinal: 2, containerNumber: 'MSKU1000120', declarationNumber: 'TK-2' }),
    ];
    const filled = renderView(allFilled, true, { onSaveDeclaration, onCopyDeclaration });
    expect(screen.queryByRole('button', { name: /Copy tờ khai cho các dòng dưới/ })).not.toBeInTheDocument();
    filled.unmount();
    const noneFilled = [
      makeLine({ id: 11, ordinal: 1, containerNumber: 'MSKU1000110', declarationNumber: null }),
      makeLine({ id: 12, ordinal: 2, containerNumber: 'MSKU1000120', declarationNumber: null }),
    ];
    renderView(noneFilled, true, { onSaveDeclaration, onCopyDeclaration });
    expect(screen.queryByRole('button', { name: /Copy tờ khai cho các dòng dưới/ })).not.toBeInTheDocument();
  });

  it('R4: không writable → text thường, không ô nhập/không nút copy', () => {
    renderView(threeLines(), false);
    expect(screen.queryByLabelText(/Số tờ khai — container/)).not.toBeInTheDocument();
    expect(screen.getByText('TK-DẦU')).toBeInTheDocument();
    expect(screen.getByText('TK-KHÁC')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy tờ khai/ })).not.toBeInTheDocument();
  });
});
