import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CusContainerAddRow, EMPTY_ADD_FIELDS, type AddContainerFields } from './CusContainerAddRow';

/**
 * SIL-68 (CUS-04) — TAB sang ô "Loại cont" rồi GÕ phải tự mở danh sách gợi ý
 * (thay vì bắt buộc click chuột). The drawer's add row used a plain select
 * (no suggestion list without a click); it now rides the same type-to-open
 * combobox the create flow's Loại container cell rides (20260921_1 law).
 */
const TYPES = [
  { id: 20, code: '20DC' },
  { id: 40, code: '40HC' },
];

function renderAddRow(fields: Partial<AddContainerFields> = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  render(
    <table>
      <tbody>
        <CusContainerAddRow
          fields={{ ...EMPTY_ADD_FIELDS, ...fields }}
          containerTypes={TYPES}
          adding={false}
          onChange={onChange}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      </tbody>
    </table>,
  );
  return { onChange, onSubmit };
}

const combo = () => screen.getByRole('combobox', { name: 'Loại cont' }) as HTMLInputElement;

describe('SIL-68 (CUS-04): add-row Loại cont type-to-open suggestions', () => {
  it("TAB lands on the combobox; typing '2' opens the list and prefix-filters to 20DC — no mouse click", async () => {
    renderAddRow();

    // Tab-in lands focus (the ticket's entry state: cursor left ô Số cont).
    // Real .focus() so document.activeElement moves — RAC's menu-trigger
    // machinery checks it; bare focus must NOT open the menu.
    combo().focus();
    expect(document.querySelector('[role="listbox"]')).toBeNull();

    // The first typed character opens the suggestion list…
    fireEvent.change(combo(), { target: { value: '2' } });
    expect(await screen.findByRole('option', { name: '20DC' })).toBeTruthy();
    // …and the filter hides the non-matching sibling.
    expect(screen.queryByRole('option', { name: '40HC' })).toBeNull();
  });

  it('picking through the keyboard (ArrowDown + Enter) commits the type id', async () => {
    const { onChange } = renderAddRow();

    combo().focus();
    fireEvent.change(combo(), { target: { value: '2' } });
    await screen.findByRole('option', { name: '20DC' });

    fireEvent.keyDown(combo(), { key: 'ArrowDown' });
    fireEvent.keyDown(combo(), { key: 'Enter' });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ containerTypeId: '20' }));
  });

  it('Enter while the suggestion menu is open picks WITHOUT firing the row submit', async () => {
    const { onSubmit } = renderAddRow();

    combo().focus();
    fireEvent.change(combo(), { target: { value: '2' } });
    await screen.findByRole('option', { name: '20DC' });

    fireEvent.keyDown(combo(), { key: 'ArrowDown' });
    fireEvent.keyDown(combo(), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('option', { name: '20DC' })).toBeNull());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Enter on the resting (menu-closed) combobox still submits the add row — the Enter law survives the swap', () => {
    const { onSubmit } = renderAddRow();

    combo().focus();
    fireEvent.keyDown(combo(), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Enter in the Số container input still submits the row (regression pin)', () => {
    const { onSubmit } = renderAddRow();

    const number = screen.getByLabelText('Số container');
    number.focus();
    fireEvent.keyDown(number, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
