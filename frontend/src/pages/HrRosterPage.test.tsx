import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUsersMock = vi.hoisted(() => vi.fn());

vi.mock('../api/userClient', () => ({
  userClient: {
    getUsers: getUsersMock,
  },
}));

import HrRosterPage from './HrRosterPage';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HrRosterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BUSINESS_UNITS = [
  { id: 1, code: 'SG', name: 'Bộ phận kinh doanh', status: 'ACTIVE', createdAt: '', updatedAt: '' },
  { id: 2, code: 'HN', name: 'Bộ phận điều hành', status: 'ACTIVE', createdAt: '', updatedAt: '' },
];

function userRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    username: 'nv01',
    fullName: 'Trần Văn Bình',
    employeeCode: 'NV001',
    email: 'binh@example.com',
    phone: '0901',
    role: 'OPS',
    status: 'ACTIVE',
    createdAt: '',
    driverId: null,
    assignedTruckId: null,
    baseSalary: null,
    socialInsurance: null,
    businessUnitIds: [1],
    ...overrides,
  };
}

describe('HrRosterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUsersMock.mockResolvedValue({
      items: [
        userRow({ id: 1 }),
        userRow({ id: 2, role: 'DRIVER', fullName: 'Lái xe A', employeeCode: 'TX001', email: 'laixe@example.com', phone: '0902', businessUnitIds: [2] }),
        userRow({ id: 3, role: 'CUSTOMER', fullName: 'KH portal', employeeCode: null, businessUnitIds: [] }),
      ],
      total: 3,
      businessUnits: BUSINESS_UNITS,
    });
  });

  it('lists personnel profiles and excludes external customer accounts', async () => {
    renderPage();
    expect(await screen.findByText('Trần Văn Bình')).toBeInTheDocument();
    expect(screen.getByText('Lái xe A')).toBeInTheDocument();
    expect(screen.queryByText('KH portal')).not.toBeInTheDocument();
    expect(screen.getByText('NV001')).toBeInTheDocument();
    expect(screen.getByText('binh@example.com')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Bộ phận kinh doanh' })).toBeInTheDocument();
  });

  it('narrows the list by search term and by business-unit filter', async () => {
    renderPage();
    await screen.findByText('Trần Văn Bình');

    fireEvent.change(screen.getByLabelText('Tìm trong danh sách nhân sự'), {
      target: { value: 'TX001' },
    });
    expect(screen.getByText('Lái xe A')).toBeInTheDocument();
    expect(screen.queryByText('Trần Văn Bình')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Tìm trong danh sách nhân sự'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Lọc theo bộ phận/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Bộ phận điều hành' }));
    expect(await screen.findByText('Lái xe A')).toBeInTheDocument();
    expect(screen.queryByText('Trần Văn Bình')).not.toBeInTheDocument();
  });

  it('shows the roster empty state when no personnel matches the filters', async () => {
    renderPage();
    await screen.findByText('Trần Văn Bình');

    fireEvent.change(screen.getByLabelText('Tìm trong danh sách nhân sự'), {
      target: { value: 'zzz-khong-co' },
    });
    expect(await screen.findByText('Không tìm thấy nhân sự')).toBeInTheDocument();
  });
});
