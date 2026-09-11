import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import {
  createDispatchTaskTag,
  deactivateDispatchTaskTag,
  listDispatchTaskTags,
  updateDispatchTaskTag,
} from '../../../api/dispatchPlanningClient';
import { DispatchTaskTagEditor } from './DispatchTaskTagEditor';

vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/dispatchPlanningClient')>();
  return {
    ...actual,
    listDispatchTaskTags: vi.fn(),
    createDispatchTaskTag: vi.fn(),
    updateDispatchTaskTag: vi.fn(),
    deactivateDispatchTaskTag: vi.fn(),
  };
});

const listMock = vi.mocked(listDispatchTaskTags);
const createMock = vi.mocked(createDispatchTaskTag);
const updateMock = vi.mocked(updateDispatchTaskTag);
const deactivateMock = vi.mocked(deactivateDispatchTaskTag);

/** Five seeded pool labels, shared by every test's initial pool load. */
const SEED_ITEMS = [
  { id: 1, label: 'Đặt đầu' },
  { id: 2, label: 'Đặt đuôi' },
  { id: 3, label: 'Đảo vỏ' },
  { id: 4, label: 'Gửi bãi' },
  { id: 5, label: 'Lấy vỏ ICD đi đóng' },
];

beforeEach(() => {
  listMock.mockClear();
  listMock.mockResolvedValue({ items: SEED_ITEMS });
  createMock.mockReset();
  createMock.mockResolvedValue({ id: 99, label: 'mới' });
  updateMock.mockReset();
  updateMock.mockResolvedValue({ id: 1, label: 'Đặt đầu' });
  deactivateMock.mockReset();
  deactivateMock.mockResolvedValue({ ok: true });
});

/** Stateful harness mirroring the modal: onChange feeds straight back into
 *  the value prop, like the parent draft does. */
function StatefulHarness({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial);
  return <DispatchTaskTagEditor value={value} onChange={setValue} />;
}

function renderHarness(initial: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StatefulHarness initial={initial} />
    </QueryClientProvider>,
  );
}

describe('DispatchTaskTagEditor', () => {
  it('renders pool tags as toggle chips and composes toggles cumulatively', async () => {
    renderHarness(null);
    await screen.findByRole('button', { name: 'Đặt đầu' });
    fireEvent.click(screen.getByRole('button', { name: 'Đặt đầu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đặt đuôi' }));
    await waitFor(() => expect(screen.getByText('Hiển thị: Đặt đầu; Đặt đuôi')).toBeTruthy());
  });

  it('pre-selects chips for a stored note and keeps manual text', async () => {
    renderHarness('Đặt đầu; Lấy vỏ ICD đi đóng; gọi lái trước 30p');
    await screen.findByRole('button', { name: 'Đặt đầu' });
    expect(screen.getByRole('button', { name: 'Đặt đầu' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Lấy vỏ ICD đi đóng' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Đặt đuôi' }).getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByLabelText('Ghi chú thêm') as HTMLTextAreaElement).value).toBe('gọi lái trước 30p');
  });

  it('keeps the tag chips and the typed note in separate labeled sections', async () => {
    renderHarness(null);
    await screen.findByRole('button', { name: 'Đặt đầu' });
    const tagGroup = screen.getByRole('group', { name: 'Ghi chú tác vụ' });
    // Typed text lives outside the tag group, under its own "Ghi chú thêm" label.
    expect(tagGroup.contains(screen.getByLabelText('Ghi chú thêm'))).toBe(false);
  });

  it('replaces manual text via the textarea', async () => {
    renderHarness('Đặt đầu; ghi cũ');
    await screen.findByRole('button', { name: 'Đặt đầu' });
    const box = screen.getByLabelText('Ghi chú thêm') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'ghi mới' } });
    await waitFor(() => expect(screen.getByText((_, el) => el?.textContent === 'Hiển thị: Đặt đầu\nghi mới')).toBeTruthy());
  });

  it('inline-add posts a new tag, renders its chip, and selects it', async () => {
    createMock.mockResolvedValue({ id: 20, label: 'Giao trước 9h' });
    // Initial load → five seeds; the post-create invalidate refetches and
    // must now include the new label.
    listMock.mockReset();
    listMock.mockResolvedValueOnce({
      items: [
        { id: 1, label: 'Đặt đầu' },
        { id: 2, label: 'Đặt đuôi' },
        { id: 3, label: 'Đảo vỏ' },
        { id: 4, label: 'Gửi bãi' },
        { id: 5, label: 'Lấy vỏ ICD đi đóng' },
      ],
    });
    listMock.mockResolvedValue({
      items: [
        { id: 1, label: 'Đặt đầu' },
        { id: 2, label: 'Đặt đuôi' },
        { id: 3, label: 'Đảo vỏ' },
        { id: 4, label: 'Gửi bãi' },
        { id: 5, label: 'Lấy vỏ ICD đi đóng' },
        { id: 20, label: 'Giao trước 9h' },
      ],
    });
    renderHarness(null);
    await screen.findByRole('button', { name: 'Đặt đầu' });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm tag mới vào danh sách' }));
    fireEvent.change(screen.getByLabelText('Tên tag mới'), { target: { value: 'Giao trước 9h' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await screen.findByRole('button', { name: 'Giao trước 9h' });
    expect(screen.getByRole('button', { name: 'Giao trước 9h' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('inline-add duplicate returns 409 → selects the existing chip', async () => {
    createMock.mockRejectedValue({ status: 409 });
    renderHarness(null);
    await screen.findByRole('button', { name: 'Đặt đầu' });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm tag mới vào danh sách' }));
    fireEvent.change(screen.getByLabelText('Tên tag mới'), { target: { value: 'ĐẶT ĐẦU' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await screen.findByRole('status');
    expect(screen.getByRole('button', { name: 'Đặt đầu' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('DispatchTaskTagEditor manage popover', () => {
  async function openManager() {
    await screen.findByRole('button', { name: 'Đặt đầu' });
    fireEvent.click(screen.getByRole('button', { name: 'Quản lý tag' }));
    return screen.findByRole('dialog', { name: 'Quản lý tag' });
  }

  it('opens from the pencil button, lists pool tags, shows count', async () => {
    renderHarness(null);
    const dialog = await openManager();
    expect(within(dialog).getByText('Đặt đầu')).toBeTruthy();
    expect(within(dialog).getByText('Đặt đuôi')).toBeTruthy();
    expect(within(dialog).getByText('Gửi bãi')).toBeTruthy();
    expect(within(dialog).getByText('5')).toBeTruthy();
    // No edits happened just by looking.
    expect(updateMock).not.toHaveBeenCalled();
    expect(deactivateMock).not.toHaveBeenCalled();
  });

  it('rename keeps the draft chip intact across the pool update', async () => {
    listMock.mockReset();
    listMock.mockResolvedValueOnce({ items: SEED_ITEMS });
    listMock.mockResolvedValue({
      items: [
        { id: 1, label: 'Đặt đầu sớm' },
        { id: 2, label: 'Đặt đuôi' },
        { id: 3, label: 'Đảo vỏ' },
        { id: 4, label: 'Gửi bãi' },
        { id: 5, label: 'Lấy vỏ ICD đi đóng' },
      ],
    });
    updateMock.mockResolvedValue({ id: 1, label: 'Đặt đầu sớm' });
    renderHarness('Đặt đầu; gọi lái trước 30p');
    await screen.findByRole('button', { name: 'Đặt đầu' });
    expect(screen.getByRole('button', { name: 'Đặt đầu' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Quản lý tag' }));
    const dialog = await screen.findByRole('dialog', { name: 'Quản lý tag' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đổi tên tag Đặt đầu' }));
    const input = within(dialog).getByLabelText('Tên tag') as HTMLInputElement;
    expect(input.value).toBe('Đặt đầu');
    fireEvent.change(input, { target: { value: 'Đặt đầu sớm' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(1, 'Đặt đầu sớm'));
    // The draft note re-composes: renamed chip stays selected, manual text intact.
    await screen.findByText((_, el) => el?.textContent === 'Hiển thị: Đặt đầu sớm\ngọi lái trước 30p');
    // Refetched pool renders the renamed chip as selected.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Đặt đầu sớm' }).getAttribute('aria-pressed')).toBe('true');
    });
  });

  it('rename cancel (Escape) keeps the label unchanged', async () => {
    renderHarness(null);
    const dialog = await openManager();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đổi tên tag Đặt đầu' }));
    const input = within(dialog).getByLabelText('Tên tag') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'không nên lưu' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    // Edit row exits; the label row returns with the original label.
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Đổi tên tag Đặt đầu' })).toBeTruthy());
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rename duplicate (409) surfaces the inline duplicate notice', async () => {
    updateMock.mockRejectedValue({ status: 409 });
    renderHarness(null);
    const dialog = await openManager();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đổi tên tag Đặt đầu' }));
    fireEvent.change(within(dialog).getByLabelText('Tên tag'), { target: { value: 'Đặt đuôi' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(within(dialog).getByText('Tag đã tồn tại.')).toBeTruthy());
    // Pool untouched on failure.
    expect(screen.queryByRole('button', { name: 'Đặt đầu sớm' })).toBeNull();
  });

  it('soft-delete: two-step confirm removes the tag from the chip row', async () => {
    listMock.mockReset();
    listMock.mockResolvedValueOnce({ items: SEED_ITEMS });
    listMock.mockResolvedValue({ items: SEED_ITEMS.filter((tag) => tag.id !== 1) });
    renderHarness('Đặt đầu; ghi riêng');
    await screen.findByRole('button', { name: 'Đặt đầu' });
    fireEvent.click(screen.getByRole('button', { name: 'Quản lý tag' }));
    const dialog = await screen.findByRole('dialog', { name: 'Quản lý tag' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa tag Đặt đầu' }));
    // Two-step: first click shows the inline confirm; second click deactivates.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa' }));
    await waitFor(() => expect(deactivateMock).toHaveBeenCalledWith(1));
    // Refetched pool (without the tag) drops the chip; the note degrades to
    // manual text instead of losing data.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Xóa tag Đặt đầu' })).toBeNull();
    });
    await waitFor(() => {
      const box = screen.getByLabelText('Ghi chú thêm') as HTMLTextAreaElement;
      expect(box.value).toBe('Đặt đầu; ghi riêng');
    });
  });

  it('delete cancel keeps the tag', async () => {
    renderHarness(null);
    const dialog = await openManager();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa tag Đặt đầu' }));
    // Confirm row appears with the cancel option.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Xóa tag Đặt đầu' })).toBeTruthy());
    expect(deactivateMock).not.toHaveBeenCalled();
  });
});
