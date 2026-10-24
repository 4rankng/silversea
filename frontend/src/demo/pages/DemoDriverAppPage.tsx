/**
 * /demo/driver-app — Ứng dụng Lái Xe (SIL-162, spec §5).
 *
 * Khung giả lập điện thoại 390×844 (rounded-2xl, border-8 gray-800) giữa
 * nền gray-100 + thanh chọn tài xế demo phía trên khung. Hai lớp:
 * Layer 1 danh sách thẻ lệnh theo giờ, Layer 2 chi tiết + OCR + E-POD.
 *
 * Provenance (AGENTS.md UI routing): dựng 100% từ base primitives Untitled
 * UI đã vendored (`Badge`/`Button`/`Input`/`NativeSelect`) + utility tokens
 * house; khung điện thoại là bố cục riêng của spec demo (không có trong
 * catalog Untitled UI PRO / Tailkit nên không tra cứu — spec là contract).
 */
import { useMemo, useState } from 'react';
import { Phone01 } from '@untitledui/icons';
import { UuiSelectField } from '@/design-system/forms/UuiSelectField';
import { demoNavItemRequired } from '../nav';
import { demoDrivers, demoTrucks, type DemoTrip } from '../data';
import { DRIVER_APP_DAY, driverDayTrips, formatDriverDay } from '../driver-app/derive';
import { TripCard } from '../driver-app/TripCard';
import { TripDetail } from '../driver-app/TripDetail';

const item = demoNavItemRequired('/demo/driver-app');

/** "Nguyễn Văn Tâm — 51C-138.65": tài xế + đầu kéo ghép cặp mặc định. */
function driverOptionLabel(driverId: string): string {
  const driver = demoDrivers.find((d) => d.id === driverId);
  const truck = demoTrucks.find((t) => t.defaultDriverId === driverId);
  if (!driver) return driverId;
  return truck ? `${driver.fullName} — ${truck.plate}` : driver.fullName;
}

/** Màn hình trong khung điện thoại — trạng thái Layer 1 / Layer 2. */
function PhoneScreen({
  driverId,
  completedIds,
  openTrip,
  onOpenTrip,
  onBack,
  onComplete,
}: {
  driverId: string;
  completedIds: ReadonlySet<string>;
  openTrip: DemoTrip | null;
  onOpenTrip: (trip: DemoTrip) => void;
  onBack: () => void;
  onComplete: (trip: DemoTrip) => void;
}) {
  const driver = demoDrivers.find((d) => d.id === driverId);
  const trips = useMemo(() => driverDayTrips(driverId), [driverId]);
  const truck = demoTrucks.find((t) => t.defaultDriverId === driverId);

  return (
    <div className="flex h-full flex-col bg-primary" data-testid="driver-phone-screen">
      {/* Thanh trạng thái app (trong điện thoại) */}
      <div className="flex items-center justify-between gap-2 border-b border-secondary_alt px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-primary" data-testid="driver-phone-header-name">
            {driver?.fullName ?? 'Tài xế'}
          </p>
          <p className="truncate text-xs text-tertiary">
            {truck ? `${truck.plate} · ` : ''}
            {formatDriverDay(DRIVER_APP_DAY)}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full bg-utility-purple-50 px-2 py-0.5 text-[11px] font-medium text-utility-purple-700 ring-1 ring-inset ring-utility-purple-200">
          Ứng dụng Lái Xe
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {openTrip ? (
          <TripDetail
            trip={openTrip}
            completed={completedIds.has(openTrip.id)}
            onBack={onBack}
            onComplete={onComplete}
          />
        ) : (
          <div className="flex flex-col gap-3" data-testid="driver-trip-list">
            <p className="text-xs font-medium uppercase tracking-wide text-quaternary">
              Lệnh chuyến trong ngày · {trips.length} chuyến
            </p>
            {trips.length === 0 ? (
              <p className="rounded-xl border border-dashed border-secondary_alt p-4 text-center text-sm text-tertiary">
                Tài xế này chưa có lệnh chuyến trong ngày demo.
              </p>
            ) : (
              trips.map((trip) => (
                <TripCard key={trip.id} trip={trip} completed={completedIds.has(trip.id)} onOpen={onOpenTrip} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DemoDriverAppPage() {
  const [driverId, setDriverId] = useState(demoDrivers[0]?.id ?? '');
  const [openTripId, setOpenTripId] = useState<string | null>(null);
  const [completedIds, setCompletedIds] = useState<ReadonlySet<string>>(new Set());

  // Chuyến đang mở phải thuộc tài xế hiện tại — đổi tài xế đóng Layer 2.
  const openTrip = useMemo(() => {
    if (!openTripId) return null;
    return driverDayTrips(driverId).find((t) => t.id === openTripId) ?? null;
  }, [driverId, openTripId]);

  return (
    <div className="flex flex-col gap-5" data-testid="demo-driver-app-page">
      <header className="flex flex-wrap items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-primary text-brand-700">
          <item.icon className="size-6" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-display-xs font-semibold text-primary">{item.heading}</h1>
          <p className="max-w-[72ch] text-md text-tertiary">
            {item.description} Dữ liệu tĩnh từ <code>frontend/src/demo/data</code> — không gọi API.
          </p>
        </div>
      </header>

      <div className="flex flex-col items-center gap-4">
        {/* Thanh chọn tài xế demo — trên khung điện thoại */}
        <div className="w-full max-w-sm" data-testid="demo-driver-picker">
          <UuiSelectField
            label="Xem theo tài xế (chế độ demo)"
            value={driverId}
            onChange={(e) => {
              setDriverId(e.target.value);
              setOpenTripId(null);
            }}
            options={demoDrivers.map((d) => ({ label: driverOptionLabel(d.id), value: d.id }))}
            searchable={false}
          />
        </div>

        {/* Sân khấu gray-100 + khung điện thoại 390×844 */}
        <div
          className="flex w-full justify-center rounded-2xl bg-gray-100 px-4 py-8 lg:py-12"
          data-testid="demo-phone-stage"
        >
          <div
            className="overflow-hidden rounded-2xl border-8 border-gray-800 bg-primary shadow-2xl"
            style={{ width: 390, height: 844 }}
            data-testid="demo-phone-frame"
            role="img"
            aria-label="Khung giả lập điện thoại 390×844 — ứng dụng lái xe"
          >
            <PhoneScreen
              driverId={driverId}
              completedIds={completedIds}
              openTrip={openTrip}
              onOpenTrip={(trip) => setOpenTripId(trip.id)}
              onBack={() => setOpenTripId(null)}
              onComplete={(trip) => {
                setCompletedIds((prev) => new Set(prev).add(trip.id));
                setOpenTripId(null);
              }}
            />
          </div>
        </div>

        <p className="flex items-center gap-2 text-xs text-quaternary">
          <Phone01 className="size-4" aria-hidden="true" />
          Khung giả lập 390×844 — thao tác như trên app tài xế: tap thẻ để mở chi tiết.
        </p>
      </div>
    </div>
  );
}
