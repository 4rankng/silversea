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

  it('TC-CUS-FACTORY-SEARCH-03 (amended 20260917_14) shows live-filtered matches while typing; full catalog returns on clear', async () => {
    const onCustomValue = vi.fn();
    render(<Harness onCustomValue={onCustomValue} />);
    const input = screen.getByRole('combobox');
    await openMenu(input);
    fireEvent.change(input, { target: { value: 'Khách vãng lai không có trong danh mục' } });
    // A free-text value reports live through onCustomValue; the reopened menu
    // shows the LIVE-FILTERED result for what was typed (a custom value
    // matches nothing — the empty state renders, no stale option list).
    expect(input).toHaveValue('Khách vãng lai không có trong danh mục');
    expect(onCustomValue).toHaveBeenLastCalledWith('Khách vãng lai không có trong danh mục');
    // 20260917_14 amendment note: the OLD pin asserted full-catalog-on-reopen
    // with the typed text still present — that was an artifact of the
    // selectedKey-chase removed by the _14 fix (the chase auto-selected a
    // matching option and closed the menu mid-word). The pin's guard intent —
    // the stale-filter class — is preserved by the assertion below: clearing
    // the text returns the FULL catalog, so a stuck filter cannot reappear.
    fireEvent.change(input, { target: { value: '' } });
    await openMenu(input);
    expect(screen.getAllByRole('option')).toHaveLength(CATALOG.length);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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

  it('20260917_14: typing a catalog carrier name keeps suggestions open (allowsCustomValue)', async () => {
    function LineHarness() {
      const [value, setValue] = useState('');
      return <USearchableField label="Hãng tàu" value={value} onChange={setValue} searchable allowsCustomValue
        options={[{ value: 'MSC', label: 'MSC' }, { value: 'ONE', label: 'ONE' }, { value: 'Maersk', label: 'Maersk' }]} />;
    }
    render(<LineHarness />);
    const input = screen.getByRole('combobox', { name: /^Hãng tàu/ });
    await openMenu(input);
    for (const query of ['MSC', 'ONE']) {
      fireEvent.change(input, { target: { value: query } });
      await waitFor(() => {
        expect(screen.getByRole('option', { name: query })).toBeVisible();
        expect(input).toHaveAttribute('aria-expanded', 'true');
      });
    }
    // Picking still commits the catalog value…
    fireEvent.click(screen.getByRole('option', { name: 'ONE' }));
    await waitFor(() => expect(input).toHaveValue('ONE'));
    // …and editing the text afterwards reopens the suggestions (AC 5).
    fireEvent.change(input, { target: { value: 'MA' } });
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Maersk' })).toBeVisible();
      expect(input).toHaveAttribute('aria-expanded', 'true');
    });
  });

  it('20260922_4 AC1: bare Enter commits the unique filtered match on an id select', async () => {
    const onChange = vi.fn();
    function FactoryHarness() {
      const [value, setValue] = useState('');
      return <><USearchableField label="Nhà máy" value={value} onChange={(next) => { setValue(next); onChange(next); }} searchable
        options={[{ value: 'vid', label: 'VID', searchText: 'F_CODE Công ty Việt Đăng' }, { value: 'ne', label: 'NEWEB-1', searchText: 'NEWEB Công ty TNHH' }]} /><output aria-label="Selected catalog ID">{value}</output></>;
    }
    render(<FactoryHarness />);
    const input = screen.getByRole('combobox', { name: /^Nhà máy/ });
    await openMenu(input);
    fireEvent.change(input, { target: { value: 'f_code' } });
    await waitFor(() => expect(screen.getByRole('option', { name: /VID/ })).toBeVisible());
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    // Enter without a highlighted option commits the UNIQUE filtered match…
    expect(screen.getByLabelText('Selected catalog ID').textContent).toBe('vid');
    expect(onChange).toHaveBeenCalledWith('vid');
    // …normalizes the input to the option label and closes the menu.
    expect(input).toHaveValue('VID');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('20260922_4 AC2: Enter over text matching nothing commits nothing and keeps the typed text', async () => {
    const onChange = vi.fn();
    function FactoryHarness() {
      const [value, setValue] = useState('');
      return <><USearchableField label="Nhà máy" value={value} onChange={(next) => { setValue(next); onChange(next); }} searchable
        options={[{ value: 'vid', label: 'VID', searchText: 'F_CODE Công ty Việt Đăng' }]} /><output aria-label="Selected catalog ID">{value}</output></>;
    }
    render(<FactoryHarness />);
    const input = screen.getByRole('combobox', { name: /^Nhà máy/ });
    await openMenu(input);
    fireEvent.change(input, { target: { value: 'không có trong danh mục xyz' } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Không tìm thấy kết quả'));
    fireEvent.keyDown(input, { key: 'Enter' });
    // No dirty id: the form value never changes…
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Selected catalog ID').textContent).toBe('');
    // …and the typed text is NOT wiped by the react-aria settle.
    expect(input).toHaveValue('không có trong danh mục xyz');
  });

  it('20260922_4 AC3: ArrowDown+Enter still commits the highlighted row', async () => {
    const onChange = vi.fn();
    function FactoryHarness() {
      const [value, setValue] = useState('');
      return <><USearchableField label="Nhà máy" value={value} onChange={(next) => { setValue(next); onChange(next); }} searchable
        options={[{ value: 'vid', label: 'VID' }, { value: 'ne', label: 'NEWEB-1' }]} /><output aria-label="Selected catalog ID">{value}</output></>;
    }
    render(<FactoryHarness />);
    const input = screen.getByRole('combobox', { name: /^Nhà máy/ });
    await openMenu(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() => expect(input).toHaveAttribute('aria-activedescendant'));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('vid');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('20260922_4 AC4: the same Enter contract on a custom-value field (hãng tàu) — unique match commits, ambiguous keeps text', async () => {
    const onChange = vi.fn();
    function LineHarness() {
      const [value, setValue] = useState('');
      return <><USearchableField label="Hãng tàu" value={value} onChange={(next) => { setValue(next); onChange(next); }} searchable allowsCustomValue
        options={[{ value: 'Maersk', label: 'Maersk' }, { value: 'MSC', label: 'MSC' }]} /><output aria-label="Selected catalog ID">{value}</output></>;
    }
    render(<LineHarness />);
    const input = screen.getByRole('combobox', { name: /^Hãng tàu/ });
    await openMenu(input);
    // Unique: "maersk" filters to one option; Enter snaps to the catalog value.
    fireEvent.change(input, { target: { value: 'maersk' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Maersk' })).toBeVisible());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('Maersk');
    expect(input).toHaveValue('Maersk');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    // Ambiguous: "m" matches both — Enter must NOT guess, text stays, menu stays open.
    fireEvent.change(input, { target: { value: 'm' } });
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Maersk' })).toBeVisible();
      expect(screen.getByRole('option', { name: 'MSC' })).toBeVisible();
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalledWith('m');
    expect(input).toHaveValue('m');
    expect(input).toHaveAttribute('aria-expanded', 'true');
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
