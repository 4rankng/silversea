/**
 * SIL-1294 (id 1594) — global search: the input has no clear (×) button and
 * the "Không có kết quả" box measured 169px tall around one 17px line (the
 * 96px illustration + 24px pads). Contract:
 *   1. a clear (×) appears only while the query is non-empty; clicking it
 *      empties the query and keeps the caret in the field;
 *   2. the empty box hugs its content — small icon + line + one padding step.
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Role } from '@tingting/shared';
import { SearchDropdown } from '../SearchDropdown';

const state = vi.hoisted(() => ({ query: '', setQuery: vi.fn() }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/dashboard' }),
}));
vi.mock('../../context/SearchContext', () => ({
  useSearch: () => ({ searchQuery: state.query, setSearchQuery: state.setQuery }),
}));
vi.mock('../../hooks/useCatalogQueries', () => ({ useSalaryPeriod: () => ({ data: undefined }) }));
vi.mock('../../hooks/useMonth', () => ({ useMonth: () => ({ month: 11, year: 2026, setMonthYear: vi.fn() }) }));
vi.mock('../../hooks/useDriverQueries', () => ({ useDriverVehicle: () => ({ data: null }) }));
vi.mock('../../hooks/useClickOutside', () => ({ useClickOutside: () => {} }));
vi.mock('../../hooks/useFocusTrap', () => ({ useFocusTrap: () => {} }));
vi.mock('../../hooks/usePopoverDialog', () => ({ usePopoverDialog: () => {} }));
vi.mock('../../hooks/useTopbarEntrance', () => ({ useTopbarEntrance: () => ({ current: null }) }));
vi.mock('../../lib/focusRestore', () => ({ restoreFocusTo: vi.fn() }));
vi.mock('./NotificationBell', () => ({ NotificationBell: () => null }));

import { Topbar } from './Topbar';

function renderTopbar() {
  return render(
    <Topbar
      user={{ role: Role.ACCOUNTANT, fullName: 'QA', username: 'qa', capabilities: [] }}
      isDriver={false}
      pageTitle="Tổng quan"
      sidebarOpen
      menuButtonRef={{ current: null }}
      onToggleSidebar={vi.fn()}
    />,
  );
}

describe('SIL-1294 — the global search clear (×)', () => {
  beforeEach(() => {
    state.query = '';
    state.setQuery.mockClear();
  });

  it('renders the clear button only while the query is non-empty', () => {
    const { rerender } = renderTopbar();
    expect(screen.queryByRole('button', { name: 'Xóa tìm kiếm' })).toBeNull();

    state.query = 'P2-K235';
    rerender(
      <Topbar
        user={{ role: Role.ACCOUNTANT, fullName: 'QA', username: 'qa', capabilities: [] }}
        isDriver={false}
        pageTitle="Tổng quan"
        sidebarOpen
        menuButtonRef={{ current: null }}
        onToggleSidebar={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Xóa tìm kiếm' })).toBeTruthy();
  });

  it('empties the query on click and keeps the caret in the field', () => {
    state.query = 'P2-K235';
    renderTopbar();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));
    expect(state.setQuery).toHaveBeenCalledWith('');
    const input = screen.getByRole('textbox', { name: 'Tìm trang, cấu hình hoặc thao tác' });
    expect(document.activeElement).toBe(input);
  });
});

describe('SIL-1294 — the empty result box hugs its content', () => {
  it('renders the small icon + one line inside a single padding step', () => {
    const { container } = render(
      <SearchDropdown items={[]} query="P2-K235" activeIndex={0} onSelect={() => {}} onHover={() => {}} />,
    );
    expect(screen.getByText('Không có kết quả')).toBeTruthy();
    // The 96px illustration was the 169px box's height driver — the icon stays
    // as content-sized art, not a full-width illustration scene.
    const img = container.querySelector('img');
    expect(img?.style.width).toBe('40px');
    expect(img?.style.height).toBe('33px');
    const emptyBox = screen.getByText('Không có kết quả').parentElement as HTMLElement;
    expect(emptyBox.style.padding).toBe('12px 16px');
  });
});
