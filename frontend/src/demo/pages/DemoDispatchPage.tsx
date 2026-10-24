/**
 * /demo/dispatch — Bàn Điều Vận (SIL-156/157/158, spec §Phân hệ 1).
 *
 * Toàn bộ dữ liệu là fixture trong state trang (không gọi API): thanh ngày
 * Hôm qua|Hôm nay|Ngày mai quanh 2026-10-24, 4 thẻ KPI, bộ lọc + view
 * switcher + Tạo Chuyến Mới, Lưới Điều Hành 6 cột / Lịch Trình Đầu Xe
 * (Gantt 00–24h) và Slide-over Drawer 40%.
 *
 * Provenance (AGENTS.md required UI routing): pattern tham khảo Untitled UI
 * PRO `application/slideout-menus/project-details-menu` (slideout + copy) và
 * `application/table`; Tailkit `a-l-dark-sidebar-04` cho layout side content
 * — dựng lại bằng house primitives (base/*) + utility tokens, không paste
 * mã catalog.
 */
import { useMemo, useState } from 'react';
import { demoTripsOnDate } from '../data/seed';
import type { DemoTrip } from '../data/types';
import { dispatchKpis, EMPTY_FILTERS, type DispatchFilters } from '../dispatch/dispatch-model';
import { DispatchDateBar } from '../dispatch/DispatchDateBar';
import { DispatchKpiCards } from '../dispatch/DispatchKpiCards';
import { DispatchFilters as DispatchFilterBar, type DispatchView } from '../dispatch/DispatchFilters';
import { DispatchGrid } from '../dispatch/DispatchGrid';
import { DispatchGantt } from '../dispatch/DispatchGantt';
import { DispatchDrawer } from '../dispatch/DispatchDrawer';
import { DispatchCreateModal, buildNewTrips, type NewTripDraft } from '../dispatch/DispatchCreateModal';

/** Ngày demo "hôm nay" — cố định theo seed, bất đồng hồ máy. */
const DEMO_TODAY = '2026-10-24';

export default function DemoDispatchPage() {
  const [selectedDate, setSelectedDate] = useState(DEMO_TODAY);
  const [filters, setFilters] = useState<DispatchFilters>(EMPTY_FILTERS);
  const [view, setView] = useState<DispatchView>('grid');
  /** Bản ghi đã lưu từ drawer / chuyến vừa tạo, ghi đè seed theo id. */
  const [overrides, setOverrides] = useState<Record<string, DemoTrip>>({});
  const [created, setCreated] = useState<DemoTrip[]>([]);
  const [openTripId, setOpenTripId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const now = new Date();

  const dayTrips = useMemo(() => {
    const seeded = demoTripsOnDate(selectedDate);
    const extra = created.filter((t) => t.date === selectedDate);
    return [...seeded, ...extra].map((t) => overrides[t.id] ?? t);
  }, [selectedDate, created, overrides]);

  const kpis = useMemo(() => dispatchKpis(dayTrips), [dayTrips]);
  const openTrip = openTripId ? dayTrips.find((t) => t.id === openTripId) : undefined;

  const selectDate = (date: string) => {
    setSelectedDate(date);
    setOpenTripId(null);
  };

  const saveTrip = (next: DemoTrip) => {
    setOverrides((prev) => ({ ...prev, [next.id]: next }));
  };

  const createTrips = (draft: NewTripDraft) => {
    const fresh = buildNewTrips(draft, selectedDate, created.length);
    setCreated((prev) => [...prev, ...fresh]);
    setCreateOpen(false);
  };

  return (
    <div className="flex flex-col gap-5" data-testid="demo-dispatch-page">
      {/* Breadcrumb đã hiển thị tên trang; H1 sr-only giữ cấu trúc heading. */}
      <h1 className="sr-only">Bàn Điều Vận</h1>
      <DispatchDateBar todayIso={DEMO_TODAY} selectedDate={selectedDate} onSelect={selectDate} />
      <DispatchKpiCards kpis={kpis} />
      <DispatchFilterBar
        filters={filters}
        onFiltersChange={setFilters}
        view={view}
        onViewChange={setView}
        onCreate={() => setCreateOpen(true)}
      />

      {view === 'grid' ? (
        <DispatchGrid
          trips={dayTrips}
          filters={filters}
          now={now}
          todayIso={DEMO_TODAY}
          onOpenTrip={(trip) => setOpenTripId(trip.id)}
        />
      ) : (
        <DispatchGantt
          trips={dayTrips}
          filters={filters}
          now={now}
          todayIso={DEMO_TODAY}
          selectedDate={selectedDate}
          onOpenTrip={(trip) => setOpenTripId(trip.id)}
        />
      )}

      <DispatchDrawer
        isOpen={Boolean(openTrip)}
        trip={openTrip ?? null}
        onClose={() => setOpenTripId(null)}
        onSave={saveTrip}
      />
      <DispatchCreateModal isOpen={createOpen} onClose={() => setCreateOpen(false)} onCreate={createTrips} />
    </div>
  );
}
