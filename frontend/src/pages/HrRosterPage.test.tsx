import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getHrRosterMock = vi.hoisted(() => vi.fn());

vi.mock('../api/userClient', () => ({
  userClient: {
    getHrRoster: getHrRosterMock,
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
  { id: 2, code: 'DR', name: 'Đội xe', status: 'ACTIVE', createdAt: '', updatedAt: '' },
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
    getHrRosterMock.mockResolvedValue({
      items: [
        userRow({ id: 2, role: 'DRIVER', fullName: 'Lái xe A', employeeCode: 'TX001', email: 'laixe@example.com', phone: '0902', businessUnitIds: [2] }),
        userRow({ id: 4, role: 'DRIVER', fullName: 'Lái xe B', employeeCode: 'TX002', email: 'laixeb@example.com', phone: '0903', businessUnitIds: [2] }),
        userRow({ id: 1 }),
        userRow({ id: 5, role: 'ACCOUNTANT', fullName: 'Kế toán C', employeeCode: 'NV002', email: 'kt@example.com', phone: '0904', businessUnitIds: [1] }),
        userRow({ id: 6, role: 'DISPATCHER', fullName: 'Điều vận D', employeeCode: 'NV003', email: 'dv@example.com', phone: '0905', businessUnitIds: [1] }),
        userRow({ id: 7, role: 'ADMIN', fullName: 'Quản trị E', employeeCode: 'NV004', email: 'qt@example.com', phone: '0906', businessUnitIds: [1] }),
        userRow({ id: 3, role: 'CUSTOMER', fullName: 'KH portal', employeeCode: null, businessUnitIds: [] }),
      ],
      total: 7,
      businessUnits: BUSINESS_UNITS,
    });
  });

  // Owner ruling 2026-10-09 ('cham cong only laixe driver' / 'no office
  // staff'): the personnel roster is the DRIVER roster — every office role
  // (OPS, ACCOUNTANT, DISPATCHER, ADMIN, MANAGER, CUS) stays on /users.
  it('lists drivers only — no office staff, no customer portal accounts', async () => {
    renderPage();
    expect(await screen.findByText('Lái xe A')).toBeInTheDocument();
    expect(screen.getByText('Lái xe B')).toBeInTheDocument();
    expect(screen.getByText('TX001')).toBeInTheDocument();
    expect(screen.getAllByRole('cell', { name: 'Đội xe' })).toHaveLength(2); // both drivers sit in Đội xe
    for (const office of ['Trần Văn Bình', 'Kế toán C', 'Điều vận D', 'Quản trị E', 'KH portal']) {
      expect(screen.queryByText(office)).not.toBeInTheDocument();
    }
  });

  it('narrows the driver list by search term', async () => {
    renderPage();
    await screen.findByText('Lái xe A');

    fireEvent.change(screen.getByLabelText('Tìm trong danh sách nhân sự'), {
      target: { value: 'TX002' },
    });
    expect(screen.getByText('Lái xe B')).toBeInTheDocument();
    expect(screen.queryByText('Lái xe A')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Tìm trong danh sách nhân sự'), {
      target: { value: 'NV001' },
    });
    expect(await screen.findByText('Không tìm thấy nhân sự')).toBeInTheDocument();
  });

  it('shows the roster empty state when no driver matches the filters', async () => {
    renderPage();
    await screen.findByText('Lái xe A');

    fireEvent.change(screen.getByLabelText('Tìm trong danh sách nhân sự'), {
      target: { value: 'zzz-khong-co' },
    });
    expect(await screen.findByText('Không tìm thấy nhân sự')).toBeInTheDocument();
  });
});
