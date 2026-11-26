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
      if (path.split('?')[0] === '/ports') {
        return { items: [], total: 0, page: 1, pageSize: 50 };
      }
      // K4.61 (SIL-1046): the pre-save usage read defaults to an unreferenced
      // port; the dedicated test below overrides per-path.
      if (/^\/ports\/\d+\/usage$/.test(path)) {
        return { port: { id: Number(path.match(/\d+/)?.[0]), name: '' }, containerCount: 0, tripCount: 0, activeTrips: 0, truncated: false, trips: [] };
      }
      if (path === '/dispatch-zones/active') {
        return {
          items: [
            { code: 'LACH_HUYEN', label: 'Lạch Huyện', sortOrder: 10 },
            { code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 20 },
          ],
        };
      }
      if (path.split('?')[0] === '/dispatch-zones') {
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

    fireEvent.change(screen.getByPlaceholderText('Ví dụ: ZONE_A'), { target: { value: 'hai_duong' } });
    fireEvent.change(screen.getByPlaceholderText('Tên khu vực điều phối'), { target: { value: 'Hải Dương' } });
    const orderInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(orderInput, { target: { value: '40' } });

    expect(screen.getByRole('checkbox', { name: 'Hiện bộ lọc cảng ở kế hoạch tổng quát' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hiện bộ lọc cảng ở kế hoạch tổng quát' }));

    // FormActions' create button is labelled "Thêm"; submit the zone form's.
    const submitButtons = screen.getAllByRole('button', { name: /^thêm$/i });
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => {
      const call = apiPostMock.mock.calls.find(([path]) => path === '/dispatch-zones');
      expect(call).toBeTruthy();
      expect(call?.[1]).toMatchObject({ code: 'HAI_DUONG', label: 'Hải Dương', sortOrder: 40, isActive: true, showPortFacet: false });
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

  // K4.61 (SIL-1046): the edit form pairs every field with its stored value
  // (tinted the moment the input drifts) and names the blast radius — the
  // trips/containers referencing the port — BEFORE the operator saves.
  it('shows the stored value beside each edit field and the referencing work before saving', async () => {
    apiGetMock.mockImplementation(async (path: string) => {
      if (path.split('?')[0] === '/ports') {
        return {
          items: [{
            id: 5, code: 'VNTV', name: 'Cảng Tân Vũ', shortName: 'Tân Vũ',
            address: 'Bạch Đằng, Hải Phòng', dispatchZone: 'HAI_PHONG',
          }],
          total: 1, page: 1, pageSize: 50,
        };
      }
      if (path === '/ports/5/usage') {
        return {
          port: { id: 5, name: 'Cảng Tân Vũ' },
          containerCount: 7,
          tripCount: 8,
          activeTrips: 2,
          truncated: false,
          trips: [
            { id: 1, tripCode: 'TRP-202611-0001', status: 'CREATED', driverId: null, driverName: null },
            { id: 2, tripCode: 'TRP-202611-0002', status: 'IN_TRANSIT', driverId: 9, driverName: 'Lê Văn Tỉnh' },
          ],
        };
      }
      if (path === '/dispatch-zones/active') {
        return { items: [{ code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 20 }] };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    renderPage();

    const edit = await screen.findByRole('button', { name: 'Chỉnh sửa cảng / bãi thứ 1' });
    fireEvent.click(edit);

    // Old–new pair: the stored value reads under each field.
    expect(await screen.findByText('Hiện tại: Cảng Tân Vũ')).toBeTruthy();
    expect(screen.getByText('Hiện tại: VNTV')).toBeTruthy();
    expect(screen.getByText('Hiện tại: Bạch Đằng, Hải Phòng')).toBeTruthy();
    expect(screen.getByText('Hiện tại: Tân Vũ')).toBeTruthy();

    // Drift marks the caption without hiding the stored value.
    const nameInput = screen.getByDisplayValue('Cảng Tân Vũ') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Cảng Tân Vũ - Bến 5' } });
    expect(screen.getByText('Hiện tại: Cảng Tân Vũ (đã đổi)')).toBeTruthy();

    // The blast radius strip: counts + first trip codes, before saving.
    expect(screen.getByText(/Đang tham chiếu:/)).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.getByText(/TRP-202611-0001/)).toBeTruthy();
    expect(screen.getByText(/TRP-202611-0002/)).toBeTruthy();
  });

  // SIL-1046: the old–new caption is an EDIT affordance — a row that does
  // not exist yet has no stored value, so CREATE must render neither
  // 'Hiện tại: —' nor the '(đã đổi)' drift mark.
  it('renders no stored-value caption in CREATE mode', async () => {
    renderPage();
    await screen.findByText('NINH_BINH');

    const addButtons = screen.getAllByRole('button', { name: /thêm mới/i });
    fireEvent.click(addButtons[0]);

    const nameInput = await screen.findByPlaceholderText('Ví dụ: Cảng Lạch Huyện');
    expect(screen.queryByText(/^Hiện tại:/)).toBeNull();
    // Typing must not fabricate a '(đã đổi)' drift mark against a phantom
    // stored value either.
    fireEvent.change(nameInput, { target: { value: 'Cảng mới' } });
    expect(screen.queryByText(/Hiện tại:/)).toBeNull();
    expect(screen.queryByText(/\(đã đổi\)/)).toBeNull();
  });

  // SIL-1046: past the BE's 200-trip cap the count is a floor — the strip
  // must say '≥200', never a bare 200 pretending to be complete.
  it('renders the ≥ cap marker when the usage list was truncated', async () => {
    apiGetMock.mockImplementation(async (path: string) => {
      if (path.split('?')[0] === '/ports') {
        return {
          items: [{
            id: 5, code: 'VNTV', name: 'Cảng Tân Vũ', shortName: 'Tân Vũ',
            address: 'Bạch Đằng, Hải Phòng', dispatchZone: 'HAI_PHONG',
          }],
          total: 1, page: 1, pageSize: 50,
        };
      }
      if (path === '/ports/5/usage') {
        return {
          port: { id: 5, name: 'Cảng Tân Vũ' },
          containerCount: 240,
          tripCount: 200,
          activeTrips: 12,
          truncated: true,
          trips: [{ id: 1, tripCode: 'TRP-202611-0001', status: 'CREATED', driverId: null, driverName: null }],
        };
      }
      if (path === '/dispatch-zones/active') {
        return { items: [{ code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 20 }] };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    renderPage();

    const edit = await screen.findByRole('button', { name: 'Chỉnh sửa cảng / bãi thứ 1' });
    fireEvent.click(edit);

    expect(await screen.findByText(/Đang tham chiếu:/)).toBeTruthy();
    expect(screen.getByText('≥200')).toBeTruthy();
    expect(screen.queryByText(/^200$/)).toBeNull();
  });
});
