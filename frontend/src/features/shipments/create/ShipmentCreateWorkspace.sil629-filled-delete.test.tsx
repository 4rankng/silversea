import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn(), listSharedWarehouseSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
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

/**
 * SIL-629 (id 733, owner 31/10) — deleting a container row must work on the
 * FILLED form, not only the empty one. The QA probe proved the empty form
 * deletes fine (2 → 1); the owner's report is the filled state of the
 * screenshot: row 1 complete (EGHU3768799 + loại + nhà máy + tuyến + cảng +
 * giờ đóng/trả), a later row incomplete. The measured mechanism (SIL-628,
 * qa/2026-10-31_sil619-629/before): the factory detail ⓘ overlay resolved
 * against the section card and intercepted the delete click — elementFromPoint
 * at the button's center returned the overlay, so no confirm ever opened and
 * the row count never moved. The fix retires the magnifier and pins every
 * cell as its own containing block; this regression pins the filled-state
 * click-through: confirm opens, the row goes away.
 */
describe('SIL-629 filled-form container delete', { timeout: 30000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([]);
    listOperationalSites.mockResolvedValue([
      { id: 31, siteType: 'FACTORY', name: 'CÔNG TY ASKEY 1', shortName: 'ASKEY-XƯỞNG 1' },
    ]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Cát Lái — Sóng Thần' }],
      ports: [{ id: 3, name: 'Cảng Cát Lái' }],
      containerTypes: [{ id: 5, code: '40HC', name: '40HC High Cube' }],
    });
  });

  async function fillRow1LikeTheScreenshot() {
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // Identity — the screenshot form was mid-intake with customer chosen.
    fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
    fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
    const sitesReady = await waitFor(() => {
      const factory = screen.getByRole('combobox', { name: /^Nhà máy/ }) as HTMLInputElement;
      expect(factory).not.toBeDisabled();
      return factory;
    });

    // Row 1: Số container.
    fireEvent.change(screen.getByLabelText('Số container'), { target: { value: 'EGHU3768799' } });

    // Row 1: Loại container (the LOẠI ghost line's floating editor combobox
    // is always mounted; ArrowDown opens its menu — the house choose() law).
    const typeInput = screen.getByRole('combobox', { name: 'Loại container' });
    fireEvent.focus(typeInput);
    fireEvent.keyDown(typeInput, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /40HC/ }));

    // Row 1: Nhà máy (a chosen factory is what used to render the ⓘ overlay).
    sitesReady.focus();
    fireEvent.click(sitesReady);
    fireEvent.click(await screen.findByRole('option', { name: /ASKEY-XƯỞNG 1/ }));

    // Row 1: Tuyến + cảng nâng/hạ.
    const route = screen.getByRole('combobox', { name: /^Tuyến đường/ }) as HTMLInputElement;
    route.focus();
    fireEvent.click(route);
    fireEvent.click(await screen.findByRole('option', { name: 'Cát Lái — Sóng Thần' }));
    for (const label of ['Cảng nâng', 'Cảng hạ'] as const) {
      const port = screen.getByRole('combobox', { name: new RegExp(`^${label}`) }) as HTMLInputElement;
      port.focus();
      fireEvent.click(port);
      fireEvent.click(await screen.findByRole('option', { name: 'Cảng Cát Lái' }));
    }

    // Row 1: Ngày giờ đóng trả.
    fireEvent.change(document.querySelector<HTMLInputElement>('input[id$="-customer-appointment-date"]')!, { target: { value: '31/10/2026' } });
    fireEvent.change(document.querySelector<HTMLInputElement>('input[id$="-customer-appointment-time"]')!, { target: { value: '09:30' } });
  }

  it('the filled row 1 + incomplete row 2 state: no ⓘ overlay, delete asks, confirm removes the row', async () => {
    renderWorkspace();
    await fillRow1LikeTheScreenshot();

    // Row 2 rides incomplete, like the screenshot's following rows.
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    await waitFor(() => expect(document.querySelectorAll('.csc-container-row')).toHaveLength(2));

    // SIL-628: no actions overlay exists anywhere in the table — nothing can
    // intercept the delete click (the live hit-test proof lives in the rung-3
    // driver, qa/scripts/2026-10-31-sil619-629-ui-drive.mjs).
    expect(document.querySelector('.csc-container-cell__actions')).toBeNull();
    const del1 = screen.getByRole('button', { name: 'Xóa container 1' });
    expect(del1).toBeVisible();

    // The filled row asks before dying…
    fireEvent.click(del1);
    const confirmDialog = await screen.findByText('Xóa container?');
    expect(confirmDialog).toBeTruthy();

    // …and the confirm actually removes it (the reported no-op).
    fireEvent.click(screen.getByRole('button', { name: 'Xóa container' }));
    await waitFor(() => expect(document.querySelectorAll('.csc-container-row')).toHaveLength(1));
    // The survivor is the incomplete row 2 (empty Số container), the confirm
    // dialog is gone, and with one row left the delete affordance retires
    // (containersLength > 1 gate) — the sheet is back to its seed shape.
    await waitFor(() => expect(screen.queryByText('Xóa container?')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Số container')).toHaveValue('');
  });

  it('an EMPTY row still deletes directly (the QA probe state stays green)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    await waitFor(() => expect(document.querySelectorAll('.csc-container-row')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Xóa container 2' }));
    expect(screen.queryByText('Xóa container?')).not.toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll('.csc-container-row')).toHaveLength(1));
  });
});
