// 161026232349 (DEV SPEC Hàng lẻ §II.3.2 "Trường hợp 1 · Thu riêng từng lô") —
// the lot strip's own thu-class picker: the SAME design-system searchable
// select the merge popup uses, reopening on the stored class, with the strip's
// existing Lưu BKS saving/error pattern (toast + "Đang lưu…").
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setClass, updateTruck, unmerge } = vi.hoisted(() => ({
  setClass: vi.fn(),
  updateTruck: vi.fn(),
  unmerge: vi.fn(),
}));

vi.mock('../../../api/dispatchPlanningClient', () => ({
  setLclLotRevClass: setClass,
  updateLclTruck: updateTruck,
  unmergeLclLot: unmerge,
}));

// FB-090 catalog — the same source MergeRevGroupDialog reads.
vi.mock('../../../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({
    data: [
      { id: 7, code: '3.5T', name: 'Xe 3.5 tấn', isContainer: false, sortOrder: 2, deletedAt: null },
      { id: 9, code: '5T', name: 'Xe 5 tấn', isContainer: false, sortOrder: 3, deletedAt: null },
      { id: 21, code: 'CONT20', name: "Cont 20'", isContainer: true, sortOrder: 6, deletedAt: null },
    ],
    isLoading: false,
  }),
}));

import { ToastProvider } from '../../../components/shared/Toast';
import { DebitLotLclFacts } from './DebitLotLclFacts';
import type { ShipmentDebitLotRow } from '../../../api/shipmentClient';

const row = (over: Partial<ShipmentDebitLotRow> = {}): ShipmentDebitLotRow => ({
  customerId: 501,
  shipmentId: 9001,
  code: 'SE-9001',
  customerName: 'Khách A',
  factoryName: null,
  factoryAddress: null,
  billOrBookNumber: 'BL-1',
  customsNumber: null,
  documentsSummary: null,
  freightAuto: null,
  chiHoTotal: null,
  receivableTotal: null,
  profit: null,
  lockStatus: 'OPEN',
  lockedAt: null,
  cargoMode: 'LCL',
  actualTruckNo: null,
  billingTruckNo: null,
  revVehicleClassCode: null,
  ...over,
});

function renderStrip(over: Partial<ShipmentDebitLotRow> = {}) {
  const onChanged = vi.fn();
  render(
    <ToastProvider>
      <DebitLotLclFacts
        row={row(over)}
        plateOptions={[{ value: '29C-111.11', label: '29C-111.11' }]}
        onChanged={onChanged}
      />
    </ToastProvider>,
  );
  return { onChanged };
}

const classField = () => screen.getByRole('combobox', { name: 'Loại xe tính cước thu khách' });
const priceField = () => screen.getByLabelText(/Giá cước thu khách/);
const saveClassButton = () => screen.getByRole('button', { name: 'Lưu cước thu' });

async function pickClass(combo: HTMLElement, typed: string, optionName: RegExp) {
  fireEvent.focusIn(combo);
  fireEvent.click(combo);
  fireEvent.change(combo, { target: { value: typed } });
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
}

beforeEach(() => {
  setClass.mockReset();
  updateTruck.mockReset();
  unmerge.mockReset();
});

describe('161026232349 — the lot strip thu-class picker (§II.3.2 "Thu riêng từng lô")', () => {
  it('reopens on the lot\u2019s stored class and saves a newly picked one with the strip\u2019s own states', async () => {
    setClass.mockResolvedValue({
      shipmentId: 9001,
      reference: 'BL-1',
      vehicleSizeClassId: 9,
      vehicleClassCode: '5T',
      freightAuto: '3150000',
      channel: 'TRIP',
      reason: 'Chọn loại xe tính cước thu khách — Xe 5T',
    });
    const { onChanged } = renderStrip({ revVehicleClassCode: '3.5T' });

    // The picker is the design-system searchable select, showing the CURRENT
    // class (catalog label), and it is not dirty yet.
    const combo = classField();
    expect(combo).toHaveValue('Xe 3.5 tấn');
    expect(saveClassButton()).toBeDisabled();

    await pickClass(combo, '5', /Xe 5 tấn/);
    expect(saveClassButton()).not.toBeDisabled();

    fireEvent.click(saveClassButton());
    await waitFor(() => expect(setClass).toHaveBeenCalledWith({ shipmentId: 9001, vehicleSizeClassId: 9 }));
    expect(onChanged).toHaveBeenCalled();
    // The success toast states the money law the customer asked for.
    expect(await screen.findByText(/100% đơn giá loại xe/)).toBeInTheDocument();
    // The save button comes back from its busy state.
    await waitFor(() => expect(saveClassButton()).toHaveTextContent('Lưu cước thu'));
  });

  it('a lane miss still saves the class and says the money column stays "Chưa xác định"', async () => {
    setClass.mockResolvedValue({
      shipmentId: 9001,
      reference: 'BL-1',
      vehicleSizeClassId: 21,
      vehicleClassCode: 'CONT20',
      freightAuto: null,
      channel: 'NONE',
      reason: null,
    });
    const { onChanged } = renderStrip();

    await pickClass(classField(), 'cont', /Cont 20'/);
    fireEvent.click(saveClassButton());

    await waitFor(() => expect(setClass).toHaveBeenCalledWith({ shipmentId: 9001, vehicleSizeClassId: 21 }));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText(/Chưa xác định/)).toBeInTheDocument();
  });

  it('a refused save (already grouped) surfaces the server message and re-enables the button', async () => {
    setClass.mockRejectedValue(new Error(
      'Lô BL-1 đã thuộc nhóm ghép cước thu khách — tách khỏi nhóm (Hủy ghép) trước khi chọn loại xe tính cước thu riêng cho lô này',
    ));
    const { onChanged } = renderStrip();

    await pickClass(classField(), '5', /Xe 5 tấn/);
    fireEvent.click(saveClassButton());

    expect(await screen.findByText(/đã thuộc nhóm ghép cước thu khách — tách khỏi nhóm/)).toBeInTheDocument();
    await waitFor(() => expect(saveClassButton()).toHaveTextContent('Lưu cước thu'));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('a lot inside a rev group cannot edit the class: the field is disabled with the tách-nhóm hint', () => {
    renderStrip({ revGroupId: 'g-1', revGroupOrder: 1, revVehicleClassCode: '3.5T' });

    expect(classField()).toBeDisabled();
    expect(screen.getByText(/Lô đã thuộc nhóm ghép cước thu khách — tách nhóm \(Hủy ghép\) trước khi chọn loại xe riêng/))
      .toBeInTheDocument();
    expect(saveClassButton()).toBeDisabled();
  });

  it('SIL-548 QA round 3 — a COST-grouped lot (costGroupId «Ghép») locks the same way, hint names the tách-nhóm step', () => {
    // The shared lock law (revOutputGroupLock) — before, only revGroupId
    // locked here and a «Ghép (2/2)» cost-group lot stayed fully editable.
    renderStrip({ costGroupId: 'g-cost-2', costGroupOrder: 2, revVehicleClassCode: '3.5T' });

    expect(classField()).toBeDisabled();
    expect(priceField()).toBeDisabled();
    expect(screen.getByText(/Lô đã thuộc nhóm gộp xe \(ghép cước trả ĐVVC\) — tách nhóm \(Hủy ghép\) trước khi sửa cước thu khách riêng/))
      .toBeInTheDocument();
    expect(saveClassButton()).toBeDisabled();
  });

  it('leaves the BKS báo khách quick-edit path untouched', async () => {
    updateTruck.mockResolvedValue({ updatedShipmentIds: [9001] });
    // The class picker renders alongside the plates — the BKS path is intact.
    const { onChanged } = renderStrip({ actualTruckNo: '29C-111.11' });
    expect(classField()).toBeInTheDocument();

    const billing = screen.getByRole('combobox', { name: 'BKS báo khách (Ảo)' });
    fireEvent.focusIn(billing);
    fireEvent.click(billing);
    fireEvent.click(await screen.findByRole('option', { name: /29C-111\.11/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS' }));
    await waitFor(() => expect(updateTruck).toHaveBeenCalledWith({ shipmentId: 9001, billingTruckNo: '29C-111.11' }));
    expect(onChanged).toHaveBeenCalled();
    expect(setClass).not.toHaveBeenCalled();
  });

  // ── Spec 23/10 §4.1 field 2 — "Giá cước thu khách" manual override ──
  it('giá nhập tay (§4.1 trường 2): arm/save gửi freightRevenue, thắng giá tra bảng', async () => {
    setClass.mockResolvedValue({
      shipmentId: 9001,
      reference: 'BL-1',
      vehicleSizeClassId: 9,
      vehicleClassCode: '5T',
      freightAuto: '2800000',
      channel: 'TRIP',
      reason: 'Giá cước thu khách nhập tay',
    });
    const { onChanged } = renderStrip({ revVehicleClassCode: '5T' });

    // Class unchanged + no price: nothing to save yet (§4.1 needs one output).
    expect(saveClassButton()).toBeDisabled();

    fireEvent.change(priceField(), { target: { value: '2800000' } });
    expect(saveClassButton()).not.toBeDisabled();
    fireEvent.click(saveClassButton());

    // Price alone rides the wire — the untouched class is not re-sent.
    await waitFor(() => expect(setClass).toHaveBeenCalledWith({ shipmentId: 9001, freightRevenue: 2800000 }));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText(/Đã lưu giá cước thu khách nhập tay/)).toBeInTheDocument();
  });

  it('giá nhập tay + đổi loại xe: cả hai outputs cùng lưu trong một lần', async () => {
    setClass.mockResolvedValue({
      shipmentId: 9001,
      reference: 'BL-1',
      vehicleSizeClassId: 9,
      vehicleClassCode: '5T',
      freightAuto: '2800000',
      channel: 'TRIP',
      reason: null,
    });
    renderStrip({ revVehicleClassCode: '3.5T' });

    await pickClass(classField(), '5', /Xe 5 tấn/);
    fireEvent.change(priceField(), { target: { value: '3000000' } });
    fireEvent.click(saveClassButton());

    await waitFor(() => expect(setClass).toHaveBeenCalledWith({
      shipmentId: 9001,
      vehicleSizeClassId: 9,
      freightRevenue: 3000000,
    }));
  });

  it('lô trong nhóm rev: ô giá cũng khóa theo loại xe (nhóm owns cước thu)', () => {
    renderStrip({ revGroupId: 'g-1', revGroupOrder: 1, revVehicleClassCode: '3.5T' });
    expect(priceField()).toBeDisabled();
  });
});

describe('FB-095 — nút "Hủy ghép" trên khối NHÓM GHÉP', () => {
  const confirmButton = () => screen.getAllByRole('button', { name: 'Hủy ghép' }).at(-1)!;

  it('chiều TRẢ ĐV: xác nhận → unmergeLclLot(COST), toast nêu Bill kế vị nhận 100% và tải lại lưới', async () => {
    unmerge.mockResolvedValue({
      dimension: 'COST',
      groupId: 'g-cost',
      leaver: { shipmentId: 9001, order: 1, reference: 'BL-1' },
      promoted: { shipmentId: 9002, order: 1, reference: 'BL-2' },
      transferredAmount: '2450000',
      remaining: [{ shipmentId: 9002, order: 1, reference: 'BL-2' }],
      dissolved: false,
    });
    const { onChanged } = renderStrip({
      costGroupId: 'g-cost',
      costGroupOrder: 1,
      costGroupMemberCount: 2,
      costGroupPrincipalRef: 'BL-9',
    });

    const trigger = screen.getByRole('button', { name: 'Hủy ghép' });
    fireEvent.click(trigger);
    // The strip's trigger and the dialog's confirm share the label, so the
    // confirm is the last match once the dialog is open.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(unmerge).toHaveBeenCalledWith({ shipmentId: 9001, dimension: 'COST' }));
    expect(await screen.findByText(/Bill BL-2 nhận 100% cước trả ĐV/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('chiều THU khách (per-lot): xác nhận → unmergeLclLot(REV), không chuyển tiền, chỉ bỏ ghi chú nhóm', async () => {
    unmerge.mockResolvedValue({
      dimension: 'REV',
      groupId: 'g-rev',
      leaver: { shipmentId: 9001, order: 2, reference: 'BL-1' },
      promoted: { shipmentId: 9002, order: 1, reference: 'BL-2' },
      // per boss 21/10: REV is per-lot — the crown moves, money does not.
      transferredAmount: null,
      remaining: [{ shipmentId: 9002, order: 1, reference: 'BL-2' }],
      dissolved: false,
    });
    const { onChanged } = renderStrip({
      revGroupId: 'g-rev',
      revGroupOrder: 2,
      revGroupMemberCount: 2,
      revGroupPrincipalRef: 'BL-2',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Hủy ghép' }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(unmerge).toHaveBeenCalledWith({ shipmentId: 9001, dimension: 'REV' }));
    expect(await screen.findByText(/Bill BL-2 thành Lô chính và nhận 100% cước thu nhóm/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('nhóm còn 1 lô: không có Bill kế vị → toast "nhóm giải tán"', async () => {
    unmerge.mockResolvedValue({
      dimension: 'REV',
      groupId: 'g-rev',
      leaver: { shipmentId: 9001, order: 1, reference: 'BL-1' },
      promoted: null,
      transferredAmount: '0',
      remaining: [],
      dissolved: true,
    });
    renderStrip({ revGroupId: 'g-rev', revGroupOrder: 1, revGroupMemberCount: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Hủy ghép' }));
    fireEvent.click(confirmButton());

    expect(await screen.findByText(/Đã hủy ghép — nhóm giải tán/)).toBeInTheDocument();
  });

  it('server từ chối (nhóm đã chốt/khoá kế toán): hiện nguyên văn thông điệp, không tải lại lưới', async () => {
    unmerge.mockRejectedValue(new Error('Nhóm ghép đã chốt kế toán — không thể tách lô'));
    const { onChanged } = renderStrip({ costGroupId: 'g-cost', costGroupOrder: 1, costGroupMemberCount: 2 });

    fireEvent.click(screen.getByRole('button', { name: 'Hủy ghép' }));
    fireEvent.click(confirmButton());

    expect(await screen.findByText(/Nhóm ghép đã chốt kế toán — không thể tách lô/)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    // The trigger comes back from its busy state for a retry.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Hủy ghép' })[0]).toHaveTextContent('Hủy ghép'));
  });

  it('lô KHÔNG thuộc nhóm nào thì không có nút Hủy ghép', () => {
    renderStrip();
    expect(screen.queryByRole('button', { name: 'Hủy ghép' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ─── SIL-482 — form PHÂN XE dọn theo consult spec 24/10 ───

describe('SIL-482 — form PHÂN XE: placeholder Việt hóa + grid 2 cột + hàng action', () => {
  it('ô "Nhà xe - BKS thực" dùng placeholder Việt, không còn "Search" tiếng Anh nào trên form', () => {
    renderStrip({ actualTruckNo: null, billingTruckNo: null });

    const actualInput = screen.getByRole('combobox', { name: 'Nhà xe - BKS thực' }) as HTMLInputElement;
    expect(actualInput.placeholder).toBe('Chọn nhà xe / BKS thực…');
    // The consult spec bans the English default anywhere on this form —
    // the search affordance lives in the dropdown, not the placeholder.
    for (const input of document.querySelectorAll('.debit-lot-lcl-facts input')) {
      expect((input as HTMLInputElement).placeholder).not.toBe('Search');
    }
  });

  it('hai ô BKS nằm trong grid 2 cột; nút Lưu BKS ở hàng action RIÊNG bên dưới grid', () => {
    renderStrip({ actualTruckNo: '15C-167.31', billingTruckNo: '88Q-10657' });

    const grid = document.querySelector('.debit-lot-lcl-facts__truck-grid');
    expect(grid).not.toBeNull();
    // Both plate fields inside the grid…
    const gridInputs = grid!.querySelectorAll('input');
    expect(gridInputs.length).toBe(2);
    expect(grid!.textContent).toContain('Nhà xe - BKS thực');
    expect(grid!.textContent).toContain('BKS báo khách (Ảo)');
    // …and the save action OUTSIDE it (the old inline-right placement rode
    // the helper line and overflowed narrow widths).
    const save = screen.getByRole('button', { name: 'Lưu BKS' });
    expect(grid!.contains(save)).toBe(false);
    expect(save.closest('.debit-lot-lcl-facts__actions')).not.toBeNull();
  });

  it('Lưu BKS là nút primary cỡ 40px theo spec', () => {
    renderStrip({ actualTruckNo: '15C-167.31' });
    const save = screen.getByRole('button', { name: 'Lưu BKS' });
    expect(save.className).toContain('min-h-10'); // UUIButton md = 40px
    expect(save.className).toContain('bg-brand-solid'); // house primary paint
  });
});

// ─── FB-141 (card 231026163927, QA R39) — BKS báo khách để trống là hợp lệ ───

describe('FB-141 — BKS báo khách: clear về trống gửi null, không còn 400', () => {
  it('xóa trắng ô đã lưu rồi Lưu BKS ⇒ gửi billingTruckNo: null (fallback BKS thực), toast thành công', async () => {
    updateTruck.mockResolvedValue({ updatedShipmentIds: [9001] });
    const { onChanged } = renderStrip({
      actualTruckNo: '15C-167.31',
      billingTruckNo: '29H-77777',
    });

    // Ghost placeholder = chính BKS thực khi có (design direction 24/10).
    const billing = screen.getByRole('combobox', { name: 'BKS báo khách (Ảo)' }) as HTMLInputElement;
    expect(billing.placeholder).toBe('15C-167.31');
    expect(screen.getByText('Mặc định dùng BKS thực tế nếu để trống')).toBeInTheDocument();

    // The stored ảo value shows; the operator clears it…
    expect(billing).toHaveValue('29H-77777');
    fireEvent.focusIn(billing);
    fireEvent.change(billing, { target: { value: '' } });
    fireEvent.blur(billing);

    fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS' }));
    // …and the clear rides as null — the OLD wire sent '' and 400'd
    // "BKS không được để trống".
    await waitFor(() => expect(updateTruck).toHaveBeenCalledWith({ shipmentId: 9001, billingTruckNo: null }));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText(/Đã cập nhật BKS/)).toBeInTheDocument();
    expect(screen.queryByText(/BKS không được để trống/)).toBeNull();
  });

  it('chưa có BKS thực: placeholder fallback text hướng dẫn dùng BKS thực', () => {
    renderStrip({ actualTruckNo: null, billingTruckNo: null });
    const billing = screen.getByRole('combobox', { name: 'BKS báo khách (Ảo)' }) as HTMLInputElement;
    expect(billing.placeholder).toBe('Trống = tự động dùng BKS thực');
  });
});
