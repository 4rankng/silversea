import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
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

describe('SIL-152: typing over an existing Loại cont pick must not revert to the old label', () => {
  it('keeps the typed text in the input instead of re-asserting the old pick label', () => {
    renderAddRow({ containerTypeId: '20' });

    expect(combo().value).toBe('20DC');
    combo().focus();
    // Type over the committed pick — the old controlled-label wiring snapped
    // the input back to '20DC' on every keystroke.
    fireEvent.change(combo(), { target: { value: '4' } });
    expect(combo().value).toBe('4');
    // The filter follows the typed text, not the stale pick.
    expect(screen.queryByRole('option', { name: '20DC' })).toBeNull();
    expect(screen.getByRole('option', { name: '40HC' })).toBeTruthy();
  });

  it('committing the typed-over pick hands the NEW type id to the row', async () => {
    const { onChange } = renderAddRow({ containerTypeId: '20' });

    combo().focus();
    fireEvent.change(combo(), { target: { value: '4' } });
    await screen.findByRole('option', { name: '40HC' });
    fireEvent.keyDown(combo(), { key: 'ArrowDown' });
    fireEvent.keyDown(combo(), { key: 'Enter' });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ containerTypeId: '40' }));
    await waitFor(() => expect(combo().value).toBe('40HC'));
  });
});

/**
 * SIL-152 (theo dõi SIL-68, lane fix-cont-combobox-revert / SIL-163): gõ đè
 * lên lựa chọn ĐÃ CHỌN phải giữ text vừa gõ và chọn loại MỚI được — không
 * revert label cũ. Shared root cause with the create flow's cell: the
 * non-searchable openOnType branch fed the committed label back as the
 * controlled inputValue. These complement the lean pins above: parent-state
 * commit flip, blur restore, and the create-surface twin lives in
 * ContainerTypeCellPicker.test.tsx.
 */
describe('SIL-152: add-row Loại cont — gõ đè lựa chọn đã chọn (SIL-163 lane pins)', () => {
  function AddRowHarness({ initialTypeId }: { initialTypeId: string }) {
    const [fields, setFields] = useState<AddContainerFields>({ ...EMPTY_ADD_FIELDS, containerTypeId: initialTypeId });
    return (
      <table>
        <tbody>
          <CusContainerAddRow
            fields={fields}
            containerTypes={TYPES}
            adding={false}
            onChange={(patch) => setFields((prev) => ({ ...prev, ...patch }))}
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
          />
        </tbody>
      </table>
    );
  }

  it('đã chọn 20DC, gõ "4" → text giữ nguyên, lọc còn 40HC, chọn 40HC commit id MỚI', async () => {
    render(<AddRowHarness initialTypeId="20" />);
    const combo = screen.getByRole('combobox', { name: 'Loại cont' }) as HTMLInputElement;
    expect(combo.value).toBe('20DC');

    // Gõ đè: the draft owns the input (the old build reverted to '20DC').
    combo.focus();
    fireEvent.change(combo, { target: { value: '4' } });
    expect(combo.value).toBe('4');
    // Filter follows the draft: 40HC reachable, 20DC hidden.
    expect(await screen.findByRole('option', { name: '40HC' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '20DC' })).toBeNull();

    // Chọn lại 40HC: the NEW id replaces the old one.
    fireEvent.click(screen.getByRole('option', { name: '40HC' }));
    await waitFor(() => expect(combo.value).toBe('40HC'));
  });

  it('gõ "4" rồi Enter commit từ danh sách đã lọc — không còn "revert về label cũ"', async () => {
    render(<AddRowHarness initialTypeId="20" />);
    const combo = screen.getByRole('combobox', { name: 'Loại cont' }) as HTMLInputElement;

    combo.focus();
    fireEvent.change(combo, { target: { value: '4' } });
    expect(await screen.findByRole('option', { name: '40HC' })).toBeTruthy();

    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    fireEvent.keyDown(combo, { key: 'Enter' });
    await waitFor(() => expect(combo.value).not.toBe('20DC'));
    expect(combo.value).toMatch(/40|45/);
  });

  it('gõ rồi blur không chọn: phục hồi label của lựa chọn đã commit', async () => {
    render(<AddRowHarness initialTypeId="20" />);
    const combo = screen.getByRole('combobox', { name: 'Loại cont' }) as HTMLInputElement;

    combo.focus();
    fireEvent.change(combo, { target: { value: '4' } });
    expect(combo.value).toBe('4');

    fireEvent.blur(combo);
    await waitFor(() => expect(combo.value).toBe('20DC'));
  });
});
