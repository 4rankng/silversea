/**
 * /demo/port-payments — Duyệt Chi Cảng & Hoàn Ứng (SIL-159, spec
 * 2026.10.24_Demo_layout.docx §PHÂN HỆ 2 / doc_bb1b74fcfa8b mục 2).
 *
 * Tab 2.1 — Hàng đợi Duyệt UNC: tự lọc phí Nâng/Hạ hình thức UNC từ chuyến
 * ngày chọn (fixtures); lọc cảng/trạng thái/ngày; checkbox chọn lô cùng cảng
 * để duyệt gộp; [Xác nhận Đã UNC] → mini spinner → ✅ Đã UNC (dòng mờ đi).
 * Tab 2.2 — Sổ hoàn ứng lái xe: thẻ số dư per tài xế (sort desc, click lọc
 * bảng) + bảng chi tiết khoản chi hộ kèm thumb HĐ/phiếu thu.
 *
 * Owner consult verdict (24/10, lane brief): status pill `py-0.5 px-2
 * text-xs font-medium` — warning-50/700 ⏳ chờ → success-50/700 ✅ đã; cột
 * checkbox `w-10`; khi duyệt ô trạng thái hiện mini spinner TRƯỚC badge
 * xanh (chặn double-click).
 *
 * Fixture-only: dữ liệu từ `../data`, không gọi API, state chỉ trong bộ nhớ
 * trang (refresh trả về seed). Untitled UI base primitives + house tokens —
 * không override design band trang cục bộ.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileAttachment01 } from '@untitledui/icons';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/untitled-ui/base/badges/badges';
import { Button } from '@/components/untitled-ui/base/buttons/button';
import { Checkbox } from '@/components/untitled-ui/base/checkbox/checkbox';
import { UuiSelectField } from '@/design-system/forms/UuiSelectField';
import { formatCurrency, formatISODate, formatMoney } from '@/lib/format';
import { cx } from '@/utils/cx';
import {
  demoCustomers,
  demoDrivers,
  demoPorts,
  demoTrips,
  demoTrucks,
  demoVendors,
  type DemoDriver,
  type DemoPortFee,
  type DemoPortFeeKind,
  type DemoTrip,
  type DemoTruck,
} from '../data';
import { demoNavItemRequired } from '../nav';
import './DemoPortPaymentsPage.css';

const nav = demoNavItemRequired('/demo/port-payments');

/** Ngày demo chính của seed (hầu hết chuyến nằm ở đây). */
const DEMO_TODAY = '2026-10-24';

/** Thời gian giả lập chuyển khoản: spinner hiển thị trước khi ✅. */
const APPROVE_MS = 900;

/* ── Pill trạng thái (consult) ─────────────────────────────────────────── */

/**
 * Pill py-0.5 px-2 text-xs medium — nền 50 / chữ 700 (house tokens:
 * bg-warning-primary=yellow-50 + text-utility-yellow-700; success tương tự).
 */
function StatusPill({ tone, children }: { tone: 'warning' | 'success'; children: ReactNode }) {
  return (
    <Badge
      type="pill-color"
      size="sm"
      color={tone}
      className={cx(
        tone === 'warning'
          ? 'bg-warning-primary ring-utility-yellow-700/15'
          : 'bg-success-primary ring-utility-green-700/15',
      )}
    >
      {children}
    </Badge>
  );
}

/** Mini spinner trong ô trạng thái khi đang ghi nhận UNC (chặn double-click). */
function MiniSpinner({ label }: { label: string }) {
  return (
    <span role="status" aria-label={label} data-testid="unc-spinner" className="inline-flex items-center gap-1.5 text-tertiary">
      <Loader2 size={16} aria-hidden="true" className="size-4 animate-spin" />
      <span className="text-xs font-medium">Đang UNC…</span>
    </span>
  );
}

/* ── Nhãn loại phí ─────────────────────────────────────────────────────── */

const FEE_KIND_LABEL: Record<DemoPortFeeKind, string> = {
  lift: 'PHÍ NÂNG',
  drop: 'PHÍ HẠ',
  surcharge: 'PHỤ PHÍ',
};

function FeeKindBadge({ kind }: { kind: DemoPortFeeKind }) {
  // Nâng = brand (thao tác tại cảng), Hạ = gray, Phụ phí = slate — cùng một
  // badge base `color` sm của Untitled UI, không phát minh biến thể mới.
  const color = kind === 'lift' ? 'brand' : kind === 'drop' ? 'gray' : 'slate';
  return (
    <Badge type="color" size="sm" color={color}>
      {FEE_KIND_LABEL[kind]}
    </Badge>
  );
}

/* ── Tra cứu danh mục ──────────────────────────────────────────────────── */

const portById = new Map(demoPorts.map((p) => [p.id, p]));
const customerById = new Map(demoCustomers.map((c) => [c.id, c]));
const truckById = new Map(demoTrucks.map((t) => [t.id, t]));
const driverById = new Map(demoDrivers.map((d) => [d.id, d]));
const vendorById = new Map(demoVendors.map((v) => [v.id, v]));

/* ── Tab 2.1 — Hàng đợi Duyệt UNC ──────────────────────────────────────── */

interface UncRow {
  fee: DemoPortFee;
  trip: DemoTrip;
}

/** Gộp cảng trước (duyệt lô cùng cảng) rồi đến chuyến — lô dễ thấy liền nhau. */
function uncRowsForDate(date: string): UncRow[] {
  return demoTrips
    .filter((trip) => trip.date === date)
    .flatMap((trip) =>
      trip.fees
        // Spec 2.1: chỉ Phí Nâng / Phí Hạ thanh toán bằng UNC (không tính
        // phụ phí UNC hay phí lái xe chi tiền mặt).
        .filter((fee) => fee.method === 'unc' && (fee.kind === 'lift' || fee.kind === 'drop'))
        .map((fee) => ({ fee, trip })),
    )
    .sort(
      (a, b) =>
        a.fee.portId.localeCompare(b.fee.portId) ||
        a.trip.code.localeCompare(b.trip.code) ||
        (a.fee.kind === b.fee.kind ? 0 : a.fee.kind === 'lift' ? -1 : 1),
    );
}

type UncStatusFilter = 'all' | 'pending' | 'paid';

function UncQueuePanel() {
  const [date, setDate] = useState(DEMO_TODAY);
  const [portFilter, setPortFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<UncStatusFilter>('all');

  // Đổi filter (cảng/trạng thái/ngày) bỏ selection — không duyệt lô dòng
  // đang bị ẩn (N-2 review SIL-159).
  const changePortFilter = (value: string) => {
    setPortFilter(value);
    setSelected(new Set());
  };
  const changeStatusFilter = (value: UncStatusFilter) => {
    setStatusFilter(value);
    setSelected(new Set());
  };
  const changeDate = (value: string) => {
    setDate(value);
    setSelected(new Set());
  };

  // State duyệt UNC trong bộ nhớ trang: approved ghi đè seed, approving là
  // các id đang spinner (double-click bị chặn vì id đã nằm ở đây).
  const [approved, setApproved] = useState<ReadonlySet<string>>(() => new Set());
  const [approving, setApproving] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const rows = useMemo(() => uncRowsForDate(date), [date]);

  const effectiveStatus = useCallback(
    (fee: DemoPortFee): 'pending' | 'paid' =>
      approved.has(fee.id) ? 'paid' : (fee.uncStatus ?? 'pending'),
    [approved],
  );

  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          (portFilter === 'all' || r.fee.portId === portFilter) &&
          (statusFilter === 'all' || effectiveStatus(r.fee) === statusFilter),
      ),
    [rows, portFilter, statusFilter, effectiveStatus],
  );

  /** Ghi nhận UNC cho một lô id: spinner trước, ✅ sau APPROVE_MS. */
  const beginApprove = useCallback(
    (feeIds: string[]) => {
      const fresh = feeIds.filter((id) => !approved.has(id) && !approving.has(id));
      if (fresh.length === 0) return;
      setApproving((prev) => new Set([...prev, ...fresh]));
      setSelected((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        fresh.forEach((id) => next.delete(id));
        return next;
      });
      const timer = setTimeout(() => {
        setApproved((prev) => new Set([...prev, ...fresh]));
        setApproving((prev) => {
          if (prev.size === 0) return prev;
          const next = new Set(prev);
          fresh.forEach((id) => next.delete(id));
          return next;
        });
        timers.current.delete(timer);
      }, APPROVE_MS);
      timers.current.add(timer);
    },
    [approved, approving],
  );

  const toggleSelected = useCallback((feeId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(feeId)) next.delete(feeId);
      else next.add(feeId);
      return next;
    });
  }, []);

  // Lô duyệt gộp: ≥2 dòng CÙNG cảng (spec 2.1 — chuyển khoản gộp 1 lần).
  const selectedRows = rows.filter((r) => selected.has(r.fee.id) && effectiveStatus(r.fee) === 'pending');
  const selectedPorts = new Set(selectedRows.map((r) => r.fee.portId));
  const samePort = selectedPorts.size === 1;
  const bulkReady = selectedRows.length >= 2 && samePort;
  const bulkTotal = selectedRows.reduce((sum, r) => sum + r.fee.amountVnd, 0);

  const pendingCount = rows.filter((r) => effectiveStatus(r.fee) === 'pending').length;
  const pendingTotal = rows
    .filter((r) => effectiveStatus(r.fee) === 'pending')
    .reduce((sum, r) => sum + r.fee.amountVnd, 0);
  const paidCount = rows.length - pendingCount;

  const dateOptions = useMemo(() => {
    const dates = [...new Set(demoTrips.map((t) => t.date))].sort();
    return dates.map((d) => ({
      value: d,
      label: d === DEMO_TODAY ? `Hôm nay · ${formatISODate(d)}` : d < DEMO_TODAY ? `Hôm qua · ${formatISODate(d)}` : `Ngày mai · ${formatISODate(d)}`,
    }));
  }, []);

  return (
    <section aria-label="Hàng đợi Duyệt UNC" className="flex flex-col gap-4">
      {/* Bộ lọc nhanh — luôn hiện khi đủ chỗ (owner decision), wrap không clip.
          UuiSelectField = select được duyệt của app (no-native-select guard). */}
      <div className="flex flex-wrap items-end gap-3">
        <UuiSelectField
          label="Cảng / Bãi"
          value={portFilter}
          onChange={(e) => changePortFilter(e.target.value)}
          width="content"
          searchable={false}
          options={[
            { value: 'all', label: 'Tất cả cảng / bãi' },
            ...demoPorts.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <UuiSelectField
          label="Trạng thái"
          value={statusFilter}
          onChange={(e) => changeStatusFilter(e.target.value as UncStatusFilter)}
          width="content"
          options={[
            { value: 'all', label: 'Tất cả' },
            { value: 'pending', label: '⏳ Chờ UNC' },
            { value: 'paid', label: '✅ Đã UNC' },
          ]}
        />
        <UuiSelectField
          label="Ngày thực hiện"
          value={date}
          onChange={(e) => changeDate(e.target.value)}
          width="content"
          options={dateOptions}
        />
        {/* Tổng kết theo NGÀY (không nhân theo filter cảng/trạng thái) — đây là
            KPI hàng đợi của ngày, bộ lọc chỉ thu hẹp danh sách (N-1 review). */}
        <p className="ml-auto pb-1.5 text-sm text-tertiary" data-testid="unc-summary">
          <span className="font-semibold text-primary tabular-nums">{pendingCount}</span> chờ ·{' '}
          <span className="tabular-nums">{paidCount}</span> đã UNC · tổng chờ{' '}
          <span className="font-semibold text-primary tabular-nums">{formatCurrency(pendingTotal)}</span>
        </p>
      </div>

      {/* Thanh duyệt lô — chỉ hiện khi có dòng được chọn */}
      {selectedRows.length > 0 && (
        <div
          data-testid="unc-bulk-bar"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-secondary_alt bg-brand-primary px-4 py-2.5"
        >
          <p className="text-sm text-secondary">
            Đã chọn <span className="font-semibold text-primary tabular-nums">{selectedRows.length}</span> phí
            {samePort && <> · {portById.get(selectedRows[0]!.fee.portId)?.name}</>} ·{' '}
            <span className="font-semibold text-primary tabular-nums">{formatCurrency(bulkTotal)}</span>
          </p>
          <div className="ml-auto flex items-center gap-2">
            {!samePort && <span className="text-xs text-warning-primary">UNC gộp chỉ áp dụng cùng một cảng / bãi</span>}
            <Button
              size="sm"
              color="primary"
              isDisabled={!bulkReady}
              onPress={() => beginApprove(selectedRows.map((r) => r.fee.id))}
            >
              Duyệt lô ({selectedRows.length})
            </Button>
            <Button size="sm" color="tertiary" onPress={() => setSelected(new Set())}>
              Bỏ chọn
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-secondary_alt bg-primary shadow-xs">
        <table className="pp-table">
          <thead>
            <tr>
              <th scope="col" className="pp-col--check">
                <span className="sr-only">Chọn để duyệt lô</span>
              </th>
              <th scope="col">Loại phí &amp; Cảng / Bãi</th>
              <th scope="col">Chuyến &amp; Cont</th>
              <th scope="col">Phương tiện &amp; Khách hàng</th>
              <th scope="col">Đơn vị nhận HĐ</th>
              <th scope="col" className="pp-col--num">Số tiền cần UNC</th>
              <th scope="col" className="pp-col--action">Trạng thái &amp; Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ fee, trip }) => {
              const status = effectiveStatus(fee);
              const isApproving = approving.has(fee.id);
              const port = portById.get(fee.portId);
              const customer = customerById.get(trip.customerId);
              const truck = trip.truckId ? truckById.get(trip.truckId) : undefined;
              const vendor = trip.vendorId ? vendorById.get(trip.vendorId) : undefined;
              const isSelected = selected.has(fee.id);
              return (
                <tr
                  key={fee.id}
                  data-testid="unc-row"
                  data-fee-id={fee.id}
                  className={cx(
                    status === 'pending' && !isApproving && 'pp-row--pending',
                    status === 'paid' && 'pp-row--paid',
                  )}
                >
                  <td className="pp-col--check">
                    {status === 'pending' && !isApproving ? (
                      <Checkbox
                        isSelected={isSelected}
                        onChange={() => toggleSelected(fee.id)}
                        aria-label={`Chọn phí ${FEE_KIND_LABEL[fee.kind]} ${trip.contNo} tại ${port?.name ?? ''} để duyệt lô`}
                      />
                    ) : null}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <FeeKindBadge kind={fee.kind} />
                      <span className="font-medium text-primary">{port?.name}</span>
                    </div>
                  </td>
                  <td>
                    <p className="font-medium text-primary">{trip.bookingNo}</p>
                    <p className="mt-0.5 text-xs text-tertiary">
                      <span className="tabular-nums">{trip.contNo}</span> · {trip.size}′ · {trip.flow === 'export' ? 'Hàng xuất' : 'Hàng nhập'}
                    </p>
                  </td>
                  <td>
                    {trip.source === 'vendor' ? (
                      <p className="font-medium text-primary">
                        {vendor?.name} <span className="font-normal text-xs text-quaternary">(xe ngoài)</span>
                      </p>
                    ) : (
                      <p className="font-medium tabular-nums text-primary">{truck?.plate}</p>
                    )}
                    <p className="mt-0.5 text-xs text-tertiary">{customer?.name}</p>
                  </td>
                  <td className="text-secondary">{fee.invoiceTo}</td>
                  <td className="pp-col--num">
                    <span className="pp-money">{formatCurrency(fee.amountVnd)}</span>
                  </td>
                  <td className="pp-col--action">
                    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                      {isApproving ? (
                        <MiniSpinner label={`Đang ghi nhận UNC cho ${trip.contNo}`} />
                      ) : status === 'pending' ? (
                        <>
                          <StatusPill tone="warning">⏳ Chờ UNC</StatusPill>
                          <Button
                            size="xs"
                            color="secondary"
                            onPress={() => beginApprove([fee.id])}
                            aria-label={`Xác nhận Đã UNC phí ${FEE_KIND_LABEL[fee.kind]} ${trip.contNo}`}
                          >
                            Xác nhận Đã UNC
                          </Button>
                        </>
                      ) : (
                        <StatusPill tone="success">✅ Đã UNC</StatusPill>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="pp-empty text-tertiary">
                  Không có phí UNC nào khớp bộ lọc ở ngày {formatISODate(date)}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── Tab 2.2 — Sổ hoàn ứng lái xe ──────────────────────────────────────── */

interface LedgerRow {
  fee: DemoPortFee;
  trip: DemoTrip;
  driver: DemoDriver;
  truck: DemoTruck;
}

interface DriverBalance {
  driver: DemoDriver;
  /** BKS các đầu kéo tài xế đã chạy trong kỳ fixtures (seed ghép 1:1). */
  plates: string[];
  pendingTotal: number;
  pendingCount: number;
  doneCount: number;
}

/** Spec 2.2: chi hộ theo TÀI XẾ ĐỘI XE NHÀ — loại phí chi tiền mặt của xe ngoài. */
function ledgerRows(): LedgerRow[] {
  return demoTrips
    .filter((trip) => trip.source === 'inhouse' && trip.driverId && trip.truckId)
    .flatMap((trip) => {
      const driver = driverById.get(trip.driverId!);
      const truck = truckById.get(trip.truckId!);
      if (!driver || !truck) return [];
      return trip.fees
        .filter((fee) => fee.method === 'driver-cash')
        .map((fee) => ({ fee, trip, driver, truck }));
    })
    .sort((a, b) => b.trip.date.localeCompare(a.trip.date) || b.trip.code.localeCompare(a.trip.code));
}

function DriverLedgerPanel() {
  const rows = useMemo(ledgerRows, []);

  const balances = useMemo<DriverBalance[]>(() => {
    const byDriver = new Map<string, DriverBalance>();
    for (const { driver, truck, fee } of rows) {
      let entry = byDriver.get(driver.id);
      if (!entry) {
        entry = { driver, plates: [], pendingTotal: 0, pendingCount: 0, doneCount: 0 };
        byDriver.set(driver.id, entry);
      }
      if (!entry.plates.includes(truck.plate)) entry.plates.push(truck.plate);
      if ((fee.reimbursed ?? 'pending') === 'pending') {
        entry.pendingTotal += fee.amountVnd;
        entry.pendingCount += 1;
      } else {
        entry.doneCount += 1;
      }
    }
    return [...byDriver.values()].sort(
      (a, b) => b.pendingTotal - a.pendingTotal || a.driver.fullName.localeCompare(b.driver.fullName, 'vi'),
    );
  }, [rows]);

  const [driverFilter, setDriverFilter] = useState<string | null>(null);
  const visibleRows = useMemo(
    () => (driverFilter ? rows.filter((r) => r.driver.id === driverFilter) : rows),
    [rows, driverFilter],
  );
  const totalPending = balances.reduce((sum, b) => sum + b.pendingTotal, 0);
  const filterDriver = driverFilter ? driverById.get(driverFilter) : undefined;

  return (
    <section aria-label="Sổ hoàn ứng lái xe" className="flex flex-col gap-4">
      <p className="text-sm text-tertiary">
        Tổng đang chờ hoàn:{' '}
        <span className="font-semibold text-primary tabular-nums">{formatCurrency(totalPending)}</span> ·{' '}
        <span className="tabular-nums">{balances.length}</span> tài xế đội xe nhà
      </p>

      {/* Thẻ số dư per tài xế — sort desc theo tổng chờ hoàn, click để lọc bảng */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {balances.map(({ driver, plates, pendingTotal, pendingCount, doneCount }) => {
          const active = driverFilter === driver.id;
          return (
            <button
              key={driver.id}
              type="button"
              aria-pressed={active}
              data-testid="driver-balance-card"
              onClick={() => setDriverFilter(active ? null : driver.id)}
              className={cx(
                'flex flex-col items-start gap-1 rounded-xl border bg-primary p-4 text-left shadow-xs transition-colors',
                active ? 'border-brand-600 border-2' : 'border-secondary_alt hover:bg-primary_hover',
              )}
            >
              <span className="flex w-full items-center gap-2">
                <span className="truncate text-sm font-semibold text-primary">{driver.fullName}</span>
                {pendingCount > 0 ? (
                  <StatusPill tone="warning">⏳ {pendingCount}</StatusPill>
                ) : (
                  <StatusPill tone="success">✅</StatusPill>
                )}
              </span>
              <span className="text-xs tabular-nums text-tertiary">{plates.join(' · ')}</span>
              <span className="mt-1 text-lg font-semibold tabular-nums text-primary">
                {formatMoney(pendingTotal)} ₫
              </span>
              <span className="text-xs text-quaternary">
                chờ hoàn · {doneCount} khoản đã hoàn
              </span>
            </button>
          );
        })}
      </div>

      {filterDriver && (
        <div className="flex items-center gap-2 text-sm text-secondary">
          Đang lọc: <span className="font-medium text-primary">{filterDriver.fullName}</span>
          <Button size="xs" color="tertiary" onPress={() => setDriverFilter(null)}>
            Xem tất cả
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-secondary_alt bg-primary shadow-xs">
        <table className="pp-table pp-table--ledger">
          <thead>
            <tr>
              <th scope="col">Ngày</th>
              <th scope="col">Tài xế &amp; BKS</th>
              <th scope="col">Số Cont</th>
              <th scope="col">Loại phí ứng</th>
              <th scope="col" className="pp-col--num">Số tiền</th>
              <th scope="col">HĐ / Phiếu thu</th>
              <th scope="col" className="pp-col--action">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ fee, trip, driver, truck }) => {
              const done = (fee.reimbursed ?? 'pending') === 'done';
              return (
                <tr
                  key={fee.id}
                  data-testid="ledger-row"
                  className={cx(done && 'pp-row--paid')}
                >
                  <td className="pp-col--date tabular-nums">{formatISODate(trip.date)}</td>
                  <td>
                    <p className="font-medium text-primary">{driver.fullName}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-tertiary">{truck.plate}</p>
                  </td>
                  <td className="pp-col--cont tabular-nums">
                    {trip.contNo}
                    <span className="ml-1 text-xs text-quaternary">{trip.size}′</span>
                  </td>
                  <td>
                    <FeeKindBadge kind={fee.kind} />
                  </td>
                  <td className="pp-col--num">
                    <span className="pp-money">{formatCurrency(fee.amountVnd)}</span>
                  </td>
                  <td>
                    {/* Fixture không có ảnh thật — thumb chứng từ tĩnh, không
                        trông như nút bấm (owner: static text not actionable). */}
                    <span
                      role="img"
                      className="inline-flex items-center gap-1.5 rounded-md border border-secondary_alt bg-secondary px-2 py-1 text-xs text-tertiary"
                      aria-label={`Chứng từ chi hộ ${trip.contNo} (demo)`}
                    >
                      <FileAttachment01 className="size-3.5" aria-hidden="true" />
                      HĐ.cảng
                    </span>
                  </td>
                  <td className="pp-col--action">
                    {done ? <StatusPill tone="success">✅ Đã hoàn</StatusPill> : <StatusPill tone="warning">⏳ Chờ duyệt</StatusPill>}
                  </td>
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={7} className="pp-empty text-tertiary">
                  Không có khoản chi hộ nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── Trang: header + 2 sub-tabs ────────────────────────────────────────── */

type Panel = 'unc' | 'ledger';

const TABS: { id: Panel; label: string }[] = [
  { id: 'unc', label: 'Hàng đợi Duyệt UNC' },
  { id: 'ledger', label: 'Sổ hoàn ứng lái xe' },
];

export default function DemoPortPaymentsPage() {
  const [panel, setPanel] = useState<Panel>('unc');
  // APG tabs pattern: focus theo sau tab đang chọn khi arrow-nav (SF-2 review).
  const tabRefs = useRef<Record<Panel, HTMLButtonElement | null>>({ unc: null, ledger: null });

  const activatePanel = (next: Panel, focus = false) => {
    setPanel(next);
    if (focus) requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };

  return (
    <div className="demo-port-payments flex flex-col gap-6" data-testid="demo-port-payments-page">
      <header className="flex flex-wrap items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-primary text-brand-700">
          <nav.icon className="size-6" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-display-xs font-semibold text-primary">{nav.heading}</h1>
          <p className="max-w-[72ch] text-md text-tertiary">{nav.description}</p>
        </div>
      </header>

      {/* Segmented sub-tabs (spec §2: màn hình kế toán chia 2 sub-tabs) */}
      <div role="tablist" aria-label="Phân hệ Duyệt chi cảng" className="flex w-full max-w-md gap-1 rounded-lg bg-secondary p-1">
        {TABS.map((tab) => {
          const active = panel === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`port-payments-tab-${tab.id}`}
              ref={(el) => { tabRefs.current[tab.id] = el; }}
              aria-selected={active}
              aria-controls={`port-payments-panel-${tab.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => activatePanel(tab.id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const delta = e.key === 'ArrowRight' ? 1 : TABS.length - 1;
                const next = TABS[(TABS.findIndex((t) => t.id === panel) + delta) % TABS.length]!;
                activatePanel(next.id, true);
              }}
              className={cx(
                'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                active ? 'bg-primary text-primary shadow-xs' : 'text-tertiary hover:text-primary',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`port-payments-panel-${panel}`}
        aria-labelledby={`port-payments-tab-${panel}`}
        tabIndex={0}
      >
        {panel === 'unc' ? <UncQueuePanel /> : <DriverLedgerPanel />}
      </div>

      <p className="text-sm text-quaternary">
        Trang demo — dữ liệu tĩnh từ <code>frontend/src/demo/data</code>, trạng thái duyệt chỉ nằm
        trong phiên (refresh trả về fixtures), không gọi API.
      </p>
    </div>
  );
}
