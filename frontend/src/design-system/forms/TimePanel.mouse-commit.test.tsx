import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SplitDateTimeField } from './SplitDateTimeField';

/**
 * dis-05 (card 211026131957) — a hand-typed exact time in the picker must
 * survive the natural mouse flow: type "1745", then click Lưu / anywhere
 * outside. The panel is dismissed by the outside pointer press and a removed
 * input never fires blur, so before this fix the typed draft was silently
 * discarded — the host save PATCH omitted the hour entirely ("lưu OK") and
 * the outer grid kept the old value ("bảng ngoài không refresh"). The commit
 * now rides the unmount when an outside press dismissed the panel, while
 * Escape keeps its revert contract (no commit) and Enter/"Xong" keep theirs.
 */

function renderField(value = '2026-10-25T15:30') {
  const onChange = vi.fn();
  render(
    <SplitDateTimeField
      id="end"
      label="Giờ trả hàng"
      value={value}
      onChange={onChange}
    />,
  );
  return onChange;
}

function openTimePanel() {
  const group = document.querySelector('[data-seg-part="time"]');
  if (!group) throw new Error('time segments not found');
  fireEvent.click(group);
  const exact = screen.getByLabelText('Giờ chính xác (HH:mm)');
  return exact;
}

function typeExact(exact: HTMLElement, digits: string) {
  fireEvent.change(exact, { target: { value: digits } });
}

function pressOutside() {
  // Full pointer sequence a real outside tap produces (house `tap()` shape).
  fireEvent.pointerDown(document.body);
  fireEvent.mouseDown(document.body);
  fireEvent.pointerUp(document.body);
  fireEvent.click(document.body);
}

describe('TimePanel exact-entry mouse commit (dis-05, card 211026131857 family)', () => {
  it('commits a hand-typed exact time when an outside press dismisses the panel', async () => {
    const onChange = renderField();
    const exact = openTimePanel();
    typeExact(exact, '17:45');
    pressOutside();
    await waitFor(() => {
      expect(screen.queryByLabelText('Giờ chính xác (HH:mm)')).toBeNull();
    });
    expect(onChange).toHaveBeenCalledWith('2026-10-25T17:45');
  });

  it('keeps the Escape revert contract — a typed draft does NOT commit', async () => {
    const onChange = renderField();
    const exact = openTimePanel();
    typeExact(exact, '17:45');
    fireEvent.keyDown(exact, { key: 'Escape' });
    fireEvent.keyUp(exact, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByLabelText('Giờ chính xác (HH:mm)')).toBeNull();
    });
    expect(onChange).not.toHaveBeenCalledWith('2026-10-25T17:45');
  });

  it('invalid text never invents a time on outside dismissal', async () => {
    const onChange = renderField();
    const exact = openTimePanel();
    typeExact(exact, '99:99');
    pressOutside();
    await waitFor(() => {
      expect(screen.queryByLabelText('Giờ chính xác (HH:mm)')).toBeNull();
    });
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining('T99'));
  });

  it('Enter keeps the explicit commit contract (FB-002 family)', () => {
    const onChange = renderField();
    const exact = openTimePanel();
    typeExact(exact, '18:20');
    fireEvent.keyDown(exact, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('2026-10-25T18:20');
  });
});
