// Card 261022213755b (TiepVu 22/10-2, kho GLC): the Kho lấy hàng picker
// configuration — searchable + allowsCustomValue + an onCustomValue
// passthrough that resolves an exact option-label match to the catalog id
// (createAdhocFieldLogic.warehouseCustomText). Typing the FULL label "GLC"
// used to snap the suggestion menu shut mid-word: the id roundtrip re-rendered
// the field with a catalog value, the sync effect adopted it as chosenKey, and
// react-aria read the controlled selectedKey change as a real pick →
// closeMenu — so "gõ GLC đầy đủ không ra, gõ LC lại thấy". These tests pin
// the typing-session law (typedCustomTextRef): a typing-resolved id is never
// a pick, the menu stays open until the user actually picks/commits.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeSearchText } from '../../../components/untitled-ui/base/select/combobox';
import { USearchableField } from './uui-searchable-field';

const WAREHOUSES = [
  { value: '11', label: 'GLC', searchText: 'KHO-GLC Kho GLC KCN Gián Khẩu' },
  { value: '12', label: 'Kho Sóng Thần', searchText: 'KHO-SONG-THAN Kho Sóng Thần Bình Dương' },
];

/** Mirrors the real kho field: the passthrough resolves an exact option-label
 *  match to the site id, anything else clears the id (hybrid storage).
 *  SIL-505: the match is normalization-exact (same law as the dropdown filter
 *  matchesComboboxSearch, unit-pinned in create-adhoc-field-logic.test.ts) —
 *  typing 'glc' resolves the 'GLC' catalog row. The live form id is exposed
 *  as a probe: the passthrough flip writes the harness state directly and
 *  never rides the selection onChange channel. */
function KhoHarness(props: { onChange?: (value: string) => void } = {}) {
  const [value, setValue] = useState('');
  const onCustomValue = (text: string) => {
    const match = WAREHOUSES.find((w) => normalizeSearchText(w.label) === normalizeSearchText(text));
    setValue(match ? match.value : '');
  };
  return (
    <div>
      <span data-testid="form-id">{value || '∅'}</span>
      <USearchableField label="Kho lấy hàng" value={value}
        onChange={(next) => { setValue(next); props.onChange?.(next); }}
        searchable allowsCustomValue onCustomValue={onCustomValue} options={WAREHOUSES} />
    </div>
  );
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

describe('USearchableField — exact-label typing (card 261022213755b)', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      return DOMRect.fromRect({ x: 200, y: 470, width: 160, height: 36 });
    });
  });

  it.each(['GLC', 'Glc', 'glc'] as const)(
    'typing the full label %s keeps the kho suggestion menu open with the option visible',
    async (query) => {
      render(<KhoHarness />);
      const input = screen.getByRole('combobox', { name: /Kho lấy hàng/ });
      await openMenu(input);
      // Char-by-char up to the full label — the menu must survive every
      // keystroke, including the one that completes the exact label.
      for (let len = 1; len <= query.length; len += 1) {
        await type(input, query.slice(0, len));
        await waitFor(() => {
          expect(screen.getByRole('option', { name: /GLC/ })).toBeVisible();
          expect(input).toHaveAttribute('aria-expanded', 'true');
        });
      }
    },
  );

  it('prefix "GL" still sees the GLC option (contains/prefix matching unchanged)', async () => {
    render(<KhoHarness />);
    const input = screen.getByRole('combobox', { name: /Kho lấy hàng/ });
    await openMenu(input);
    for (const query of ['G', 'GL']) {
      await type(input, query);
      await waitFor(() => {
        expect(screen.getByRole('option', { name: /GLC/ })).toBeVisible();
        expect(input).toHaveAttribute('aria-expanded', 'true');
      });
    }
  });

  it('a real pick after typing the exact label still commits the catalog id', async () => {
    const onChange = vi.fn();
    render(<KhoHarness onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /Kho lấy hàng/ });
    await openMenu(input);
    await type(input, 'GLC');
    await waitFor(() => expect(screen.getByRole('option', { name: /GLC/ })).toBeVisible());
    fireEvent.click(screen.getByRole('option', { name: /GLC/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('11'));
    expect(input).toHaveValue('GLC');
  });

  it('bare Enter over the exact label still commits the unique match and closes the menu (20260922_4)', async () => {
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

  // ── SIL-505: case-mismatched full typing must resolve AND keep the menu ──
  it.each(['glc', 'Glc'] as const)(
    'typing %s resolves the GLC catalog id mid-word WITHOUT snapping the menu shut',
    async (query) => {
      const onChange = vi.fn();
      render(<KhoHarness onChange={onChange} />);
      const input = screen.getByRole('combobox', { name: /Kho lấy hàng/ });
      await openMenu(input);
      for (let len = 1; len <= query.length; len += 1) {
        await type(input, query.slice(0, len));
        await waitFor(() => {
          // The resolved flip (typed 'glc' → id 11, label 'GLC' ≠ typed text)
          // is a typing session, NEVER a pick: menu open + option visible.
          expect(screen.getByRole('option', { name: /GLC/ })).toBeVisible();
          expect(input).toHaveAttribute('aria-expanded', 'true');
        });
      }
      // Resolution landed in the form (hybrid storage picks the catalog id)…
      await waitFor(() => expect(screen.getByTestId('form-id')).toHaveTextContent('11'));
      // …and the typist still owns the visible text + can pick the option.
      expect(input).toHaveValue(query);
      fireEvent.click(screen.getByRole('option', { name: /GLC/ }));
      await waitFor(() => expect(input).toHaveValue('GLC'));
    },
  );

  it('typing "LC" does NOT resolve any id and the GLC option stays visible', async () => {
    const onChange = vi.fn();
    render(<KhoHarness onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: /Kho lấy hàng/ });
    await openMenu(input);
    for (const text of ['L', 'LC']) {
      await type(input, text);
      await waitFor(() => {
        expect(screen.getByRole('option', { name: /GLC/ })).toBeVisible();
        expect(input).toHaveAttribute('aria-expanded', 'true');
      });
    }
    expect(screen.getByTestId('form-id')).toHaveTextContent('∅');
    expect(input).toHaveValue('LC');
  });
});
