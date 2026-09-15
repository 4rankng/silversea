import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DispatchTaskTagEditor } from './DispatchTaskTagEditor';

vi.mock('./useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => ({ tags: [{ id: 1, label: 'HẾT HẠN' }], error: null }),
  useCreateDispatchTaskTag: () => ({ createTag: vi.fn(), invalidateTags: vi.fn(), isCreating: false }),
}));

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

/** The note textarea is the "Ghi chú thêm" free-text box. */
function noteBox() {
  return screen.getByLabelText('Ghi chú thêm') as HTMLTextAreaElement;
}

describe('DispatchTaskTagEditor — typed note keeps spaces (QA ruling 2026-09-14)', () => {
  it('keeps a trailing space while typing — compose preserves, normalize trims', () => {
    renderEditor();
    fireEvent.change(noteBox(), { target: { value: 'Giao' } });
    fireEvent.change(noteBox(), { target: { value: 'Giao ' } });
    // The space survives in the FIELD and in the composed note during editing.
    expect(noteBox().value).toBe('Giao ');
    expect(changed.at(-1)).toBe('Giao ');
    // Normalization only happens on blur (explicit save).
    fireEvent.blur(noteBox());
    expect(changed.at(-1)).toBe('Giao');
  });

  it('snaps the field to the normalized text on blur', () => {
    renderEditor();
    fireEvent.change(noteBox(), { target: { value: 'Kéo container ' } });
    fireEvent.blur(noteBox());
    expect(noteBox().value).toBe('Kéo container');
  });

  it('composes tags and typed text into the stored note format', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'HẾT HẠN' }));
    fireEvent.change(noteBox(), { target: { value: 'Giao đối khớp' } });
    expect(changed.at(-1)).toBe('HẾT HẠN\nGiao đối khớp');
  });
});
