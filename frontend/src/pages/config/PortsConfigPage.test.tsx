import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/shared/Toast';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import PortsConfigPage from './PortsConfigPage';
import * as configClientModule from '../../api/configClient';

// The zone taxonomy block is admin-only server-side; the page hides it for
// other roles, so every test runs as ADMIN.
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 1, role: 'ADMIN' } }),
}));

// PortsConfigPage renders two catalogs: ports + the admin-managed zone
// taxonomy. The zone block must ride the same CrudTable surface (factory
// list, no delete) and keep the port form's zone-select fed from the
// active-only taxonomy read.

vi.mock('../../api/configClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/configClient')>();
  return {
    ...actual,
    configClient: {
      ...actual.configClient,
      getDispatchZones: vi.fn(),
    },
  };
});

const getDispatchZonesMock = vi.mocked(configClientModule.configClient.getDispatchZones);

// CrudTable fetches its list through the shared api helper; stub the module
// boundary it actually uses.
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  };
});

import { api } from '../../lib/api';

const apiGetMock = vi.mocked(api.get);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <PortsConfigPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PortsConfigPage zone taxonomy block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDispatchZonesMock.mockResolvedValue({
      items: [
        { code: 'LACH_HUYEN', label: 'Lạch Huyện', sortOrder: 10 },
        { code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 20 },
      ],
    });
    apiGetMock.mockImplementation(async (path: string) => {
      if (path === '/ports') {
        return { items: [], total: 0, page: 1, pageSize: 50 };
      }
      if (path === '/dispatch-zones/active') {
        return {
          items: [
            { code: 'LACH_HUYEN', label: 'Lạch Huyện', sortOrder: 10 },
            { code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 20 },
          ],
        };
      }
      if (path === '/dispatch-zones') {
        return {
          items: [
            { id: 1, code: 'LACH_HUYEN', label: 'Lạch Huyện', sortOrder: 10, isActive: true },
            { id: 2, code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 20, isActive: true },
            { id: 3, code: 'NINH_BINH', label: 'Ninh Bình', sortOrder: 30, isActive: false },
          ],
          total: 3, page: 1, pageSize: 50,
        };
      }
      throw new Error(`unexpected GET ${path}`);
    });
  });

  it('renders the ports catalog and the zone taxonomy block with status badges', async () => {
    renderPage();

    expect(screen.getAllByText('Cảng / Bãi').length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Khu vực điều phối')).length).toBeGreaterThan(0);

    // Factory list includes inactive rows — the management surface shows all.
    expect(screen.getByText('LACH_HUYEN')).toBeTruthy();
    expect(screen.getByText('Cảng Hải Phòng')).toBeTruthy();
    expect(screen.getByText('NINH_BINH')).toBeTruthy();
    expect(screen.getAllByText('Đang dùng').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Đã ngưng').length).toBeGreaterThan(0);
  });

  it('creates a zone through the inline form with code + label + order', async () => {
    const apiPostMock = vi.mocked(api.post);
    apiPostMock.mockResolvedValue({ id: 9 } as never);
    renderPage();

    // Open the zone block's add form (second "Thêm mới" button on the page).
    const addButtons = screen.getAllByRole('button', { name: /thêm mới/i });
    fireEvent.click(addButtons[addButtons.length - 1]);

    fireEvent.change(screen.getByPlaceholderText('LACH_HUYEN'), { target: { value: 'hai_duong' } });
    fireEvent.change(screen.getByPlaceholderText('Lạch Huyện'), { target: { value: 'Hải Dương' } });
    const orderInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(orderInput, { target: { value: '40' } });

    // FormActions' create button is labelled "Thêm"; submit the zone form's.
    const submitButtons = screen.getAllByRole('button', { name: /^thêm$/i });
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => {
      const call = apiPostMock.mock.calls.find(([path]) => path === '/dispatch-zones');
      expect(call).toBeTruthy();
      expect(call?.[1]).toMatchObject({ code: 'HAI_DUONG', label: 'Hải Dương', sortOrder: 40, isActive: true });
    });
  });

  it('keeps the port form zone-select fed from the active-only taxonomy', async () => {
    renderPage();
    await screen.findByText('NINH_BINH');

    // Open the ports add form (first block).
    const addButtons = screen.getAllByRole('button', { name: /thêm mới/i });
    fireEvent.click(addButtons[0]);

    const zoneSelects = Array.from(document.querySelectorAll('select'));
    const zoneSelect = zoneSelects.find((el) =>
      Array.from(el.options).some((o) => o.textContent === 'Lạch Huyện')) as HTMLSelectElement;
    expect(zoneSelect).toBeTruthy();
    const options = Array.from(zoneSelect.options).map((o) => (o.textContent ?? '').trim()).filter(Boolean);
    expect(options).toContain('Lạch Huyện');
    expect(options).toContain('Cảng Hải Phòng');
    // Inactive zones must NOT classify new ports.
    expect(options).not.toContain('Ninh Bình');
  });
});
