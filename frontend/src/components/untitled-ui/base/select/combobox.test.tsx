import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
