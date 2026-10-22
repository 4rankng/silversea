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
import { USearchableField } from './uui-searchable-field';

const WAREHOUSES = [
  { value: '11', label: 'GLC', searchText: 'KHO-GLC Kho GLC KCN Gián Khẩu' },
  { value: '12', label: 'Kho Sóng Thần', searchText: 'KHO-SONG-THAN Kho Sóng Thần Bình Dương' },
];

/** Mirrors the real kho field: the passthrough resolves an exact option-label
 *  match to the site id, anything else clears the id (hybrid storage). */
function KhoHarness(props: { onChange?: (value: string) => void } = {}) {
  const [value, setValue] = useState('');
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
});
