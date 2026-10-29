import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Calendar, Truck, Menu, Search } from 'lucide-react';
import { useSalaryPeriod } from '../../hooks/useCatalogQueries';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { usePopoverDialog } from '../../hooks/usePopoverDialog';
import { useMonth } from '../../hooks/useMonth';
import { restoreFocusTo } from '../../lib/focusRestore';
import { useLocation } from 'react-router-dom';
import { useDriverVehicle } from '../../hooks/useDriverQueries';
import { useSearch } from '../../context/SearchContext';
import { getSearchItems, filterItems } from '../../data/searchRegistry';
import type { SearchItem } from '../../data/searchRegistry';
import { SearchDropdown } from '../SearchDropdown';
import type { TopbarProps } from './types';
import { NotificationBell } from './NotificationBell';
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
  const triggerRef = useRef<HTMLButtonElement>(null);

  // SIL-561 (29/10): every close that restores focus DEFERS one frame — the
  // background sweep marks the trigger inert while open and un-inerts in the
  // close commit, so a synchronous trigger.focus() is refused by the browser
  // and the keyboard landed on <body> (QA-measured on the Escape path).
  const closeAndRestore = () => {
    setOpen(false);
    requestAnimationFrame(() => restoreFocusTo(triggerRef.current));
  };

  // Focus return (SIL-573): Escape and explicit close actions hand focus back
  // to the month trigger; an outside press leaves focus where the user clicked.
  useClickOutside(containerRef, () => setOpen(false), {
    escapeKey: true,
    enabled: open,
    onEscape: closeAndRestore,
  });
  useFocusTrap(pickerRef, open);
  // Modal dialog semantics (SIL-561): the picker already trapped focus and
  // restored it on Escape (SIL-573); the primitive adds the missing legs —
  // aria-modal on the panel and an inert background while it is open. The
  // body-strand restore stays OFF: SIL-573 pins that an outside press leaves
  // focus where the user clicked (this picker's own Escape handler restores).
  usePopoverDialog(pickerRef, triggerRef, open, { restoreOnBody: false });

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
        ref={triggerRef}
        className="topbar-date__trigger"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Chọn tháng · Tháng ${month}/${year}${periodLabel ? `, ${periodLabel}` : ''}`}
      >
        <Calendar size={14} className="topbar-date__icon" />
        <span className="topbar-date__label">Tháng {month}/{year}</span>
        {periodLabel && (
          <>
            <span className="topbar-date__sep" aria-hidden="true">·</span>
            <span className="topbar-date__period">{periodLabel}</span>
          </>
        )}
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
                    closeAndRestore();
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
                closeAndRestore();
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

/**
 * Driver-app topbar identity: greeting + name + current vehicle plate
 * (biển số xe). The plate fetch lives here — not in Topbar's generic body —
 * so non-driver sessions never fire the request.
 */
function DriverIdentity({ name }: { name: string | null }) {
  const { data: vehicle } = useDriverVehicle();
  return (
    <div className="topbar__welcome">
      <div className="topbar__welcome-idline">
        <span className="name" title={name ?? undefined}>{name}</span>
        {vehicle?.truckPlate && (
          <span className="topbar__plate" title="Biển số xe đang điều phối">
            <Truck size={12} aria-hidden="true" />
            {vehicle.truckPlate}
          </span>
        )}
      </div>
    </div>
  );
}

function Topbar({
  user,
  isDriver,
  pageTitle,
  sidebarOpen,
  menuButtonRef,
  onToggleSidebar,
}: TopbarProps) {
  const location = useLocation();
  // CHIEF ruling (27/09): config and master-data catalog views are
  // period-independent asset inventories — the global month navigator is
  // noise there and is hidden (config/*, fleet/*, dispatch/catalogs/*).
  // Owner redesign 23/10 (audit #4: "3 cơ chế ngày chồng nhau") — the quyết
  // toán board owns its own date range (the unified range picker), so the
  // global month chip is a dead 4th date mechanism there. Hidden on the
  // route only; every period-driven surface keeps it.
  const isPeriodIndependentView = /^\/(config|fleet)(\/|$)|^\/dispatch\/catalogs|^\/shipments-debit/.test(location.pathname);
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
          <Menu size={20} aria-hidden="true" />
        </button>
      )}

      {!isDriver && (
        <div className="topbar__context" aria-label="Trang hiện tại">
          <span className="topbar__context-kicker">Đang xem</span>
          <strong title={pageTitle}>{pageTitle}</strong>
        </div>
      )}

      {!isDriver && (
        <div ref={searchContainerRef} className="topbar__search" style={{ position: 'relative' }}>
          <Search size={14} aria-hidden="true" />
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
            <DriverIdentity name={user.fullName || user.username} />
          </div>
          <div className="topbar__center-driver">
            <MonthNavigator />
          </div>
        </>
      )}

      <div className="topbar__actions">
        {!isDriver && !isPeriodIndependentView && <MonthNavigator />}
        {canUseNotifications && <NotificationBell />}
      </div>
    </header>
  );
}

export { Topbar };
