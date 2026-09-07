import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { createDispatchTaskTag, listDispatchTaskTags } from '../../../api/dispatchPlanningClient';
import { DispatchTaskTagEditor } from './DispatchTaskTagEditor';

vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/dispatchPlanningClient')>();
  return {
    ...actual,
    listDispatchTaskTags: vi.fn(),
    createDispatchTaskTag: vi.fn(),
  };
});

const listMock = vi.mocked(listDispatchTaskTags);
const createMock = vi.mocked(createDispatchTaskTag);

beforeEach(() => {
  listMock.mockClear();
  listMock.mockResolvedValue({
    items: [
      { id: 1, label: 'Đặt đầu' },
      { id: 2, label: 'Đặt đuôi' },
      { id: 3, label: 'Đảo vỏ' },
      { id: 4, label: 'Gửi bãi' },
      { id: 5, label: 'Lấy vỏ ICD đi đóng' },
    ],
  });
  createMock.mockReset();
  createMock.mockResolvedValue({ id: 99, label: 'mới' });
});

describe('DispatchTaskTagEditor', () => {
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
    expect((screen.getByLabelText('Ghi chú thêm (đi kèm các tag đã chọn)') as HTMLTextAreaElement).value).toBe('gọi lái trước 30p');
  });

  it('replaces manual text via the textarea', async () => {
    renderHarness('Đặt đầu; ghi cũ');
    await screen.findByRole('button', { name: 'Đặt đầu' });
    const box = screen.getByLabelText('Ghi chú thêm (đi kèm các tag đã chọn)') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'ghi mới' } });
    await waitFor(() => expect(screen.getByText('Hiển thị: Đặt đầu; ghi mới')).toBeTruthy());
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
