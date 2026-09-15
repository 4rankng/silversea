// Card 20260915_8 — minute-tap in the time picker dismisses the parent
// schedule dialog with draft loss, while hour taps survive. Replicates the
// ShipmentsPage quick-edit parent contract (outside pointerdown/mousedown +
// window Escape, ignore list covering modal content and open picker
// surfaces) around the real DateTimePickerDialog, and pins the invariant:
// NO interaction inside the picker — commit paths included — may close the
// parent. Commit paths in TimePanel: minute tap, Xong, Enter (all onPick).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DateTimePickerDialog } from './DateTimePickerPanels';
import { useClickOutside } from '../../hooks/useClickOutside';

function ParentHarness({ onParentClose, dialogValue }: { onParentClose: () => void; dialogValue: string }) {
  const formRef = useRef<HTMLDivElement>(null);
  useClickOutside(formRef, onParentClose, {
    escapeKey: true,
    enabled: true,
    ignoreSelector: '.modal__content, .searchable-select__popover, .searchable-select__backdrop, .react-aria-Popover, .time-picker__popup, .time-picker__overlay, .time-picker__sheet, .time-picker__inline',
  });
  return (
    <div className="modal__content">
      <div ref={formRef}>
        <input aria-label="Trường khác" />
        <DateTimePickerDialog title="Lịch hẹn" value={dialogValue} onConfirm={vi.fn()} onClose={vi.fn()} />
      </div>
    </div>
  );
}

function openTimePanel(value: string) {
  const onParentClose = vi.fn();
  render(<ParentHarness onParentClose={onParentClose} dialogValue={value} />);
  fireEvent.click(screen.getByRole('button', { name: /GIỜ/ }));
  return { onParentClose };
}

const PARENT_ALIVE = 'Trường khác';
const hour = (n: number) => within(screen.getByRole('listbox', { name: 'Giờ 00–23' })).getByRole('option', { name: String(n) });
const minute = (n: number) => within(screen.getByRole('listbox', { name: 'Phút 00–59' })).getByRole('option', { name: String(n) });

/** Full pointer sequence a real tap produces. */
function tap(item: HTMLElement) {
  fireEvent.pointerDown(item);
  fireEvent.mouseDown(item);
  fireEvent.pointerUp(item);
  fireEvent.click(item);
}

describe('picker interactions never dismiss the parent dialog', () => {
  it('control: hour tap leaves the parent open', () => {
    const { onParentClose } = openTimePanel('2026-09-20T15:30');
    tap(hour(14));
    expect(screen.getByLabelText(PARENT_ALIVE)).toBeInTheDocument();
    expect(onParentClose).not.toHaveBeenCalled();
  });

  it('minute tap applies the time and leaves the parent open', () => {
    const { onParentClose } = openTimePanel('2026-09-20T15:30');
    tap(minute(35));
    const gio = screen.getByRole('button', { name: /GIỜ/ });
    expect(gio).toHaveTextContent('15:35');
    expect(screen.getByLabelText(PARENT_ALIVE)).toBeInTheDocument();
    expect(onParentClose).not.toHaveBeenCalled();
  });

  it('keeps the picker panel mounted through the press that picked the minute, then settles closed', async () => {
    const { onParentClose } = openTimePanel('2026-09-20T15:30');
    tap(minute(35));
    // Commit applied immediately...
    expect(screen.getByRole('button', { name: /GIỜ/ })).toHaveTextContent('15:35');
    // ...but the panel is still mounted while the gesture is in flight — an
    // immediate unmount orphaned the press's mousedown, which the browser
    // retargets to <body>, and the parent's outside-press detector reads that
    // as an outside tap (card _8: minute-tap dismissed the whole dialog).
    expect(screen.getByRole('listbox', { name: 'Phút 00–59' })).toBeInTheDocument();
    // The gesture settles and only then does the panel close.
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Phút 00–59' })).not.toBeInTheDocument());
    expect(onParentClose).not.toHaveBeenCalled();
  });

  it('Xong (exact apply) leaves the parent open', () => {
    const { onParentClose } = openTimePanel('2026-09-20T15:30');
    const exact = screen.getByLabelText('Giờ chính xác (HH:mm)');
    fireEvent.change(exact, { target: { value: '14:17' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    expect(screen.getByRole('button', { name: /GIỜ/ })).toHaveTextContent('14:17');
    expect(screen.getByLabelText(PARENT_ALIVE)).toBeInTheDocument();
    expect(onParentClose).not.toHaveBeenCalled();
  });

  it('Enter in the exact input leaves the parent open', () => {
    const { onParentClose } = openTimePanel('2026-09-20T15:30');
    const exact = screen.getByLabelText('Giờ chính xác (HH:mm)');
    fireEvent.change(exact, { target: { value: '14:17' } });
    fireEvent.keyDown(exact, { key: 'Enter' });
    expect(screen.getByRole('button', { name: /GIỜ/ })).toHaveTextContent('14:17');
    expect(screen.getByLabelText(PARENT_ALIVE)).toBeInTheDocument();
    expect(onParentClose).not.toHaveBeenCalled();
  });
});
