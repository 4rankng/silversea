// TiepVu22Oct-3 (stale-state race, residual of card 261022213755b): a LIVE
// typing session owns the visible input text. The kho passthrough
// (createAdhocFieldLogic.warehouseCustomText) clears the form id on every
// non-matching keystroke — value: id → '' — and the sync effect used to
// answer that flip with setInputValue(''), eating the user's newest
// keystroke. Typing the full label "GLC" over an existing pick ("Kho ST")
// left the field showing "LC": an older state transition overwrote newer
// typed text (the same family as a stale-response race, on the form-value
// roundtrip instead of HTTP). These tests pin the typing-session law.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { USearchableField } from './uui-searchable-field';
import { matchesComboboxSearch } from '../../../components/untitled-ui/base/select/combobox';

const WAREHOUSES = [
  { value: '11', label: 'GLC', searchText: 'GLC Bãi GLC KCN Đình Vũ' },
  { value: '12', label: 'Kho ST', searchText: 'KHO-SONG-THAN Kho Sóng Thần Bình Dương' },
  { value: '13', label: 'Kho Bắc Hà Nội', searchText: 'KHO-BAC Kho Bắc Hà Nội' },
];

/** Mirrors the real kho field INCLUDING the non-match branch: the passthrough
 * resolves an exact option-label match to the site id, anything else CLEARS
 * the id (hybrid storage — createAdhocFieldLogic.warehouseCustomText). */
function KhoHarness(props: { startValue?: string; onChange?: (value: string) => void } = {}) {
  const [value, setValue] = useState(props.startValue ?? '');
  const onCustomValue = (text: string) => {
    const match = WAREHOUSES.find((w) => w.label === text);
    setValue(match ? match.value : '');
  };
  return <USearchableField label="Kho lấy hàng" value={value}
    onChange={(next) => { setValue(next); props.onChange?.(next); }}
    searchable allowsCustomValue onCustomValue={onCustomValue} options={WAREHOUSES} />;
}

async function openMenu(input: HTMLElement) {
  await act(async () => {
    input.focus();
    fireEvent.focusIn(input);
    fireEvent.click(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function type(input: HTMLElement, text: string) {
  await act(async () => { fireEvent.change(input, { target: { value: text } }); });
}

describe('USearchableField — typing session owns the visible text (TiepVu22Oct-3)', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      return DOMRect.fromRect({ x: 200, y: 470, width: 160, height: 36 });
    });
  });

  it('typing the full label over an EXISTING pick preserves every keystroke', async () => {
    const onChange = vi.fn();
    render(<KhoHarness startValue="12" onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /Kho lấy hàng/ });
    await openMenu(input);
    // Select-all then G → GL → GLC: each keystroke must survive the id→''
    // flip the passthrough fires on 'G' (the old code reset the field to ''
    // right here — the user typed "GLC" and the field showed "LC").
    fireEvent.keyDown(input, { key: 'a', metaKey: true });
    for (const [typed, expected] of [['G', 'G'], ['GL', 'GL'], ['GLC', 'GLC']] as const) {
      await type(input, typed);
      await waitFor(() => {
        expect(input).toHaveValue(expected);
        expect(input).toHaveAttribute('aria-expanded', 'true');
      });
      if (typed === 'GLC') {
        await waitFor(() => expect(screen.getByRole('option', { name: /GLC/ })).toBeVisible());
      }
    }
  });

  it('typing a NON-matching replacement over a pick keeps the full text and the menu open', async () => {
    render(<KhoHarness startValue="12" />);
    const input = screen.getByRole('combobox', { name: /Kho lấy hàng/ });
    await openMenu(input);
    for (const typed of ['X', 'XY', 'XYZ']) {
      await type(input, typed);
      await waitFor(() => {
        expect(input).toHaveValue(typed);
        expect(input).toHaveAttribute('aria-expanded', 'true');
      });
    }
  });

  it('a real pick after retyping over a pick commits the new catalog id', async () => {
    const onChange = vi.fn();
    render(<KhoHarness startValue="12" onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /Kho lấy hàng/ });
    await openMenu(input);
    await type(input, 'GLC');
    await waitFor(() => expect(screen.getByRole('option', { name: /GLC/ })).toBeVisible());
    fireEvent.click(screen.getByRole('option', { name: /GLC/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('11'));
    expect(input).toHaveValue('GLC');
  });

  it('a bare-Enter commit ends the typing session (later external value changes sync normally)', async () => {
    const onChange = vi.fn();
    render(<KhoHarness onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /Kho lấy hàng/ });
    await openMenu(input);
    await type(input, 'GLC');
    await waitFor(() => expect(screen.getByRole('option', { name: /GLC/ })).toBeVisible());
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('11');
      expect(input).toHaveAttribute('aria-expanded', 'false');
    });
    expect(input).toHaveValue('GLC');
  });

  it('the typing-session guard never touches non-custom searchable fields (id-only contract)', async () => {
    // Id-only fields (no allowsCustomValue) have no passthrough — their sync
    // behavior must stay exactly as before: external value changes adopt the
    // option label into the input.
    const { rerender } = render(
      <USearchableField label="Tuyến" value="" onChange={() => {}} searchable
        options={[{ value: 't1', label: 'Tuyến 1' }]} />,
    );
    rerender(
      <USearchableField label="Tuyến" value="t1" onChange={() => {}} searchable
        options={[{ value: 't1', label: 'Tuyến 1' }]} />,
    );
    const input = screen.getByRole('combobox', { name: /Tuyến/ });
    await waitFor(() => expect(input).toHaveValue('Tuyến 1'));
  });
});

describe('matchesComboboxSearch — Vietnamese diacritic normalization (TiepVu22Oct-3 regression)', () => {
  it('typed diacritics match through normalization (Bắc → bac)', () => {
    expect(matchesComboboxSearch('Kho Bắc Hà Nội 13 KHO-BAC', 'Bắc')).toBe(true);
    expect(matchesComboboxSearch('Kho Bắc Hà Nội 13 KHO-BAC', 'bac ha noi')).toBe(true);
  });

  it('diacritic-free query matches diacritic text (Bãi GLC via "bai")', () => {
    expect(matchesComboboxSearch('GLC Bãi GLC KCN Đình Vũ', 'Bãi')).toBe(true);
    expect(matchesComboboxSearch('GLC Bãi GLC KCN Đình Vũ', 'bai glc')).toBe(true);
    expect(matchesComboboxSearch('GLC Bãi GLC KCN Đình Vũ', 'GLC')).toBe(true);
  });

  it('non-matching diacritic queries still exclude (no false positives)', () => {
    expect(matchesComboboxSearch('GLC Bãi GLC KCN Đình Vũ', 'Bắc')).toBe(false);
  });
});
