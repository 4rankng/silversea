import { fireEvent, render, screen, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  listOperationalSites,
}));

import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

const FACTORY_ADDRESS = 'Khu Công Nghiệp Đồng Văn, Lô 8, Phường Đông Văn, Tỉnh Ninh Bình, Việt Nam';

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

async function openMenu(input: HTMLElement) {
  await act(async () => {
    input.focus();
    fireEvent.focusIn(input);
    fireEvent.click(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// Card 20260923_2: the container-row factory cell shows ONLY the short name.
// The customer address must never render inside the row cell (it made the row
// unnaturally tall — operator screenshot 2026-09-23). The address stays
// searchable (card 20260917_13 semantics) but is display-only in the picker.
describe('shipment create factory cell (card 20260923_2)', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
    listOperationalSites.mockReset();
    listOperationalSites.mockResolvedValue([
      {
        id: 9,
        siteType: 'FACTORY',
        code: 'NEWEB-3',
        shortName: 'NEWEB-3',
        name: 'CÔNG TY TNHH NEWEB VIỆT NAM 3',
        address: FACTORY_ADDRESS,
      },
    ]);
  });

  it('row factory cell shows the short name and never the address', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    const customerWrap = document.querySelector('[data-field="shipment-customer"]')!;
    const customerInput = within(customerWrap as HTMLElement).getByRole('combobox');
    await openMenu(customerInput);
    fireEvent.click(await screen.findByRole('option', { name: /KH A/ }));

    const row = document.querySelector('.csc-container-row')!;
    const factoryInput = within(row as HTMLElement).getByRole('combobox', { name: /^Nhà máy/ });
    await openMenu(factoryInput);
    fireEvent.click(await screen.findByRole('option', { name: /NEWEB-3/ }));

    await screen.findByDisplayValue('NEWEB-3');
    const cellWrap = row.querySelector('[data-field-id$="-factory"]') ?? row;
    expect(cellWrap.textContent).toContain('NEWEB-3');
    // The address is searchable upstream but must NOT render in the row cell.
    expect(screen.queryByText(FACTORY_ADDRESS)).toBeNull();
    expect((cellWrap as HTMLElement).textContent).not.toContain('Đồng Văn');
  });
});
