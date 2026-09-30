import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterDropdown } from './FilterDropdown';
import { FilterBarModeProvider } from '../design-system/filter-bar-mode';

/**
 * Contract tests for the ONE home of secondary filter criteria
 * (card 20260927_152 + the 2026-09-27 operator rulings).
 *
 * These assert the operator-visible promises only — the accessible name, the
 * dialog, and the shape of the scoring row — never CSS text:
 *   - "the width of control should relative to value it holds"
 *   - "can be two rows (Ke hoach values are very short why the fuck full
 *     width)" and "move the buttons same row with ke hoach dropdown, remove the
 *     footer row with text chua dat dieu kien nao".
 */
const renderDialog = (props: Partial<React.ComponentProps<typeof FilterDropdown>> = {}) => {
  const onReset = vi.fn();
  render(
    <FilterDropdown count={0} ariaLabel="Bộ lọc" onReset={onReset} inlineWhenRoom={false} {...props}>
      <div data-testid="criteria">Xuất / Nhập</div>
    </FilterDropdown>,
  );
  return { onReset };
};

describe('FilterDropdown', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports how many criteria are applied in the trigger name, not in a badge only', () => {
    renderDialog({ count: 2 });
    const trigger = screen.getByRole('button', { name: 'Bộ lọc, 2 đang áp dụng' });
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens a dialog, keeps the actions inside the criteria body, and drops the hint row', () => {
    renderDialog({ count: 1 });
    fireEvent.click(screen.getByRole('button', { name: /^Bộ lọc/ }));
    const dialog = screen.getByRole('dialog', { name: 'Bộ lọc nâng cao' });
    const body = dialog.querySelector('.filter-dropdown__body');
    expect(body).toBeTruthy();
    // The criteria AND the actions are siblings in the body — the operator
    // deleted the footer row ("remove the footer row with text chua dat dieu
    // kien nao"), and the buttons now share the last criteria line.
    expect(within(body as HTMLElement).getByTestId('criteria')).toBeTruthy();
    const actions = (body as HTMLElement).querySelector('.filter-dropdown__actions');
    expect(actions).toBeTruthy();
    expect(within(actions as HTMLElement).getByRole('button', { name: 'Đặt lại' })).toBeTruthy();
    expect(within(actions as HTMLElement).getByRole('button', { name: 'Áp dụng' })).toBeTruthy();
    expect(dialog.querySelector('.filter-dropdown__footer')).toBeNull();
    expect(dialog.textContent).not.toContain('Chưa chọn điều kiện nào');
  });

  it('resets the secondary criteria without closing, and closes on Áp dụng', () => {
    const { onReset } = renderDialog({ count: 3 });
    fireEvent.click(screen.getByRole('button', { name: /^Bộ lọc/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    renderDialog();
    const trigger = screen.getByRole('button', { name: 'Bộ lọc' });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('renders the criteria inline — no trigger, no second copy of the ids — while the bar holds two rows', () => {
    // Outside a bar there is nothing to measure, so the default is the dialog;
    // the inline path is driven by the bar's own measurement.
    render(
      <FilterBarModeProvider value="inline">
        <FilterDropdown count={1} ariaLabel="Bộ lọc" onReset={vi.fn()} inlineWhenRoom>
          <div data-testid="criteria">Kế hoạch</div>
        </FilterDropdown>
      </FilterBarModeProvider>,
    );
    expect(screen.getByTestId('criteria')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Bộ lọc/ })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not dismiss when a criterion popover PORTALED to body is used (card _202)', () => {
    // The criteria portal their own popovers (`.searchable-select__popover`,
    // `[role="listbox"]`, the date picker) to document.body, so they are not
    // inside the panel. Before _202 a pointerdown on one of those options read
    // as an outside press: the dialog closed on pointerdown, the listbox
    // unmounted before the click landed, and the pick was silently DISCARDED —
    // the filter looked alive and did nothing.
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /^Bộ lọc/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    const listbox = document.createElement('ul');
    listbox.setAttribute('role', 'listbox');
    const option = document.createElement('li');
    option.setAttribute('role', 'option');
    listbox.append(option);
    document.body.append(listbox);
    // The press lands on a node outside the panel, exactly as a real pick does.
    fireEvent.pointerDown(option);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.pointerDown(listbox);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    // …and a press on dead space still dismisses (see the next case).
    listbox.remove();
  });

  it('still dismisses on a press OUTSIDE the panel and outside any child popover', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /^Bộ lọc/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
