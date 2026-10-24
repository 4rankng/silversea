/**
 * Chế độ A — Lưới Điều Hành 6 cột, tối đa 3 dòng/ô (spec §1.2, SIL-156).
 * Tuyệt đối không hiển thị số tiền trên lưới — tiền chỉ nằm trong Drawer.
 *
 * Cell anatomy (Gemini consult 24/10, locked): dòng 1 = text-sm/14px medium
 * text-primary; dòng 2 = text-xs text-tertiary; dòng 3 = text-xs
 * text-quaternary; row height ~68px, py-2.5 px-3, leading-5/4.
 * Click dòng → Drawer; nút Copy TT Xe copy chuỗi chuẩn đăng ký xe.
 */
import { useMemo } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Box, Copy01, Link01, Tag01 } from '@untitledui/icons';
import { Button } from '@/components/untitled-ui/base/buttons/button';
import { useToastOptional } from '@/components/shared/Toast';
import {
  customerOf,
  deriveTripStatus,
  dropFee,
  feeSignal,
  filterTrips,
  isPairedTrip,
  liftFee,
  copyVehicleText,
  portName,
  tripWindow,
  type DispatchFilters,
} from './dispatch-model';
import { demoDrivers, demoTrucks, demoVendors } from '../data/seed';
import type { DemoTrip } from '../data/types';
import { FeeSignalBadge, SoftPill, StatusLine, VehicleSourceBadge } from './dispatch-ui';

const COLS = [
  'Thời gian & Phương tiện',
  'Khách hàng & Điểm đóng/trả',
  'Lộ trình bãi & Tham chiếu',
  'Thông số Container',
  'Yêu cầu & Ghi chú hiện trường',
  'Trạng thái & Tín hiệu nâng/hạ',
] as const;

/** Ba dòng của một ô, chuẩn 14/12/12 px, cao ~68px. */
function Cell({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5" data-testid={testId}>
      {children}
    </div>
  );
}

function Line1({ children }: { children: React.ReactNode }) {
  return <p className="truncate text-sm font-medium leading-5 text-primary">{children}</p>;
}

function Line2({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`truncate text-xs leading-5 text-tertiary ${className ?? ''}`}>{children}</p>;
}

function Line3({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`truncate text-xs leading-4 text-quaternary ${className ?? ''}`}>{children}</p>;
}

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function VehicleCell({ trip }: { trip: DemoTrip }) {
  const toast = useToastOptional()?.toast;
  const truck = trip.truckId ? demoTrucks.find((t) => t.id === trip.truckId) : undefined;
  const driver = trip.driverId ? demoDrivers.find((d) => d.id === trip.driverId) : undefined;
  const vendor = trip.vendorId ? demoVendors.find((v) => v.id === trip.vendorId) : undefined;
  const win = tripWindow(trip);

  const onCopy = async () => {
    const text = copyVehicleText({ truck, driver, vendor });
    try {
      await navigator.clipboard.writeText(text);
      toast?.({ kind: 'success', message: `Đã copy thông tin xe: ${text}` });
    } catch {
      toast?.({ kind: 'error', message: 'Không copy được — trình duyệt chặn clipboard.' });
    }
  };

  return (
    <Cell testId="demo-grid-cell-vehicle">
      <Line1>
        <span className="font-semibold">{trip.code}</span>
        <span className="mx-1.5 text-tertiary">·</span>
        {hhmm(win.startMin)} → {hhmm(win.endMin)}
      </Line1>
      <Line2>
        <VehicleSourceBadge source={trip.source}>
          {trip.source === 'inhouse'
            ? `Xe nhà · ${driver?.fullName ?? ''} · ${truck?.plate ?? ''}`
            : `Xe ngoài · ${vendor?.name ?? ''}`}
        </VehicleSourceBadge>
      </Line2>
      <Line3>
        {trip.source === 'inhouse' ? `Moóc ${truck?.trailerPlate ?? '—'}` : 'Xe thuê ngoài'}
      </Line3>
      <span onClick={(e) => e.stopPropagation()} className="mt-1 self-start">
        <Button
          color="secondary"
          size="xs"
          iconLeading={Copy01}
          aria-label={`Copy thông tin xe chuyến ${trip.code}`}
          onPress={() => void onCopy()}
        />
      </span>
    </Cell>
  );
}

function CustomerCell({ trip }: { trip: DemoTrip }) {
  const customer = customerOf(trip);
  return (
    <Cell>
      <Line1>{customer?.name ?? trip.customerId}</Line1>
      <Line2>🏭 {customer?.factory ?? '—'}</Line2>
      <Line3>{customer?.factoryArea ?? '—'}</Line3>
    </Cell>
  );
}

function RouteCell({ trip }: { trip: DemoTrip }) {
  return (
    <Cell>
      <Line1>
        <SoftPill tone={trip.flow === 'export' ? 'error' : 'blue'}>
          {trip.flow === 'export' ? 'XUẤT' : 'NHẬP'}
        </SoftPill>
        <span className="ml-1.5 align-middle">{trip.bookingNo}</span>
      </Line1>
      <Line2>{trip.billNo ? `Bill ${trip.billNo}` : 'Chưa có số Bill'}</Line2>
      <Line3>
        <ArrowUp className="mr-0.5 inline size-3" aria-hidden="true" />
        {portName(trip.liftPortId)}
        {trip.dropPortId && (
          <>
            {' '}
            <ArrowDown className="mx-0.5 inline size-3" aria-hidden="true" />
            {portName(trip.dropPortId)}
          </>
        )}
      </Line3>
    </Cell>
  );
}

function ContainerCell({ trip, paired }: { trip: DemoTrip; paired: boolean }) {
  return (
    <Cell>
      <Line1>
        <Box className="mr-1 inline size-3.5 text-quaternary" aria-hidden="true" />
        {trip.contNo}
        <SoftPill tone="neutral" className="ml-1.5">
          {trip.size}′
        </SoftPill>
        {paired && (
          <SoftPill tone="purple" className="ml-1.5">
            <Link01 className="size-3" aria-hidden="true" /> KẸP
          </SoftPill>
        )}
      </Line1>
      <Line2>
        Chì:{' '}
        {trip.containerSpec ? (
          <span>{trip.containerSpec.sealNo}</span>
        ) : (
          <span className="font-medium text-utility-orange-600">chưa có</span>
        )}
      </Line2>
      {trip.containerSpec ? (
        <Line3>
          Max {trip.containerSpec.maxGrossKg.toLocaleString('vi-VN')} kg · Tare{' '}
          {trip.containerSpec.tareKg.toLocaleString('vi-VN')} kg
        </Line3>
      ) : (
        <Line3 className="font-medium text-utility-orange-600">
          <AlertTriangle className="mr-1 inline size-3.5" aria-hidden="true" />
          Chưa đủ thông số vỏ
        </Line3>
      )}
    </Cell>
  );
}

/** Yêu cầu đặc biệt về vỏ suy ra từ ghi chú (chọn vỏ / cược vỏ / cân vỏ). */
function specialRequests(note: string | undefined): string[] {
  const tags: string[] = [];
  if (!note) return tags;
  if (/chọn vỏ/i.test(note)) tags.push('Chọn vỏ');
  if (/cược vỏ/i.test(note)) tags.push('Cược vỏ');
  if (/cân vỏ/i.test(note)) tags.push('Cân vỏ');
  return tags;
}

function NoteCell({ trip }: { trip: DemoTrip }) {
  const tags = specialRequests(trip.note);
  return (
    <Cell>
      <Line2>
        {tags.length > 0 ? (
          tags.map((tag) => (
            <SoftPill key={tag} tone="brand" className="mr-1">
              <Tag01 className="size-3" aria-hidden="true" />
              {tag}
            </SoftPill>
          ))
        ) : (
          <span className="text-quaternary">Không yêu cầu đặc biệt</span>
        )}
      </Line2>
      {trip.note ? (
        <p className="line-clamp-2 rounded-md bg-utility-orange-50 px-2 py-1 text-xs leading-4 text-utility-orange-700">
          <AlertTriangle className="mr-1 inline size-3.5 shrink-0" aria-hidden="true" />
          {trip.note}
        </p>
      ) : (
        <Line3>—</Line3>
      )}
    </Cell>
  );
}

function StatusCell({ trip, now, todayIso }: { trip: DemoTrip; now: Date; todayIso: string }) {
  const lift = feeSignal(liftFee(trip));
  const drop = feeSignal(dropFee(trip));
  return (
    <Cell testId="demo-grid-cell-status">
      <StatusLine status={deriveTripStatus(trip, now, todayIso)} />
      <div className="mt-0.5 flex flex-col items-start gap-1">
        {lift && <FeeSignalBadge signal={lift} kind="Nâng" />}
        {drop && <FeeSignalBadge signal={drop} kind="Hạ" />}
      </div>
    </Cell>
  );
}

export function DispatchGrid({
  trips,
  filters,
  now,
  todayIso,
  onOpenTrip,
}: {
  trips: readonly DemoTrip[];
  filters: DispatchFilters;
  now: Date;
  todayIso: string;
  onOpenTrip: (trip: DemoTrip) => void;
}) {
  const rows = useMemo(() => filterTrips(trips, filters), [trips, filters]);

  if (rows.length === 0) {
    return (
      <div
        className="rounded-xl border border-secondary_alt bg-primary px-6 py-12 text-center"
        data-testid="demo-grid-empty"
      >
        <p className="text-sm font-medium text-primary">Không có chuyến nào khớp bộ lọc</p>
        <p className="mt-1 text-sm text-tertiary">Đổi ngày làm việc hoặc xóa bộ lọc để xem lại kế hoạch.</p>
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-xl border border-secondary_alt bg-primary shadow-xs"
      data-testid="demo-dispatch-grid"
    >
      <table className="w-full min-w-[1120px] border-collapse text-left">
        <thead>
          <tr className="border-b border-secondary_alt">
            {COLS.map((col) => (
              <th
                key={col}
                scope="col"
                className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-quaternary"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((trip) => (
            <tr
              key={trip.id}
              tabIndex={0}
              onClick={() => onOpenTrip(trip)}
              onKeyDown={(e) => {
                // Chỉ mở drawer khi chính <tr> nhận phím — Enter trên nút
                // Copy trong ô 1 không được mở drawer kèm theo.
                if (e.key === 'Enter' && e.target === e.currentTarget) onOpenTrip(trip);
              }}
              className="cursor-pointer border-b border-secondary_alt align-top transition-colors last:border-b-0 hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
              aria-label={`Mở chi tiết chuyến ${trip.code}`}
            >
              <td className="w-[17%]">
                <VehicleCell trip={trip} />
              </td>
              <td className="w-[16%]">
                <CustomerCell trip={trip} />
              </td>
              <td className="w-[19%]">
                <RouteCell trip={trip} />
              </td>
              <td className="w-[19%]">
                <ContainerCell trip={trip} paired={isPairedTrip(trips, trip)} />
              </td>
              <td className="w-[15%]">
                <NoteCell trip={trip} />
              </td>
              <td className="w-[14%]">
                <StatusCell trip={trip} now={now} todayIso={todayIso} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
