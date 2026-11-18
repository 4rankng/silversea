import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { CusGroupsManager } from './CusGroupsManager';

const { listGroups, createGroup, setMembers, getUsers } = vi.hoisted(() => ({
  listGroups: vi.fn(),
  createGroup: vi.fn(),
  setMembers: vi.fn(),
  getUsers: vi.fn(),
}));

vi.mock('../../../api/cusGroups', () => ({
  cusGroupsClient: { list: listGroups, create: createGroup, setMembers, update: vi.fn() },
}));

vi.mock('../../../api/userClient', () => ({
  userClient: { getUsers },
}));

vi.mock('../../../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const groups = [
  {
    id: 1,
    name: 'Team CS 1',
    status: 'ACTIVE',
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
    members: [{ userId: 11, name: 'An CUS', username: 'an', status: 'ACTIVE' }],
  },
];

const roster = [
  { id: 11, username: 'an', fullName: 'An CUS', role: 'CUS', status: 'ACTIVE' },
  { id: 12, username: 'binh', fullName: 'Bình CUS', role: 'CUS', status: 'ACTIVE' },
  { id: 13, username: 'chi', fullName: 'Chi nghỉ', role: 'CUS', status: 'INACTIVE' },
];

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CusGroupsManager />
    </QueryClientProvider>,
  );
}

describe('CusGroupsManager — tạo nhóm + lưu thành viên', () => {
  it('tạo nhóm gọi POST với tên đã trim', async () => {
    listGroups.mockResolvedValue({ items: [] });
    getUsers.mockResolvedValue({ items: roster });
    createGroup.mockResolvedValue(groups[0]);
    renderCard();

    const input = await screen.findByPlaceholderText('Ví dụ: Team CS 1');
    fireEvent.change(input, { target: { value: '  Team CS 2  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo nhóm' }));

    await waitFor(() => expect(createGroup).toHaveBeenCalledWith({ name: 'Team CS 2' }));
  });

  it('editor thành viên chỉ liệt kê user CUS ACTIVE và gửi replace-all đúng danh sách', async () => {
    listGroups.mockResolvedValue({ items: groups });
    getUsers.mockResolvedValue({ items: roster });
    setMembers.mockResolvedValue(groups[0]);
    renderCard();

    // An CUS (thành viên hiện có) + Bình CUS (active) hiện; Chi nghỉ (INACTIVE) không.
    const an = await screen.findByRole('checkbox', { name: 'An CUS' });
    expect(screen.getByRole('checkbox', { name: 'Bình CUS' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Chi nghỉ' })).toBeNull();

    // Chưa chỉnh sửa → nút Lưu thành viên disabled (không có draft).
    const save = screen.getByRole('button', { name: 'Lưu thành viên' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(an); // bỏ An
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bình CUS' })); // thêm Bình
    fireEvent.click(save);

    await waitFor(() =>
      expect(setMembers).toHaveBeenCalledWith(1, [12]),
    );
  });
});
