import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DispatchTaskTagEditor } from './DispatchTaskTagEditor';

// Red repro (exploratory code sweep 2026-09-15): submitNewTag's 409 branch
// composes [...selectedLabels, existing] without the includes() guard the
// toggle path has. Adding an ALREADY-SELECTED tag through "+ Thêm tag"
// therefore writes the label twice into the stored note ("A; A\n..."), which
// renders as duplicated Tác vụ chips on the driver detail (duplicate React
// keys at DriverTripDetailPage key={tag}) and on the board cards.
vi.mock('./useDispatchTaskTags', () => {
  const reject409 = () => Promise.reject(Object.assign(new Error('Tag đã tồn tại'), { status: 409 }));
  return {
    useDispatchTaskTags: () => ({ tags: [{ id: 1, label: 'BỐC HÀNG' }], error: null }),
    useCreateDispatchTaskTag: () => ({ createTag: vi.fn(reject409), invalidateTags: vi.fn(), isCreating: false }),
    useUpdateDispatchTaskTag: () => ({ updateTag: vi.fn(), isUpdating: false }),
    useDeactivateDispatchTaskTag: () => ({ deactivateTag: vi.fn(), isDeactivating: false }),
  };
});

const changed: string[] = [];
const onChange = (next: string) => { changed.push(next); };

function renderEditor(value: string | null = null) {
  changed.length = 0;
  function ControlledEditor() {
    const [draft, setDraft] = useState(value);
    return <DispatchTaskTagEditor value={draft} onChange={(next) => { setDraft(next); onChange(next); }} />;
  }
  return render(<ControlledEditor />);
}

describe('DispatchTaskTagEditor — 409 duplicate-select must not duplicate a selected tag', () => {
  it('keeps the composed note unchanged when the 409-matched tag is already selected', async () => {
    renderEditor('BỐC HÀNG\nGọi cổng');
    // Chip starts selected from the stored note.
    expect(screen.getByRole('button', { name: 'BỐC HÀNG' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Thêm tag mới vào danh sách' }));
    const addInput = screen.getByLabelText('Tên tag mới') as HTMLInputElement;
    fireEvent.change(addInput, { target: { value: 'bốc hàng' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    // 409 resolves to the existing label; the composed note must not gain a
    // second copy of it — the editor must not rewrite the note at all.
    await screen.findByText('Tag đã tồn tại — đã chọn tag có sẵn.');
    expect(changed).toEqual([]);
    // Preview still renders exactly one instance of the tag.
    const preview = screen.getByLabelText('Xem trước ghi chú lái xe');
    expect((preview.textContent ?? '').split('BỐC HÀNG').length - 1).toBe(1);
  });

  it('still selects a genuinely new-to-draft tag through the 409 path', async () => {
    renderEditor(null);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm tag mới vào danh sách' }));
    const addInput = screen.getByLabelText('Tên tag mới') as HTMLInputElement;
    fireEvent.change(addInput, { target: { value: 'bốc hàng' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await screen.findByText('Tag đã tồn tại — đã chọn tag có sẵn.');
    expect(changed.at(-1)).toBe('BỐC HÀNG');
  });
});
