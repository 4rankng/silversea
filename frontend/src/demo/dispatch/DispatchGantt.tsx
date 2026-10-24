/**
 * Chế độ B — Lịch Trình Đầu Xe (spec §1.3, SIL-157): Gantt ngang 00:00–
 * 24:00. Trục dọc trái = 6 đầu kéo đội xe nhà + tài xế mặc định; mỗi chuyến
 * là một time block trên dòng đầu kéo tương ứng; các khối chồng lấn (chạy
 * kẹp 2 vỏ 20′ cùng giờ) được packLaneRows chia thành sub-row trên/dưới để
 * không che nhau.
 *
 * Geometry (Gemini consult 24/10, locked): 96px/giờ; block min-w 48px (30′);
 * block < 64px ẩn text, chỉ dot + popover hover; now-line w-[2px]
 * bg-error-500 (utility-red-500) + tam giác ở đầu; trục trái sticky z-30
 * (trên now-line) để line không sọc qua cột đầu kéo khi cuộn ngang.
 */
import { useMemo } from 'react';
import { Clock, Truck01 } from '@untitledui/icons';
import { Tooltip } from '@/components/untitled-ui/base/tooltip/tooltip';
import { cx } from '@/utils/cx';
import {
  blockGeometry,
  deriveTripStatus,
  filterTrips,
  HOUR_PX,
  nowLinePx,
  packLaneRows,
  TEXT_BLOCK_PX,
  tripWindow,
  truckLanes,
  type DispatchFilters,
  type PackedBlock,
} from './dispatch-model';
import type { DemoTrip } from '../data/types';

const HOURS = Array.from({ length: 25 }, (_, i) => i);
const TRACK_WIDTH = 24 * HOUR_PX;
const LANE_H = 64;
const LANE_PAD = 6;

function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

/** Vị trí dọc của một sub-row block trong lane 64px. */
function blockVertical(row: number, rows: number): { top: number; height: number } {
  const usable = LANE_H - LANE_PAD * 2;
  const height = rows > 1 ? Math.floor(usable / rows) - 2 : usable;
  const top = LANE_PAD + row * Math.floor(usable / rows) + (rows > 1 ? 1 : 0);
  return { top, height };
}

function TripBlock({
  packed,
  onOpen,
  now,
  todayIso,
}: {
  packed: PackedBlock;
  onOpen: (trip: DemoTrip) => void;
  now: Date;
  todayIso: string;
}) {
  const { trip, row, rows } = packed;
  const geo = blockGeometry(tripWindow(trip));
  const vertical = blockVertical(row, rows);
  const compact = geo.widthPx < TEXT_BLOCK_PX;
  const done = deriveTripStatus(trip, now, todayIso) === 'done';

  return (
    <Tooltip title={trip.code} description={`${trip.contNo} · ${trip.size}′ · ${trip.routeText}`}>
      <button
        type="button"
        onClick={() => onOpen(trip)}
        aria-label={`${trip.code} · ${trip.contNo} · ${trip.routeText} — mở chi tiết`}
        data-testid="demo-gantt-block"
        style={{ left: geo.leftPx, width: geo.widthPx, top: vertical.top, height: vertical.height }}
        className={cx(
          'absolute flex items-center gap-1.5 overflow-hidden rounded-md px-2 text-left text-xs font-medium transition-colors',
          'bg-brand-primary text-brand-800 ring-1 ring-inset ring-brand-200 hover:bg-brand-primary_hover',
          done && 'opacity-70',
        )}
      >
        {compact ? (
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-brand-solid" />
        ) : (
          <>
            <span className="shrink-0 font-semibold">{trip.code}</span>
            <span className="truncate opacity-80">{trip.contNo}</span>
          </>
        )}
      </button>
    </Tooltip>
  );
}

export function DispatchGantt({
  trips,
  filters,
  now,
  todayIso,
  selectedDate,
  onOpenTrip,
}: {
  trips: readonly DemoTrip[];
  filters: DispatchFilters;
  now: Date;
  todayIso: string;
  selectedDate: string;
  onOpenTrip: (trip: DemoTrip) => void;
}) {
  const visible = useMemo(() => filterTrips(trips, filters), [trips, filters]);
  const lanes = useMemo(() => truckLanes(visible), [visible]);
  const showNowLine = selectedDate === todayIso;
  const nowPx = nowLinePx(now);
  const unassigned = visible.filter((t) => !t.truckId).length;

  return (
    <div data-testid="demo-dispatch-gantt-wrap">
      <div
        className="overflow-x-auto rounded-xl border border-secondary_alt bg-primary shadow-xs"
        data-testid="demo-dispatch-gantt"
      >
        <div className="flex min-w-fit">
          {/* Trục dọc: đầu kéo + tài xế mặc định (sticky khi cuộn ngang) */}
          <div className="sticky left-0 z-30 w-52 shrink-0 border-r border-secondary_alt bg-primary">
            <div className="flex h-10 items-center gap-1.5 border-b border-secondary_alt px-3 text-xs font-semibold uppercase tracking-wide text-quaternary">
              <Clock className="size-3.5" aria-hidden="true" />
              Đầu kéo · Tài xế
            </div>
            {lanes.map((lane) => (
              <div
                key={lane.truck.id}
                className="flex h-16 flex-col justify-center gap-0.5 border-b border-secondary_alt px-3"
              >
                <p className="text-sm font-medium leading-5 text-primary">{lane.truck.plate}</p>
                <p className="truncate text-xs leading-4 text-tertiary">
                  {lane.driver?.fullName ?? '—'} · {lane.trips.length} chuyến
                </p>
              </div>
            ))}
          </div>

          {/* Vùng biểu đồ 00–24h */}
          <div className="relative" style={{ width: TRACK_WIDTH }}>
            <div className="relative h-10 border-b border-secondary_alt">
              {HOURS.map((h) => (
                <span
                  key={h}
                  className="absolute top-0 flex h-full items-center border-l border-secondary_alt pl-1.5 text-xs text-quaternary"
                  style={{ left: h * HOUR_PX }}
                >
                  {h % 2 === 0 ? hourLabel(h) : ''}
                </span>
              ))}
            </div>

            <div className="relative">
              {lanes.map((lane) => (
                <div
                  key={lane.truck.id}
                  className="relative h-16 border-b border-secondary_alt"
                  data-testid="demo-gantt-lane"
                >
                  {HOURS.map((h) => (
                    <span
                      key={h}
                      aria-hidden="true"
                      className="absolute inset-y-0 border-l border-secondary_alt/60"
                      style={{ left: h * HOUR_PX }}
                    />
                  ))}
                  {packLaneRows(lane.trips).map((packed) => (
                    <TripBlock
                      key={packed.trip.id}
                      packed={packed}
                      onOpen={onOpenTrip}
                      now={now}
                      todayIso={todayIso}
                    />
                  ))}
                </div>
              ))}

              {showNowLine && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 z-20 w-[2px] bg-utility-red-500"
                  style={{ left: nowPx }}
                  data-testid="demo-gantt-nowline"
                >
                  <span
                    className="absolute -left-[5px] top-0 size-0"
                    style={{
                      borderLeft: '6px solid transparent',
                      borderRight: '6px solid transparent',
                      borderTop: '8px solid var(--color-utility-red-500)',
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {unassigned > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-quaternary">
          <Truck01 className="size-3.5" aria-hidden="true" />
          {unassigned} chuyến xe ngoài / chưa gán đầu kéo — chỉ hiển thị ở chế độ Lưới Điều Hành.
        </p>
      )}
    </div>
  );
}
