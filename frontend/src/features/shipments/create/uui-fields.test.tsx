// Lệnh chạy ngoài §4.2 combobox contract on the ad-hoc create form's
// USearchableField: type-to-search, diacritic-insensitive filtering through
// the base ComboBox, and free-text passthrough via onCustomValue.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { USearchableField } from './uui-fields';
import { normalizeSearchText } from '../../../components/untitled-ui/base/select/combobox';

const CATALOG = [
  { value: '1', label: 'Cảng Hải Phòng' },
  { value: '2', label: 'KCN Quang Minh, Bắc Ninh' },
];

function Harness({ onCustomValue, onChange }: {
  onCustomValue?: (text: string) => void;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <USearchableField
      id="adhoc-customer"
      label="Khách hàng"
      value={value}
      onChange={(next) => { setValue(next); onChange?.(next); }}
      options={CATALOG}
      searchable
      allowsCustomValue
      onCustomValue={onCustomValue}
      placeholder="Chọn hoặc gõ tên mới"
    />
  );
}

async function openMenu(input: HTMLElement) {
  // The wrapper group's openOnPress handler is the deterministic opener in
  // jsdom; focus() + focusIn alone do not flip react-aria's state open here.
  // The timeout flushes Floating UI's rAF so the popover actually mounts.
  await act(async () => {
    input.focus();
    fireEvent.focusIn(input);
    fireEvent.click(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('USearchableField — Lệnh chạy ngoài §4.2', () => {
  beforeEach(() => {
    // react-aria's overlay refuses to mount the listbox in jsdom without a
    // sane viewport + trigger rect (idiom from base/select/combobox.test.tsx).
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      return DOMRect.fromRect({ x: 200, y: 470, width: 160, height: 36 });
    });
  });

  it('reports raw free text through onCustomValue and keeps it in the input', async () => {
    const onCustomValue = vi.fn();
    render(<Harness onCustomValue={onCustomValue} />);

    const input = screen.getByRole('combobox');
    await openMenu(input);
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Khách vãng lai 99' } });
    });
    await openMenu(input);

    expect(onCustomValue).toHaveBeenCalledWith('Khách vãng lai 99');
    // Free text survives the controlled re-render (no blur-required reset).
    expect((input as HTMLInputElement).value).toBe('Khách vãng lai 99');
  });

  it('matches catalog options without requiring diacritics', () => {
    // The base ComboBox listbox filters with this exact normalization
    // (combobox.tsx:198-204) — typing without diacritics must match the
    // Vietnamese catalog labels the ad-hoc form offers.
    const query = normalizeSearchText('hai phong');
    expect(normalizeSearchText('Cảng Hải Phòng').includes(query)).toBe(true);
    expect(normalizeSearchText('KCN Quang Minh, Bắc Ninh').includes(query)).toBe(false);
  });

  it('commits the catalog id when an option is picked', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const input = screen.getByRole('combobox');
    await openMenu(input);
    await act(async () => {
      fireEvent.change(input, { target: { value: 'quang minh' } });
    });
    await openMenu(input);
    fireEvent.click(screen.getByRole('option', { name: /Quang Minh/ }));

    expect(onChange).toHaveBeenCalledWith('2');
  });
});
