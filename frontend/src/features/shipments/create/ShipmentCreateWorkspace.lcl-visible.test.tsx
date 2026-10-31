// Cards 211026130115 / 211026130215 / 211026130315 / 211026130415 —
// verify-fail "code CÓ nhưng ẨN sau default": every LCL feature must be HIỆN
// THEO MẶC ĐỊNH on the form QA opens (default Nhập/FCL), no trick gates:
//  - LCL-03 (30215): the Hàng lẻ segmented control LEADS the form; the Ghi chú
//    band (SIL-611's last section) rụng ngay khi chọn Hàng lẻ.
//  - LCL-04 (30315): "Ngày giao hàng" mở sẵn trong top band — không nút "+",
//    không reveal step, không "Ngày giao bổ sung" repeater.
//  - LCL-02 (30115): "Thêm kho" hiện + dialog quick-add mở TRƯỚC khi chọn KH
//    (dialog tự render customer picker); title theo hướng hàng.
//  - LCL-05 (30415): quy cách placeholder hint + dropdown gợi ý sẵn khi trống.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ShipmentClientModule from '../../../api/shipmentClient';

const { getBootstrap, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn(), listSharedWarehouseSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof ShipmentClientModule>(),
  listOperationalSites,
  listSharedWarehouseSites,
}));

import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/shipments/new']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentCreateWorkspace />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('LCL form visible-by-default (cards 211026130115/30215/30315/30415)', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('LCL-03: the Hàng lẻ segmented control leads the form and the Ghi chú band rụng ngay on switch', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    const form = document.querySelector('.csc-form')!;
    const modeBand = document.querySelector('#shipment-section-mode') as HTMLElement;
    expect(modeBand).toBeTruthy();
    // The mode band is the FIRST block of the form — before Nhận diện lô — so
    // QA mở form mặc định thấy lựa chọn Hàng lẻ ngay, không cần biết trick.
    expect(form.firstElementChild).toBe(modeBand);
    expect(modeBand.compareDocumentPosition(document.querySelector('#shipment-section-identity')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Segmented control with BOTH options, in the band.
    expect(within(modeBand).getByRole('radio', { name: /Hàng lẻ/ })).toBeTruthy();
    expect(within(modeBand).getByRole('radio', { name: /Hàng FCL/ })).toBeTruthy();

    // SIL-611 (id 714, owner 30/10): the FCL default ends with the Ghi chú
    // band BELOW Thông tin hàng — Nhận diện lô (gọn) → Thông tin hàng →
    // Ghi chú. One click on Hàng lẻ drops it (SIL-587: no notes on hàng lẻ).
    const notes = document.querySelector('#shipment-section-notes') as HTMLElement;
    expect(notes).toBeTruthy();
    expect(document.querySelector('#shipment-section-cargo')!.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('#shipment-section-schedule')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
    await waitFor(() => expect(document.querySelector('#shipment-section-notes')).toBeNull());
    expect(screen.queryByText('Ghi chú cho khách hàng')).toBeNull();
    expect(screen.queryByText('Ghi chú cho lái xe')).toBeNull();
  });

  it('LCL-04: Ngày giờ đóng trả mở sẵn in the top band — no "+" reveal, no repeater', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));

    // SIL-587 (id 687): the single LCL schedule field is the datetime
    // "Ngày giờ đóng trả" (id shipment-lcl-closing-at) — time + date
    // segments, always visible in the top band.
    const field = await waitFor(() => {
      const el = document.querySelector('[data-field-id="shipment-lcl-closing-at"]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(document.querySelector('#shipment-section-mode')!.contains(field)).toBe(true);
    // SIL-637 (id 741, owner 31/10): the visible label is retired — the
    // field's name lives on the group aria-label (screen readers keep it);
    // the segments below prove the field itself still renders in the band.
    expect(field.querySelector('[data-split-datetime]')?.getAttribute('aria-label')).toBe('Ngày giờ đóng trả');
    expect(field.textContent).not.toContain('Ngày giờ đóng trả');
    // Ngày + giờ: the split host renders both segment groups.
    expect(field.querySelectorAll('[data-split-datetime] input[data-seg="hh"], [data-split-datetime] input[data-seg="dd"]').length).toBeGreaterThanOrEqual(2);
    // 181026200700 "exactly ONE": no duplicated schedule field, whatever the
    // label flattens to.
    expect(document.querySelectorAll('[data-field-id="shipment-lcl-closing-at"]')).toHaveLength(1);
    expect(document.getElementById('shipment-expected-delivery')).toBeNull();
    // The 0f7e1dfa reveal button and the extra-date repeater never come back.
    expect(screen.queryByRole('button', { name: 'Thêm ngày giao hàng' })).toBeNull();
    expect(screen.queryByLabelText('Ngày giao bổ sung')).toBeNull();
  });

  it('LCL-02: kho quick-add opens BEFORE a customer is chosen, title by hướng hàng', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));

    // No customer chosen yet — the affordance is visible and works (the dialog
    // collects the customer itself in picker mode).
    const addKho = await screen.findByRole('button', { name: 'Thêm kho' });
    fireEvent.click(addKho);
    const dialog = await screen.findByRole('dialog', { name: 'Thêm kho lấy hàng' });
    expect(within(dialog).getByLabelText('Khách hàng')).toBeTruthy();
    // Quick-add body stays the simple three fields (not the master-data form).
    expect(within(dialog).getByLabelText('Tên đầy đủ')).toBeTruthy();
    expect(within(dialog).getByLabelText('Tên ngắn')).toBeTruthy();
    expect(within(dialog).getByLabelText('Địa chỉ')).toBeTruthy();
    expect(within(dialog).queryByLabelText('Google Maps')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Title follows the direction: Xuất → "trả hàng" (the ONLY direction where
    // "kho trả hàng" is hợp lệ). The direction control is the UUI select —
    // click + option pick, the house interaction contract.
    fireEvent.click(document.getElementById('shipment-trade-direction')!);
    fireEvent.click(await screen.findByRole('option', { name: 'Xuất khẩu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm kho' }));
    expect(await screen.findByRole('dialog', { name: 'Thêm kho trả hàng' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Nhập → "lấy hàng".
    fireEvent.click(document.getElementById('shipment-trade-direction')!);
    fireEvent.click(await screen.findByRole('option', { name: 'Nhập khẩu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm kho' }));
    expect(await screen.findByRole('dialog', { name: 'Thêm kho lấy hàng' })).toBeTruthy();
  });

  it('LCL-05: quy cách placeholder hint + dropdown mở có gợi ý sẵn từ đầu', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));

    const packageType = await screen.findByRole('combobox', { name: 'Quy cách đóng gói' });
    expect((packageType as HTMLInputElement).placeholder).toBe('Gợi ý quy cách (chọn hoặc gõ)');

    // Menu opens with the curated suggestions the moment the field is on —
    // bare focus, no typing, no arrow-key trick. Real `focus()` (activeElement
    // + focus events) is the react-aria onFocus channel; the browser probe
    // proves the bare-click open on the live form.
    (packageType as HTMLElement).focus();
    await waitFor(() => expect(packageType.getAttribute('aria-expanded')).toBe('true'));
    for (const suggestion of ['Thùng gỗ', 'Pallet', 'Roll', 'Carton', 'Box']) {
      const option = await screen.findByRole('option', { name: suggestion }, { timeout: 3000 });
      expect(option).toBeTruthy();
    }
  });
});
