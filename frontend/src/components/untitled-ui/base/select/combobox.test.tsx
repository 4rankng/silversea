import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComboBox } from './combobox';
import { SelectItem } from './select-item';

describe('ComboBox', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('propagates the compact size contract to its label', () => {
    render(
      <ComboBox label="Khách hàng" size="sm" items={[{ id: '1', label: 'Khách hàng A' }]}>
        {(item) => <SelectItem id={item.id} label={item.label} />}
      </ComboBox>,
    );

    expect(screen.getByText('Khách hàng').closest('[data-input-size="sm"]')).toBeTruthy();
  });

  it('reclaims narrow control width without changing the accessible field or clear action', () => {
    render(<ComboBox label="Cảng nâng" size="sm" items={[{ id: '1', label: 'Cảng Mipec' }]}
      selectedKey="1" onClear={vi.fn()}>
      {(item) => <SelectItem id={item.id} value={item} label={item.label} />}
    </ComboBox>);
    const input = screen.getByRole('combobox', { name: 'Cảng nâng' });
    const boundary = input.closest('.uui-combobox');
    expect(boundary).toHaveAttribute('data-default-search-icon');
    expect(boundary?.querySelector('[data-combobox-search]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Xoá' })).toBeTruthy();
    const css = readFileSync('src/components/untitled-ui/base/select/combobox.css', 'utf8');
    expect(css).toMatch(/container:\s*uui-combobox \/ inline-size/);
    expect(css).toMatch(/@container uui-combobox \(max-width: 192px\)/);
    expect(css).toMatch(/\[data-combobox-search\]\s*\{\s*display: none/);
    expect(css).toMatch(/\[data-default-search-icon\] \[data-combobox-value\]\s*\{\s*gap: 0;\s*padding-inline-start: 6px/);
    expect(css).toMatch(/input\[role='combobox'\]\s*\{\s*padding-inline-start: 0/);
  });

  it('keeps custom semantic leading icons outside the narrow search-icon rule', () => {
    render(<ComboBox label="Nhà máy" icon={<span data-testid="factory-icon">F</span>}
      items={[{ id: '1', label: 'Factory A' }]}>
      {(item) => <SelectItem id={item.id} label={item.label} />}
    </ComboBox>);
    const boundary = screen.getByRole('combobox', { name: 'Nhà máy' }).closest('.uui-combobox');
    expect(boundary).not.toHaveAttribute('data-default-search-icon');
    expect(boundary?.querySelector('[data-combobox-search]')).toBeNull();
    expect(screen.getByTestId('factory-icon')).toBeTruthy();
  });

  // Regression guard for TC-CUS-CREATE-038 (bug 2026-09-08): when a sibling
  // `+ Thêm` button sits directly below the trigger, the popover must
  // request `top` placement so the dropdown opens upward and never covers
  // that sibling. The `popoverPlacement` prop is forwarded to the shared
  // Popover wrapper, which already spreads it onto the AriaPopover — this
  // test verifies the prop reaches the rendered popover element.
  it('forwards `popoverPlacement="top"` to the AriaPopover so the dropdown opens upward', async () => {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    // Pin the trigger mid-viewport (rect.top=470). Without our
    // `popoverPlacement` override, Floating UI's default of "bottom start"
    // covers the sibling "+ Thêm" button below.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      if (this.dataset.comboboxValue !== undefined) {
        return DOMRect.fromRect({ x: 200, y: 470, width: 160, height: 36 });
      }
      return DOMRect.fromRect();
    });

    render(
      <div className="csc-route-picker">
        <ComboBox
          label="Cảng nâng"
          size="sm"
          items={[{ id: '1', label: 'Cảng Mipec' }]}
          popoverPlacement="top"
          menuTrigger="focus"
        >
          {(item) => <SelectItem id={item.id} label={item.label} />}
        </ComboBox>
        <button className="csc-route-picker__add">Thêm</button>
      </div>,
    );

    const input = screen.getByRole('combobox');
    await act(async () => {
      input.focus();
      fireEvent.focusIn(input);
      // Floating UI positions via rAF — flush it.
      await new Promise((r) => setTimeout(r, 0));
    });

    const popover = document.querySelector('[data-placement]');
    expect(popover, 'popover element should render after focus').toBeTruthy();
    expect(popover?.getAttribute('data-placement')).toBe('top');
  });

  // Without the prop, Floating UI is free to choose "bottom" (the default).
  // We assert the bare default is preserved so existing callers that did not
  // opt in keep their original behavior.
  it('defaults to bottom placement when `popoverPlacement` is omitted', async () => {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      if (this.dataset.comboboxValue !== undefined) {
        return DOMRect.fromRect({ x: 200, y: 470, width: 160, height: 36 });
      }
      return DOMRect.fromRect();
    });

    render(
      <ComboBox
        label="Khách hàng"
        size="sm"
        items={[{ id: '1', label: 'Canon VN' }]}
        menuTrigger="focus"
      >
        {(item) => <SelectItem id={item.id} label={item.label} />}
      </ComboBox>,
    );

    const input = screen.getByRole('combobox');
    await act(async () => {
      input.focus();
      fireEvent.focusIn(input);
      await new Promise((r) => setTimeout(r, 0));
    });

    const popover = document.querySelector('[data-placement]');
    expect(popover, 'popover element should render after focus').toBeTruthy();
    expect(popover?.getAttribute('data-placement')).toMatch(/^bottom/);
  });

  // Regression guard for TC-CUS-CREATE-021/022/023 (Customer feedback 2026-09-07):
  // User must be able to click the clear button (X) to clear the selected value.
  it('renders clear button when onClear is provided and a selection exists, and clicking it triggers onClear', async () => {
    const onClear = vi.fn();
    render(
      <ComboBox
        label="Tuyến đường"
        size="sm"
        items={[{ id: 'route-1', label: 'Hà Nội - Hải Phòng' }]}
        selectedKey="route-1"
        onClear={onClear}
      >
        {(item) => <SelectItem id={item.id} value={item} label={item.label} />}
      </ComboBox>,
    );

    const clearButton = screen.getByRole('button', { name: 'Xoá' });
    expect(clearButton).toBeTruthy();

    await act(async () => {
      fireEvent.mouseDown(clearButton);
      fireEvent.mouseUp(clearButton);
      fireEvent.click(clearButton);
    });

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

const FACTORIES = [
  { id: 'vid', label: 'VID', supportingText: 'Công ty Công nghệ Việt Đăng · KCN Đông Mai' },
  { id: 'askey', label: 'ASKEY', supportingText: 'Công ty Askey Việt Nam · Bắc Ninh' },
  { id: 'canon', label: 'CANON', supportingText: 'Công ty Canon · Hà Nội' },
];

function FactorySearchHarness({ initialValue = '' }: { initialValue?: string }) {
  const [selectedKey, setSelectedKey] = useState(initialValue);
  const [inputValue, setInputValue] = useState(FACTORIES.find((factory) => factory.id === initialValue)?.label ?? '');
  return (
    <>
      <ComboBox
        label="Nhà máy"
        items={FACTORIES}
        selectedKey={selectedKey || null}
        inputValue={inputValue}
        onInputChange={setInputValue}
        onSelectionChange={(key) => {
          if (key === null) return;
          setSelectedKey(String(key));
          setInputValue(FACTORIES.find((factory) => factory.id === key)?.label ?? '');
        }}
        menuTrigger="focus"
        openOnPress
      >
        {(item) => <SelectItem id={item.id} value={item} label={item.label} supportingText={item.supportingText} />}
      </ComboBox>
      <output aria-label="Nhà máy đã chọn">{selectedKey}</output>
      <button type="button">Trường kế tiếp</button>
    </>
  );
}

describe('ComboBox factory search while typing', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 200, y: 470, width: 260, height: 36 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function focusFactorySearch() {
    const input = screen.getByRole('combobox', { name: 'Nhà máy' });
    await act(async () => {
      input.focus();
      fireEvent.focusIn(input);
      fireEvent.click(input);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    return input;
  }

  it('preserves committed custom text when Escape dismisses a reopened menu', async () => {
    function CustomShippingLine() {
      const [text, setText] = useState('QA CUSTOM SHIPPING 0917');
      return <><ComboBox label="Nhà máy" items={FACTORIES} selectedKey={text} inputValue={text}
        allowsCustomValue onInputChange={setText} onSelectionChange={() => undefined} openOnPress>
        {(item) => <SelectItem id={item.id} value={item} label={item.label} supportingText={item.supportingText} />}
      </ComboBox><output aria-label="Committed custom value">{text}</output></>;
    }
    render(<CustomShippingLine />);
    const input = await focusFactorySearch();
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'));
    expect(input).toHaveValue('QA CUSTOM SHIPPING 0917');
    expect(screen.getByLabelText('Committed custom value')).toHaveTextContent('QA CUSTOM SHIPPING 0917');
  });

  it('selects the short committed label and restores it without searchable metadata on Escape', async () => {
    render(<FactorySearchHarness initialValue="canon" />);
    const input = await focusFactorySearch() as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('CANON'.length);
    fireEvent.change(input, { target: { value: 'dong mai' } });
    input.setSelectionRange(8, 8);
    fireEvent.focus(input);
    expect(input.selectionStart).toBe(8);
    expect(input.selectionEnd).toBe(8);
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'));
    expect(input).toHaveValue('CANON');
    expect(screen.getByLabelText('Nhà máy đã chọn')).toHaveTextContent('canon');
  });

  it('keeps matching results open while typing leading, trailing and repeated whitespace', async () => {
    render(<FactorySearchHarness />);
    const input = await focusFactorySearch();

    // Never refocus/reopen after input changes: that previously concealed
    // the customer-visible failure when an intermediate query closed the menu.
    for (const query of ['VID', 'VID  ', '  VID  ', '  viet   dang  ', 'mai   vid']) {
      fireEvent.change(input, { target: { value: query } });
      await waitFor(() => {
        expect(input).toHaveValue(query);
        expect(input).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getAllByRole('option')).toHaveLength(1);
        expect(screen.getByRole('option', { name: /VID/ })).toBeTruthy();
      });
    }
  });

  it('searches Vietnamese full names and addresses with or without accents and đ', async () => {
    render(<FactorySearchHarness />);
    const input = await focusFactorySearch();

    for (const query of ['dong mai', 'ĐÔNG MAI', 'Đông Mai'.normalize('NFD'), 'cong nghe viet dang']) {
      fireEvent.change(input, { target: { value: query } });
      expect(await screen.findByRole('option', { name: /VID/ })).toBeTruthy();
      expect(screen.queryByRole('option', { name: /ASKEY/ })).toBeNull();
      expect(input).toHaveAttribute('aria-expanded', 'true');
    }
  });

  it('shows no-results feedback and recovers when the same focused query is corrected or cleared', async () => {
    render(<FactorySearchHarness />);
    const input = await focusFactorySearch();

    fireEvent.change(input, { target: { value: 'missing factory xyz' } });
    expect(await screen.findByText('Không tìm thấy kết quả')).toBeTruthy();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveFocus();
    // React Aria exposes its empty-state explanation as a non-selectable
    // option for screen readers; no catalog option may remain visible.
    expect(screen.queryByRole('option', { name: /VID|ASKEY|CANON/ })).toBeNull();

    fireEvent.change(input, { target: { value: 'vid' } });
    expect(await screen.findByRole('option', { name: /VID/ })).toBeTruthy();
    expect(screen.queryByText('Không tìm thấy kết quả')).toBeNull();

    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the existing selection until a filtered replacement is picked with the keyboard', async () => {
    render(<FactorySearchHarness initialValue="canon" />);
    const input = await focusFactorySearch();

    fireEvent.change(input, { target: { value: ' dong   mai ' } });
    expect(await screen.findByRole('option', { name: /VID/ })).toBeTruthy();
    expect(screen.getByLabelText('Nhà máy đã chọn')).toHaveTextContent('canon');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByLabelText('Nhà máy đã chọn')).toHaveTextContent('vid'));
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect((input as HTMLInputElement).value).toContain('VID');
    fireEvent.blur(input);
    screen.getByRole('button', { name: 'Trường kế tiếp' }).focus();
    expect(screen.getByLabelText('Nhà máy đã chọn')).toHaveTextContent('vid');
    expect((input as HTMLInputElement).value).toContain('VID');
  });
});

describe('ComboBox invalid focus ring', () => {
  it('outlines red when focused while invalid — the brand-green ring never co-renders with the error', () => {
    render(
      <ComboBox label="Khách hàng" isInvalid items={[{ id: '1', label: 'KH A' }]}>
        {(item) => <SelectItem id={item.id} label={item.label} />}
      </ComboBox>,
    );
    const input = screen.getByRole('combobox', { name: 'Khách hàng' });
    act(() => input.focus());
    const group = input.closest('.uui-combobox') as HTMLElement;
    expect(group.className).toContain('outline-error');
    expect(group.className).not.toContain('outline-focus-ring');
    expect(group.className).not.toContain('border-brand');
  });

  it('keeps the green focus ring for a focused valid combobox', () => {
    render(
      <ComboBox label="Hãng tàu" items={[{ id: '1', label: 'SITC' }]}>
        {(item) => <SelectItem id={item.id} label={item.label} />}
      </ComboBox>,
    );
    const input = screen.getByRole('combobox', { name: 'Hãng tàu' });
    act(() => input.focus());
    const group = input.closest('.uui-combobox') as HTMLElement;
    expect(group.className).toContain('outline-focus-ring');
    expect(group.className).toContain('border-brand');
    expect(group.className).not.toContain('outline-error');
  });
});
