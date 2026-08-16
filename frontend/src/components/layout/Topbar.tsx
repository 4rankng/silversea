import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Calendar } from 'lucide-react';
import { useSalaryPeriod } from '../../hooks/useCatalogQueries';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useMonth } from '../../hooks/useMonth';
import { useSearch } from '../../context/SearchContext';
import { getSearchItems, filterItems } from '../../data/searchRegistry';
import type { SearchItem } from '../../data/searchRegistry';
import { SearchDropdown } from '../SearchDropdown';
import type { TopbarProps } from './types';
import { NotificationBell } from './NotificationBell';
import { AgentAssistant } from '../agent/AgentAssistant';
import { useTopbarEntrance } from '../../hooks/useTopbarEntrance';

const MONTHS = [
  { m: 1, short: 'T1', name: 'Tháng 1' }, { m: 2, short: 'T2', name: 'Tháng 2' }, { m: 3, short: 'T3', name: 'Tháng 3' },
  { m: 4, short: 'T4', name: 'Tháng 4' }, { m: 5, short: 'T5', name: 'Tháng 5' }, { m: 6, short: 'T6', name: 'Tháng 6' },
  { m: 7, short: 'T7', name: 'Tháng 7' }, { m: 8, short: 'T8', name: 'Tháng 8' }, { m: 9, short: 'T9', name: 'Tháng 9' },
  { m: 10, short: 'T10', name: 'Tháng 10' }, { m: 11, short: 'T11', name: 'Tháng 11' }, { m: 12, short: 'T12', name: 'Tháng 12' },
];

/** Clickable month chip in the topbar — opens a month/year grid picker */
function MonthNavigator() {
  const { month, year, setMonthYear } = useMonth();
  const [open, setOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(year);
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setOpen(false), { escapeKey: true, enabled: open });
  useFocusTrap(pickerRef, open);

  const { data: period } = useSalaryPeriod(month, year);
  const periodLabel = period
    ? `${period.start.slice(8, 10)}/${period.start.slice(5, 7)} – ${period.end.slice(8, 10)}/${period.end.slice(5, 7)}`
    : null;

  useEffect(() => {
    if (open) setPickerYear(year);
  }, [open, year]);

  const months = MONTHS;

  const now = new Date();
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  return (
    <div className={`topbar-date ${open ? 'is-open' : ''}`} ref={containerRef}>
      <button
        type="button"
        className="topbar-date__trigger"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Chọn tháng"
      >
        <Calendar size={14} className="topbar-date__icon" />
        <div className="topbar-date__body">
          <span className="topbar-date__label">Tháng {month}/{year}</span>
          {periodLabel && <span className="topbar-date__period">{periodLabel}</span>}
        </div>
        <ChevronDown size={12} className="topbar-date__caret" />
      </button>

      {open && (
        <div className="month-picker" role="dialog" aria-label="Chọn tháng" ref={pickerRef}>
          <div className="month-picker__title">
            <span>Chọn kỳ làm việc</span>
            <small>Đổi tháng cho toàn bộ báo cáo</small>
          </div>
          <div className="month-picker__header">
            <button
              type="button"
              className="month-picker__year-nav"
              onClick={() => setPickerYear(y => y - 1)}
              aria-label="Năm trước"
            >
              <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <span className="month-picker__year">Năm {pickerYear}</span>
            <button
              type="button"
              className="month-picker__year-nav"
              onClick={() => setPickerYear(y => y + 1)}
              aria-label="Năm sau"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="month-picker__grid">
            {months.map(({ m, short, name }) => {
              const isSelected = m === month && pickerYear === year;
              const isThisMonth = pickerYear === now.getFullYear() && m === now.getMonth() + 1;
              return (
                <button
                  key={m}
                  type="button"
                  className={[
                    'month-picker__cell',
                    isSelected ? 'is-selected' : '',
                    isThisMonth && !isSelected ? 'is-current' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    setMonthYear(m, pickerYear);
                    setOpen(false);
                  }}
                >
                  <span className="month-picker__cell-code">{short}</span>
                  <span className="month-picker__cell-name">{name}</span>
                </button>
              );
            })}
          </div>
          <div className="month-picker__footer">
            <button
              type="button"
              className="month-picker__today"
              onClick={() => {
                const n = new Date();
                setMonthYear(n.getMonth() + 1, n.getFullYear());
                setOpen(false);
              }}
            >
              Hôm nay
            </button>
            <span className="month-picker__hint">
              {isCurrentMonth ? 'Đang chọn tháng hiện tại' : `Đang xem T${month}/${year}`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export { MonthNavigator };

function Topbar({
  user,
  isDriver,
  sidebarOpen,
  menuButtonRef,
  onToggleSidebar,
}: TopbarProps) {
  const topbarRef = useTopbarEntrance();
  const navigate = useNavigate();
  const { searchQuery, setSearchQuery } = useSearch();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useClickOutside(searchContainerRef, () => setSearchQuery(''), { enabled: searchQuery.length > 0 });

  const roleItems = React.useMemo(
    () => getSearchItems(user.role, user.capabilities),
    [user.capabilities, user.role],
  );
  const matchedItems = React.useMemo(() => filterItems(roleItems, searchQuery), [roleItems, searchQuery]);
  const canUseNotifications = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'DRIVER', 'OPS'].includes(user.role);

  React.useEffect(() => { setActiveIndex(0); }, [searchQuery]);

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, matchedItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = matchedItems[activeIndex];
      if (item) {
        navigate(item.path);
        setSearchQuery('');
        searchInputRef.current?.blur();
      }
    } else if (e.key === 'Escape') {
      setSearchQuery('');
      searchInputRef.current?.blur();
    }
  }

  function handleSearchSelect(item: SearchItem) {
    navigate(item.path);
    setSearchQuery('');
    searchInputRef.current?.blur();
  }

  return (
    <header ref={topbarRef as React.RefObject<HTMLElement>} className={`topbar ${isDriver ? 'topbar--driver' : ''}`}>
      {!isDriver && (
        <button
          ref={menuButtonRef}
          className="topbar__toggle"
          aria-label={sidebarOpen ? 'Đóng menu điều hướng' : 'Mở menu điều hướng'}
          aria-expanded={sidebarOpen}
          aria-controls="sidebar-navigation"
          title="Ẩn / hiện menu"
          onClick={onToggleSidebar}
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      )}

      {!isDriver && (
        <div ref={searchContainerRef} className="topbar__search" style={{ position: 'relative' }}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            ref={searchInputRef}
            type="text"
            aria-label="Tìm trang, cấu hình hoặc thao tác"
            placeholder="Tìm trang, cấu hình, thao tác…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {searchQuery.length > 0 && (
            <SearchDropdown
              items={matchedItems}
              query={searchQuery}
              activeIndex={activeIndex}
              onSelect={handleSearchSelect}
              onHover={setActiveIndex}
            />
          )}
        </div>
      )}

      {isDriver && (
        <>
          <div className="topbar__left-driver">
            <div className="topbar__welcome">
              <span className="greeting">Xin chào,</span>
              <span className="name">{user.fullName || user.username}</span>
            </div>
          </div>
          <div className="topbar__center-driver">
            <MonthNavigator />
          </div>
        </>
      )}

      <div className="topbar__actions">
        {!isDriver && <MonthNavigator />}
        {canUseNotifications && <NotificationBell />}
        <AgentAssistant />
      </div>
    </header>
  );
}

export { Topbar };
