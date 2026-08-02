import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { refetchUsers } = vi.hoisted(() => ({ refetchUsers: vi.fn() }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [] }),
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

vi.mock('../hooks/useCatalogQueries', () => ({
  useUsers: () => ({
    data: {
      items: [],
      businessUnits: [
        { id: 11, code: 'HCM', name: 'Điều hành miền Nam', status: 'ACTIVE', createdAt: '', updatedAt: '' },
        { id: 12, code: 'HN', name: 'Điều hành miền Bắc', status: 'INACTIVE', createdAt: '', updatedAt: '' },
      ],
    },
    isLoading: false,
    refetch: refetchUsers,
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
    expect(unitManager.getByText('Mã HN · Ngừng sử dụng')).toBeTruthy();
    expect(section?.textContent).not.toMatch(/\b(?:Q17|ACTIVE|INACTIVE)\b/);
  });
});
