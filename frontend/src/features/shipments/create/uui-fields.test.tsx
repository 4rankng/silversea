// Lệnh chạy ngoài §4.2 combobox contract on the ad-hoc create form's
// USearchableField: type-to-search, diacritic-insensitive filtering through
// the base ComboBox, and free-text passthrough via onCustomValue.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it.each([undefined, 'sm', 'md'] as const)('UI-CD-14 delegates semantic control size %s', (size) => {
    render(<USearchableField label="Nhà máy" size={size} value="" onChange={vi.fn()} options={CATALOG} searchable />);
    expect(screen.getByRole('combobox', { name: 'Nhà máy' }).closest('[data-uui-control]')).toHaveAttribute('data-control-size', size ?? 'sm');
  });

  it.each([false, true])('UI-CD-13 gives one accessible name when hideLabel=%s', (hideLabel) => {
    render(<USearchableField label="Nhà máy" hideLabel={hideLabel} value="" onChange={vi.fn()} options={CATALOG} searchable />);
    expect(screen.getByRole('combobox', { name: 'Nhà máy' })).toBeTruthy();
  });
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

  it('TC-CUS-FACTORY-SEARCH-02 matches code/address searchText without a contradictory no-match hint', async () => {
    function FactoryHarness() {
      const [value, setValue] = useState('');
      return <USearchableField label="Nhà máy" value={value} onChange={setValue} searchable
        options={[{ value: 'vid', label: 'VID', searchText: 'F_CODE Công ty Việt Đăng · KCN Đông Mai' }]} />;
    }
    render(<FactoryHarness />);
    const input = screen.getByRole('combobox', { name: /^Nhà máy/ });
    await openMenu(input);
    for (const query of ['F_CODE', 'dong mai', 'mai VID', '  viet   dang  ']) {
      fireEvent.change(input, { target: { value: query } });
      await waitFor(() => {
        expect(screen.getByRole('option', { name: /VID/ })).toBeVisible();
        expect(screen.queryByText(/Không có kết quả phù hợp/)).not.toBeInTheDocument();
        expect(screen.queryByText('Không tìm thấy kết quả')).not.toBeInTheDocument();
        expect(input).toHaveAttribute('aria-expanded', 'true');
      });
    }
    fireEvent.change(input, { target: { value: 'missing factory xyz' } });
    await waitFor(() => {
      expect(screen.getAllByRole('status')).toHaveLength(1);
      expect(screen.getByRole('status')).toHaveTextContent('Không tìm thấy kết quả');
    });
    fireEvent.change(input, { target: { value: 'F_CODE' } });
    expect(await screen.findByRole('option', { name: /VID/ })).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('TC-CUS-FACTORY-SEARCH-03 preserves custom text without adding a contradictory field warning', async () => {
    const onCustomValue = vi.fn();
    render(<Harness onCustomValue={onCustomValue} />);
    const input = screen.getByRole('combobox');
    await openMenu(input);
    fireEvent.change(input, { target: { value: 'Khách vãng lai không có trong danh mục' } });
    // A free-text value commits through onChange immediately; reopening its
    // manual menu must retain that value while offering catalog alternatives.
    expect(input).toHaveValue('Khách vãng lai không có trong danh mục');
    await openMenu(input);
    expect(screen.getAllByRole('option')).toHaveLength(CATALOG.length);
    expect(screen.queryByText(/Không có kết quả phù hợp/)).not.toBeInTheDocument();
    expect(input).toHaveValue('Khách vãng lai không có trong danh mục');
    expect(onCustomValue).toHaveBeenLastCalledWith('Khách vãng lai không có trong danh mục');
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

  it('20260917_13: long searchText is matched but never rendered in the option DOM', async () => {
    const LONG = 'NEWEB-1 CÔNG TY TNHH NEWEB VIỆT NAM Lô đất CN01, Khu công nghiệp Đồng Văn III, Phường Đồng Văn, Tỉnh Ninh Bình, Việt Nam';
    function FactoryHarness() {
      const [value, setValue] = useState('');
      return <USearchableField label="Nhà máy" value={value} onChange={setValue} searchable
        options={[{ value: 'ne', label: 'NEWEB-1', searchText: LONG }]} />;
    }
    render(<FactoryHarness />);
    const input = screen.getByRole('combobox', { name: /^Nhà máy/ });
    await openMenu(input);
    // The full search chain (code + full name + address) must not leak into
    // the rendered option list — the customer sees only the short name.
    expect(screen.queryByText(LONG)).not.toBeInTheDocument();
    // Typing by address still filters to the factory (AC 2: no search loss).
    fireEvent.change(input, { target: { value: 'Đồng Văn' } });
    expect(await screen.findByRole('option', { name: /NEWEB-1/ })).toBeVisible();
    expect(screen.queryByText(LONG)).not.toBeInTheDocument();
  });

  it('VID-CUS-SELECT-01 clears the selected ID before searching for and choosing a replacement', async () => {
    function CatalogHarness() {
      const [value, setValue] = useState('1');
      return <><USearchableField label="Nhà máy" value={value} onChange={setValue} options={CATALOG} searchable /><output aria-label="Selected catalog ID">{value}</output></>;
    }
    render(<CatalogHarness />);
    const input = screen.getByRole('combobox', { name: /^Nhà máy/ });
    expect(input).toHaveValue('Cảng Hải Phòng');
    await openMenu(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByLabelText('Selected catalog ID').textContent).toBe('');
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'quang minh' } });
    expect(input).toHaveValue('quang minh');
    expect(screen.getByLabelText('Selected catalog ID').textContent).toBe('');
    await openMenu(input);
    fireEvent.click(screen.getByRole('option', { name: /Quang Minh/ }));
    expect(screen.getByLabelText('Selected catalog ID')).toHaveTextContent('2');
    expect(input).toHaveValue('KCN Quang Minh, Bắc Ninh');
  });
});
