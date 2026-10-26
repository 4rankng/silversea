import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, quickCreateShipment, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  quickCreateShipment: vi.fn(),
  listOperationalSites: vi.fn(),
  listSharedWarehouseSites: vi.fn(),
}));
vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof ShipmentClientModule>(),
  quickCreateShipment,
  listOperationalSites,
  listSharedWarehouseSites,
}));

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

/** SIL-502 (QA fail 26/10, build 52ee6443): tạo lô qua FORM với Số tờ khai →
 *  lưu xong API không có declarationNumber (declarations [], container null).
 *  Root cause: ô nhập chip Số tờ khai chỉ commit qua Enter/dấu phẩy/dán có
 *  dấu phân cách — gõ số rồi bấm thẳng nút lưu (không Enter) để draft chưa
 *  commit nằm lại state cục bộ và payload create rời đi KHÔNG có số. Pin: mọi
 *  cách rời ô (blur — kể cả blur do click nút lưu) phải commit draft qua cùng
 *  luật commitDeclarations; số đã commit không bao giờ nhân đôi. */
function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/shipments', '/shipments/new']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <Routes>
            <Route path="/shipments" element={<div data-testid="shipment-list" />} />
            <Route path="/shipments/new" element={<ShipmentCreateWorkspace />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function enterFclWithCustomerAndDeclaration(declaration: string, commit: 'enter' | 'blur-only') {
  renderWorkspace();
  await screen.findByRole('button', { name: 'Tạo lô hàng' });
  fireEvent.click(screen.getByRole('combobox', { name: /^Khách hàng/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
  await waitFor(() => expect(screen.getByRole('radio', { name: /Hàng FCL/ })).toBeChecked());

  const declInput = screen.getByRole('textbox', { name: 'Số tờ khai' });
  fireEvent.change(declInput, { target: { value: declaration } });
  if (commit === 'enter') fireEvent.keyDown(declInput, { key: 'Enter' });
  // Real-browser save click: mousedown blurs the input BEFORE the button's
  // click handler runs — the blur commit must land in form state first.
  fireEvent.blur(declInput);

  quickCreateShipment.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
  await waitFor(() => expect(quickCreateShipment).toHaveBeenCalledTimes(1));
  return quickCreateShipment.mock.calls[0][0];
}

describe('SIL-502 — form Số tờ khai không bao giờ rơi khi lưu', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    quickCreateShipment.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([]);
    quickCreateShipment.mockResolvedValue({ id: 501, version: 1, initialDeclarationId: null });
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('QA repro: gõ số tờ khai KHÔNG Enter rồi bấm Lưu nháp → payload mang số', async () => {
    const payload = await enterFclWithCustomerAndDeclaration('QA26A502TK01', 'blur-only');
    expect(payload).toMatchObject({ declarationNumber: 'QA26A502TK01' });
    cleanup();
  });

  it('commit bằng Enter vẫn đúng và blur sau đó không nhân đôi chip', async () => {
    const payload = await enterFclWithCustomerAndDeclaration('QA26A502TK02', 'enter');
    expect(payload).toMatchObject({ declarationNumber: 'QA26A502TK02' });
    // The chip strip shows the number exactly once — the blur after commit
    // had an empty draft and must not re-add it.
    expect(screen.getAllByText('QA26A502TK02').length).toBe(1);
    cleanup();
  });

  it('gõ lại đúng số đã commit rồi blur → dedupe, vẫn đúng 1 chip', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('combobox', { name: /^Khách hàng/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Hàng FCL/ })).toBeChecked());

    const declInput = screen.getByRole('textbox', { name: 'Số tờ khai' });
    fireEvent.change(declInput, { target: { value: 'QA26A502TK03' } });
    fireEvent.keyDown(declInput, { key: 'Enter' });
    fireEvent.change(declInput, { target: { value: 'QA26A502TK03' } });
    fireEvent.blur(declInput);
    expect(screen.getAllByText('QA26A502TK03').length).toBe(1);
    cleanup();
  });

  it('blur với draft trống không tạo chip rỗng', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('combobox', { name: /^Khách hàng/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Hàng FCL/ })).toBeChecked());

    const declInput = screen.getByRole('textbox', { name: 'Số tờ khai' });
    fireEvent.blur(declInput);
    // Count badge stays at zero chips.
    expect(document.querySelector('.csc-declaration-strip__count')!.textContent).toBe('0');
    cleanup();
  });
});
