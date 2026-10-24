import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ContainerTypeCellPicker } from './ContainerTypeCellPicker';

const OPTIONS = [
  { id: 20, code: '20DC', name: "20'DC" },
  { id: 40, code: '40HC', name: "40'HC" },
];

describe('ContainerTypeCellPicker — commit pin (20260918_11)', () => {
  it('picking an option commits its id through onChange', async () => {
    const onChange = vi.fn();
    render(
      <ContainerTypeCellPicker value="" onChange={onChange} options={OPTIONS} fieldId="probe-type" saving={false} />,
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Loại container' })).toBeTruthy());
    fireEvent.click(screen.getByRole('combobox', { name: 'Loại container' }));

    const option = await screen.findByRole('option', { name: '20DC' });
    fireEvent.click(option);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('20'));
  });

  it('keyboard path (ArrowDown + Enter) commits the highlighted id', async () => {
    const onChange = vi.fn();
    render(
      <ContainerTypeCellPicker value="" onChange={onChange} options={OPTIONS} fieldId="probe-type-kbd" saving={false} />,
    );

    const combo = screen.getByRole('combobox', { name: 'Loại container' });
    fireEvent.click(combo);
    await screen.findByRole('option', { name: '20DC' });
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    fireEvent.keyDown(combo, { key: 'Enter' });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('20'));
  });

  it('typing right after keyboard focus opens the suggestions and filters (20260921_1)', async () => {
    const onChange = vi.fn();
    render(
      <ContainerTypeCellPicker value="" onChange={onChange} options={OPTIONS} fieldId="probe-type-tab" saving={false} />,
    );

    const combo = screen.getByRole('combobox', { name: 'Loại container' });
    // Tab-in lands focus; the very first typed character must surface the
    // suggestion list (no mouse click in this flow). Real .focus() (not the
    // synthetic event) so document.activeElement actually moves — RAC's
    // menu-trigger machinery checks it.
    combo.focus();
    fireEvent.change(combo, { target: { value: '4' } });

    expect(await screen.findByRole('option', { name: '40HC' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '20DC' })).toBeNull();
  });

  it('ArrowDown + Enter commits after the menu was opened by typing', async () => {
    const onChange = vi.fn();
    render(
      <ContainerTypeCellPicker value="" onChange={onChange} options={OPTIONS} fieldId="probe-type-tab-kbd" saving={false} />,
    );

    const combo = screen.getByRole('combobox', { name: 'Loại container' });
    combo.focus();
    fireEvent.change(combo, { target: { value: '4' } });
    await screen.findByRole('option', { name: '40HC' });
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    fireEvent.keyDown(combo, { key: 'Enter' });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('40'));
  });
});

describe('ContainerTypeCellPicker — paired-field Tab hand-off (card 20261002_272)', () => {
  it('bare focus never opens the menu (the 2026-09-21 focus-trigger rejection stands)', () => {
    render(
      <ContainerTypeCellPicker value="" onChange={vi.fn()} options={OPTIONS} fieldId="probe-type-bare" saving={false} />,
    );

    const combo = screen.getByRole('combobox', { name: 'Loại container' });
    combo.focus();
    expect(document.querySelector('[role=listbox]')).toBeNull();
  });

  it('Tab leaving the paired Số container field opens the menu exactly once; pass-through stays closed', async () => {
    const openApiRef = { current: null as { open: () => void } | null };
    render(
      <div>
        {/* The paired field, wired exactly as ShipmentCreateContainerRow wires it. */}
        <input
          aria-label="Số container"
          onKeyDown={(event) => {
            if (event.key === 'Tab' && !event.shiftKey) {
              window.setTimeout(() => openApiRef.current?.open(), 0);
            }
          }}
        />
        <ContainerTypeCellPicker value="" onChange={vi.fn()} options={OPTIONS} fieldId="probe-type-handoff" saving={false} openApiRef={openApiRef} />
      </div>,
    );

    // Before any Tab the handle exists but nothing is open — bare focus (a
    // pass-through tab lands here too) must stay closed.
    const combo = screen.getByRole('combobox', { name: 'Loại container' });
    combo.focus();
    expect(document.querySelector('[role=listbox]')).toBeNull();

    // Tab on the paired field: focus lands on the picker, then the hand-off
    // opens the menu exactly once.
    fireEvent.keyDown(screen.getByLabelText('Số container'), { key: 'Tab' });
    await waitFor(() => expect(document.querySelector('[role=listbox]')).toBeTruthy());
  });
});

describe('ContainerTypeCellPicker — suggestion menu placement (thẻ 344, feedback Zalo 04/10)', () => {
  it('opens the suggestion menu BELOW the input, never upward over the row above', async () => {
    const onChange = vi.fn();
    render(
      <ContainerTypeCellPicker value="" onChange={onChange} options={OPTIONS} fieldId="probe-type-placement" saving={false} />,
    );

    const combo = screen.getByRole('combobox', { name: 'Loại container' });
    fireEvent.click(combo);
    await screen.findByRole('option', { name: '20DC' });

    // RAC stamps the computed placement on the popover wrapper. The customer
    // report ("dropdown ~200px above the field, over the Loại hàng row") was a
    // popover opening upward — the contract is bottom, flipping upward only
    // via shouldFlip when there is no room below.
    const popover = document.querySelector('[data-placement]');
    expect(popover?.getAttribute('data-placement')).toMatch(/^bottom/);
  });
});

/**
 * SIL-152 (board, theo dõi sau SIL-68/CUS-04): gõ đè lên lựa chọn ĐÃ CHỌN.
 * The non-searchable `openOnType` branch used to feed the committed label
 * back as the controlled inputValue, so every keystroke over an existing
 * pick was reverted (typed '4' over '20DC' snapped back to '20DC') and the
 * draft never reached the menu filter. These pin the draft/committed split:
 * typing owns a DRAFT; only a pick (or external reset/blur settle) writes
 * the committed label back into the input.
 */
describe('ContainerTypeCellPicker — gõ đè lựa chọn đã chọn (SIL-152)', () => {
  function Harness({ initial }: { initial: string }) {
    // Mirrors the create form: the picker's onChange IS the row state write.
    const [value, setValue] = useState(initial);
    return (
      <div>
        <ContainerTypeCellPicker value={value} onChange={setValue} options={OPTIONS} fieldId="sil152-picker" saving={false} />
        <output aria-label="Committed loại container">{value}</output>
      </div>
    );
  }

  it('chọn 20DC → gõ đè "4" → chọn 40HC: giá trị MỚI thắng (draft không bị revert)', async () => {
    render(<Harness initial="" />);

    const combo = screen.getByRole('combobox', { name: 'Loại container' }) as HTMLInputElement;
    // First pick: 20DC (the ticket's entry state).
    combo.focus();
    fireEvent.change(combo, { target: { value: '2' } });
    fireEvent.click(await screen.findByRole('option', { name: '20DC' }));
    await waitFor(() => expect(screen.getByLabelText('Committed loại container').textContent).toBe('20'));
    expect(combo.value).toBe('20DC');

    // Gõ đè: the typed text must own the input — NOT revert to '20DC'.
    fireEvent.change(combo, { target: { value: '4' } });
    expect(combo.value).toBe('4');
    // The menu filter follows the draft: 40HC reachable, 20DC gone.
    expect(await screen.findByRole('option', { name: '40HC' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '20DC' })).toBeNull();

    // Chọn lại: the NEW pick commits and displays.
    fireEvent.click(screen.getByRole('option', { name: '40HC' }));
    await waitFor(() => expect(screen.getByLabelText('Committed loại container').textContent).toBe('40'));
    await waitFor(() => expect(combo.value).toBe('40HC'));
  });

  it('keyboard path: gõ đè "4" rồi Enter commit từ danh sách đã lọc theo draft', async () => {
    render(<Harness initial="20" />);
    const combo = screen.getByRole('combobox', { name: 'Loại container' }) as HTMLInputElement;
    expect(combo.value).toBe('20DC');

    combo.focus();
    fireEvent.change(combo, { target: { value: '4' } });
    expect(await screen.findByRole('option', { name: '40HC' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '20DC' })).toBeNull();

    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    fireEvent.keyDown(combo, { key: 'Enter' });
    // Commits an option from the '4'-filtered set — never the stale 20DC.
    const committed = await waitFor(() => {
      const text = screen.getByLabelText('Committed loại container').textContent;
      expect(text).not.toBe('20');
      expect(text).toMatch(/40|45/);
      return text;
    });
    expect(['40', '45']).toContain(committed);
  });

  it('gõ rồi blur KHÔNG chọn: label của lựa chọn đã commit được phục hồi', async () => {
    render(<Harness initial="20" />);
    const combo = screen.getByRole('combobox', { name: 'Loại container' }) as HTMLInputElement;

    combo.focus();
    fireEvent.change(combo, { target: { value: '4' } });
    expect(combo.value).toBe('4');

    fireEvent.blur(combo);
    // The committed pick's label wins back once the typing session ends.
    await waitFor(() => expect(combo.value).toBe('20DC'));
    expect(screen.getByLabelText('Committed loại container').textContent).toBe('20');
  });

  it('chọn lại CHÍNH lựa chọn đang có: giá trị giữ nguyên, label phục hồi', async () => {
    render(<Harness initial="20" />);
    const combo = screen.getByRole('combobox', { name: 'Loại container' }) as HTMLInputElement;

    combo.focus();
    fireEvent.change(combo, { target: { value: '2' } });
    fireEvent.click(await screen.findByRole('option', { name: '20DC' }));

    // Same-id pick: no state change, but the half-typed draft must not linger.
    await waitFor(() => expect(combo.value).toBe('20DC'));
    expect(screen.getByLabelText('Committed loại container').textContent).toBe('20');
  });
});
