import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { refetchUsers } = vi.hoisted(() => ({ refetchUsers: vi.fn() }));
const { updateBusinessUnit, deactivateBusinessUnit, createBusinessUnit } = vi.hoisted(() => ({
  updateBusinessUnit: vi.fn(),
  deactivateBusinessUnit: vi.fn(),
  createBusinessUnit: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  // Key-aware stub: the users-table query returns the /users envelope; every
  // other query (trucks, customers, shipment scope) gets an empty array.
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = JSON.stringify(queryKey ?? []);
    if (key.includes('users')) {
      return {
        data: {
          items: [],
          total: 0,
          businessUnits: [
            { id: 11, code: 'HCM', name: 'Đơn vị A', status: 'ACTIVE', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: UNIT_A_UPDATED_AT },
            { id: 12, code: 'HAN', name: 'Đơn vị B', status: 'INACTIVE', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: UNIT_B_UPDATED_AT },
          ],
          counts: { total: 0, staffCount: 0, driverCount: 0, inactiveCount: 0, byRole: {} },
        },
        isLoading: false,
        refetch: refetchUsers,
      };
    }
    return { data: [] };
  },
}));

vi.mock('../api/userClient', () => ({
  userClient: {
    getUsers: vi.fn(),
    getUser: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    getBusinessUnits: vi.fn(),
    createBusinessUnit,
    updateBusinessUnit,
    deactivateBusinessUnit,
  },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      userId: 1,
      role: 'ADMIN',
      capabilities: ['manage_users'],
    },
  }),
}));

vi.mock('../features/users/hooks/useUserMutations', () => ({
  useUserMutations: () => ({
    saving: false,
    panelError: null,
    deleting: false,
    confirmDialog: null,
    doCreate: vi.fn(),
    doUpdate: vi.fn(),
    doDelete: vi.fn(),
    clearPanelError: vi.fn(),
  }),
}));

vi.mock('../features/users/components/UserTable', () => ({
  UserTable: () => <div data-testid="user-table" />,
}));

vi.mock('../features/users/components/UserForm', () => ({
  AddPanel: () => null,
  EditPanel: () => null,
}));

vi.mock('../components/shared/Breadcrumbs', () => ({
  Breadcrumbs: () => null,
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import UsersPage from './UsersPage';

// Stable version tokens — the assertions pin that every mutation carries the
// loaded row's updatedAt, which is the only thing that defeats the 428 guard.
const UNIT_A_UPDATED_AT = '2026-09-14T05:00:00.000Z';
const UNIT_B_UPDATED_AT = '2026-09-14T06:00:00.000Z';

function unitCard(name: string) {
  const heading = screen.getByText(name).closest('article');
  expect(heading).not.toBeNull();
  return heading as HTMLElement;
}

describe('UsersPage business-unit product copy', () => {
  it('renders localized lifecycle copy and statuses instead of internal codes', () => {
    render(<UsersPage />);

    const heading = screen.getByRole('heading', { name: 'Đơn vị phụ trách' });
    const section = heading.closest('section');
    expect(section).not.toBeNull();

    const unitManager = within(section as HTMLElement);
    expect(unitManager.getByText(
      'Ngừng sử dụng để ẩn đơn vị khỏi các lựa chọn mới. Lịch sử và các liên kết hiện có vẫn được giữ nguyên.',
    )).toBeTruthy();
    expect(unitManager.getByText('Mã HCM · Đang sử dụng')).toBeTruthy();
    expect(unitManager.getByText('Mã HAN · Ngừng sử dụng')).toBeTruthy();
    expect(section?.textContent).not.toMatch(/\b(?:Q17|ACTIVE|INACTIVE)\b/);
  });
});

describe('UsersPage business-unit lifecycle', () => {
  beforeEach(() => {
    updateBusinessUnit.mockReset().mockResolvedValue({});
    deactivateBusinessUnit.mockReset().mockResolvedValue({});
    createBusinessUnit.mockReset().mockResolvedValue({});
    refetchUsers.mockReset().mockResolvedValue({ data: {} });
  });

  it('renames with the loaded row version token — no missing-version 428 loop', async () => {
    render(<UsersPage />);
    fireEvent.click(within(unitCard('Đơn vị A')).getByRole('button', { name: 'Sửa' }));
    fireEvent.change(screen.getByLabelText('Tên đơn vị'), { target: { value: 'Đơn vị A Sửa Tên' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu đơn vị' }));

    await waitFor(() => expect(updateBusinessUnit).toHaveBeenCalledTimes(1));
    expect(updateBusinessUnit).toHaveBeenCalledWith(
      11,
      { code: 'HCM', name: 'Đơn vị A Sửa Tên' },
      UNIT_A_UPDATED_AT,
    );
    await waitFor(() => expect(refetchUsers).toHaveBeenCalled());
  });

  it('keeps the draft and refetches on a 428 conflict — recovery, not a loop', async () => {
    updateBusinessUnit.mockRejectedValueOnce(
      Object.assign(new Error('Thiếu phiên bản đơn vị phụ trách. Vui lòng tải lại trước khi cập nhật.'), { status: 428 }),
    );
    render(<UsersPage />);
    fireEvent.click(within(unitCard('Đơn vị A')).getByRole('button', { name: 'Sửa' }));
    const nameInput = screen.getByLabelText('Tên đơn vị');
    fireEvent.change(nameInput, { target: { value: 'Đơn vị Đối Tượng' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu đơn vị' }));

    await waitFor(() => expect(refetchUsers).toHaveBeenCalled());
    expect(screen.getByText(/Đơn vị đã được cập nhật ở nơi khác — đã tải lại bản mới nhất/)).toBeTruthy();
    // Draft preserved for review: the admin's text survives the failed save.
    expect((nameInput as HTMLInputElement).value).toBe('Đơn vị Đối Tượng');
    expect(screen.getByRole('button', { name: 'Lưu đơn vị' })).toBeTruthy();
  });

  it('deactivates with the loaded row version token', async () => {
    render(<UsersPage />);
    fireEvent.click(within(unitCard('Đơn vị A')).getByRole('button', { name: 'Ngưng dùng' }));

    await waitFor(() => expect(deactivateBusinessUnit).toHaveBeenCalledTimes(1));
    expect(deactivateBusinessUnit).toHaveBeenCalledWith(11, UNIT_A_UPDATED_AT);
    await waitFor(() => expect(refetchUsers).toHaveBeenCalled());
  });

  it('reactivates an inactive unit with its version token', async () => {
    render(<UsersPage />);
    fireEvent.click(within(unitCard('Đơn vị B')).getByRole('button', { name: 'Kích hoạt lại' }));

    await waitFor(() => expect(updateBusinessUnit).toHaveBeenCalledTimes(1));
    expect(updateBusinessUnit).toHaveBeenCalledWith(12, { status: 'ACTIVE' }, UNIT_B_UPDATED_AT);
    await waitFor(() => expect(refetchUsers).toHaveBeenCalled());
  });
});
