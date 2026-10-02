import { useEffect, useMemo, useState } from 'react';
import { LedgerRecordList, type LedgerRecord } from '../../components/shared/LedgerRecordList';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { ReceiptText } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPhoiPhieuVoucher, listPhoiPhieuRows, listPhoiPhieuStk, type PhoiPhieuRow, type ChiHoConfirmation } from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';
import { PhoiPhieuReportTable } from './PhoiPhieuControlPage.reports';
import { formatNumber, formatCurrency, formatDate } from '../../lib/format';
import { billBookingReference } from '../../lib/business-reference';
import { PageHeader } from '../../components/UI';
import { Money } from '../../components/shared/Money';
import { FilterDropdown } from '../../components/FilterDropdown';
import { DateRangeFields, FilterBar, UuiSelectField } from '../../design-system';
import { PhoiPhieuChiHoDialog } from '../../features/accounting/PhoiPhieuChiHoDialog';
import { OpsExpenseNoteLines } from '../../features/dispatch/components/OpsExpenseNoteLines';
import { PhoiPhieuTienDuongDialog } from '../../features/accounting/PhoiPhieuTienDuongDialog';
import { useTableRowSelection } from '../../hooks/useTableRowSelection';
import { PhoiPhieuTruckAssignments } from '../../features/accounting/PhoiPhieuTruckAssignments';
import './PhoiPhieuControlPage.css';

const TRIP_STATUS_OPTIONS = [
  { value: '', label: 'Tất cả' },
  { value: 'CREATED', label: 'Đã tạo chuyến' },
  { value: 'IN_TRANSIT', label: 'Đang chạy' },
  { value: 'COMPLETED', label: 'Đã hoàn thành' },
];

const STATUS_LABELS: Record<string, string> = {
  CREATED: 'Đã tạo chuyến', IN_TRANSIT: 'Đang chạy', COMPLETED: 'Đã hoàn thành',
};

const money = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? 'Chưa xác định' : <Money value={value} />;

interface Filters {
  dateFrom: string; dateTo: string; status: string; search: string; sortBy: 'grouped' | 'date';
  confirmation: ChiHoConfirmation | '';
}

export default function PhoiPhieuControlPage() {
  const phone = useMediaQuery('(max-width: 640px)');
  const [filters, setFilters] = useState<Filters>({ dateFrom: '', dateTo: '', status: '', search: '', sortBy: 'grouped', confirmation: '' });
  const [reportScope, setReportScope] = useState<'' | 'SELF' | 'ALL' | 'UNASSIGNED'>('');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [chiHoTripId, setChiHoTripId] = useState<number | null>(null);
  // Card 20260923_11: the board owns two detail surfaces — exactly one may be
  // open at a time, so each trigger clears the other's state.
  const [tienDuongTripId, setTienDuongTripId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const rowsQuery = useQuery({
    queryKey: qk.phoiPhieu.rows(filters),
    queryFn: () => listPhoiPhieuRows(filters),
  });
  const stkQuery = useQuery({ queryKey: qk.phoiPhieu.stk, queryFn: () => listPhoiPhieuStk() });
  const rows = useMemo(() => rowsQuery.data?.items ?? [], [rowsQuery.data]);
  const canSelect = (row: PhoiPhieuRow) => row.confirmable;
  // Card 20260929_207: the checkbox column is gone app-wide — a row is picked by
  // clicking it (keyboard: focus the row, press Space). `selectable` still
  // decides WHICH rows may be picked, so a row that cannot be issued stays
  // inert instead of silently taking part in the voucher.
  const selection = useTableRowSelection<number>();
  const { clear: clearSelection } = selection;
  const selectableRows = useMemo(() => rows.filter(canSelect), [rows]);
  const selectedIds = rowsQuery.isFetching || rowsQuery.isError ? [] : selection.selectedAmong(selectableRows.map((row) => row.tripId));
  const allSelected = selection.allOfSelected(selectableRows.map((row) => row.tripId));
  const selectedCount = selectedIds.length;
  useEffect(() => { clearSelection(); }, [filters.dateFrom, filters.dateTo, filters.status, filters.search, filters.confirmation, clearSelection]);
  // Card 20260929_207: the "select every row" affordance moved out of the
  // deleted header checkbox and into the toolbar, where its scope is stated in
  // the label: it covers the rows ON THIS PAGE, never the whole filtered set.
  function toggleAll() {
    if (allSelected) selection.clear();
    else selection.selectAll(selectableRows.map((row) => row.tripId));
  }

  async function issueVoucher() {
    if (selectedIds.length === 0) {
      setMessage({ kind: 'err', text: 'Chọn ít nhất một dòng.' });
      return;
    }
    if (!treasuryAccountId) {
      setMessage({ kind: 'err', text: 'Chọn số tài khoản quỹ (STK).' });
      return;
    }
    setIssuing(true);
    try {
      const voucher = await createPhoiPhieuVoucher({
        tripIds: selectedIds, direction, treasuryAccountId: Number(treasuryAccountId),
      });
      setMessage({ kind: 'ok', text: `Đã lập phiếu ${voucher.code}: ${voucher.entries} khoản, tổng ${formatCurrency(voucher.total)} — sổ quỹ đã được điều chỉnh.` });
      selection.clear();
      await queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.rowsAll });
    } catch (error) {
      setMessage({ kind: 'err', text: error instanceof Error ? error.message : 'Không lập được phiếu.' });
    } finally {
      setIssuing(false);
    }
  }

  // Secondary criteria share the existing filter trigger and reset action.
  const secondaryCount = (filters.status ? 1 : 0) + (filters.sortBy !== 'grouped' ? 1 : 0)
    + (direction !== 'OUT' ? 1 : 0) + (treasuryAccountId ? 1 : 0) + (filters.confirmation ? 1 : 0);
  const resetSecondary = () => {
    setFilters((current) => ({ ...current, status: '', sortBy: 'grouped', confirmation: '' }));
    setDirection('OUT');
    setTreasuryAccountId('');
  };
  const voucherLabel = issuing
    ? 'Đang lập…'
    : selectedIds.length === 0
      ? `Lập phiếu ${direction === 'IN' ? 'thu' : 'chi'}`
      : `Lập phiếu ${direction === 'IN' ? 'thu' : 'chi'} (${selectedIds.reduce((sum, tripId) => {
          const row = rows.find((candidate) => candidate.tripId === tripId);
          return sum + (row ? (direction === 'IN' ? row.eligibleIn : row.eligibleOut) : 0);
        }, 0)} khoản)`;

  return (
    <div className="page-shell">
      <PageHeader title="Kiểm soát phơi phiếu" />
      {/* Card 20260927_152: the ONE shared strip. The search, the from/to pair
          and the Lập phiếu action are the bar's own items; the four secondary
          criteria render inline while the strip still fits two rows and fold
          into `Bộ lọc (N)` only when the width leaves no other choice. The page
          declares no filter layout — that is the bar's job (filter-bar law). */}
      <FilterBar
        search={{
          value: filters.search,
          onChange: (search) => setFilters((current) => ({ ...current, search })),
          placeholder: 'Bill/Booking, phí, hóa đơn',
          ariaLabel: 'Tìm kiếm',
        }}
        actions={(
          <div className="ppc-actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={toggleAll}
              disabled={selectableRows.length === 0}
              title={allSelected ? 'Bỏ chọn các dòng kết quả' : `Chọn ${selectableRows.length} dòng trong kết quả`}
            >
              {allSelected ? (phone ? 'Bỏ chọn tất cả' : 'Bỏ chọn dòng trang này') : `${phone ? 'Chọn tất cả' : 'Chọn cả trang này'} (${selectableRows.length})`}
            </button>
            <button type="button" className="btn btn--primary" disabled={issuing || selectedIds.length === 0} title={selectedIds.length === 0 ? 'Chọn ít nhất một dòng đã đối chiếu để lập phiếu' : undefined} onClick={() => void issueVoucher()}>
              {voucherLabel}
            </button>
          </div>
        )}
      >
        <DateRangeFields
          id="phoi-phieu-date-range"
          ariaLabel="Khoảng ngày hẹn"
          from={filters.dateFrom}
          to={filters.dateTo}
          onChange={({ from, to }) => setFilters((current) => ({ ...current, dateFrom: from, dateTo: to }))}
        />
        <FilterDropdown count={secondaryCount} ariaLabel="Bộ lọc" dialogLabel="Bộ lọc phơi phiếu" onReset={resetSecondary}>
          <UuiSelectField label="Trạng thái" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} options={TRIP_STATUS_OPTIONS} />
          <UuiSelectField label="Đối chiếu chi hộ" value={filters.confirmation} onChange={(event) => setFilters({ ...filters, confirmation: event.target.value as Filters['confirmation'] })}
            options={[{ value: '', label: 'Tất cả' }, { value: 'CONFIRMED', label: 'Đã đối chiếu' }, { value: 'UNCONFIRMED', label: 'Chưa đối chiếu' }]} />
          <UuiSelectField label="Sắp xếp" value={filters.sortBy} onChange={(e) => setFilters({ ...filters, sortBy: e.target.value as 'grouped' | 'date' })} options={[{ value: 'grouped', label: 'Gom theo số xe' }, { value: 'date', label: 'Theo ngày' }]} />
          <UuiSelectField label="Loại phiếu" value={direction} onChange={(e) => setDirection(e.target.value as 'IN' | 'OUT')}
            options={[{ value: 'OUT', label: 'Phiếu chi' }, { value: 'IN', label: 'Phiếu thu' }]} />
          <UuiSelectField label="Số tài khoản quỹ (STK)" value={treasuryAccountId} onChange={(e) => setTreasuryAccountId(e.target.value)}
            options={[{ value: '', label: '— Chọn STK —' }, ...(stkQuery.data?.items ?? []).map((account) => ({ value: String(account.id), label: account.code + ' - ' + account.name }))]} />
        </FilterDropdown>
      </FilterBar>

      {message && <p role="status" style={{ color: message.kind === 'ok' ? 'var(--ok, #16a34a)' : 'var(--err, #dc2626)' }}>{message.text}</p>}
      {rowsQuery.isError && <p role="alert">Không tải được bảng kiểm soát. Vui lòng thử lại.</p>}

      {/* Card 20260929_207: the selection model is no longer a checkbox column, so
          the board says so once, and keeps a live count. A row that cannot be
          issued is dimmed and inert rather than looking pickable. */}
      <p className="ppc-selection-hint" role="status">
        {selectedCount === 0
          ? `${phone ? 'Dùng ô Chọn của bản ghi' : 'Bấm vào một dòng để chọn'} · ${selectableRows.length} dòng lập được phiếu trong kết quả`
          : `Đã chọn ${selectedCount} dòng`}
      </p>
      <LedgerRecordList rows={rows.map((row): LedgerRecord => ({
        key: row.tripId, title: billBookingReference(row.billOrBooking),
        subtitle: row.customerName ?? 'Chưa có khách hàng',
        selected: selection.isSelected(row.tripId), selectable: canSelect(row),
        onSelect: () => selection.toggle(row.tripId),
        facts: [
          { key: 'factory', label: 'Nhà máy', value: row.factoryName ?? 'Chưa có nhà máy', primary: true },
          { key: 'route', label: 'Tuyến', value: row.routeName ?? 'Chưa có tuyến', primary: true },
          { key: 'container', label: 'Container', value: <>{row.containerNumber ?? '—'} · {row.containerTypeLabel ?? '—'}</>, primary: true },
          { key: 'date', label: 'Ngày hẹn', value: formatDate(row.transportDate ?? null, { empty: 'Chưa có ngày hẹn' }), primary: true },
          { key: 'status', label: 'Trạng thái', value: row.tripStatus ? STATUS_LABELS[row.tripStatus] ?? row.tripStatus : '—', primary: true },
          { key: 'chiHoThu', label: 'Chi hộ phải thu', value: money(row.chiHoThu), primary: true },
          { key: 'chiHoTra', label: 'Chi hộ phải trả', value: money(row.chiHoTra), primary: true },
          { key: 'road', label: 'Tiền đường', value: money(row.tienDuong), primary: true },
          { key: 'capacity', label: 'Trọng tải container', value: row.containerPayloadKg != null ? formatNumber(row.containerPayloadKg) + ' kg' : '—' },
          { key: 'weight', label: 'Trọng lượng hàng', value: row.cargoWeightKg != null ? formatNumber(row.cargoWeightKg) + ' kg' : 'Chưa có' },
          { key: 'sites', label: 'Địa điểm nâng / hạ', value: <>{row.liftSite ?? '—'} → {row.dropSite ?? '—'}</> },
          { key: 'truck', label: 'Biển số xe', value: row.plateNumber ?? '—' },
          { key: 'carrier', label: 'Nhà vận tải', value: row.carrierName ?? 'Chưa xác định nhà vận tải' },
          { key: 'driver', label: 'Lái xe', value: row.driverName ?? 'Chưa có lái xe' },
          { key: 'cusNotes', label: 'Ghi chú vận tải', value: row.cusDispatchNotes.length ? row.cusDispatchNotes.join('; ') : '—' },
          { key: 'opsNotes', label: 'Ghi chú chi phí OPS', value: row.opsRecoveryNotes?.length ? <OpsExpenseNoteLines notes={row.opsRecoveryNotes} /> : '—' },
          { key: 'driverNotes', label: 'Ghi chú lái xe', value: row.driverNote ?? '—' },
          { key: 'chiHoAction', label: 'Chi hộ', value: <button type="button" className="btn btn--secondary" aria-label={`Chi tiết chi hộ ${billBookingReference(row.billOrBooking)}`} onClick={() => { setTienDuongTripId(null); setChiHoTripId(row.tripId); }}>Chi tiết chi hộ</button> },
          { key: 'roadAction', label: 'Tiền đường', value: <button type="button" className="btn btn--secondary" onClick={() => { setChiHoTripId(null); setTienDuongTripId(row.tripId); }}>Xem chi tiết</button> },
        ],
      }))} />
      <div className="ppc-board-wrap ledger-desktop" role="region" aria-label="Bảng kiểm soát phơi phiếu" tabIndex={0}>
        <table className="tt-table ops-table ppc-board">
          <caption className="sr-only">Phơi phiếu và tiền đường theo chuyến</caption>
          <thead><tr>
            <th scope="col" className="ppc-col--lich-trinh">Số Bill / Booking</th>
            <th scope="col" className="ppc-col--customer-route">Khách hàng / Nhà máy / Tuyến</th>
            <th scope="col" className="ppc-col--thongso">Thông số container</th>
            <th scope="col" className="ppc-col--diadiem">Địa điểm nâng / hạ</th>
            <th scope="col" className="ppc-col--xe">Thông tin xe</th>
            <th scope="col" className="ppc-col--chiho" title="Chi hộ: phải thu và phải trả của lô hàng">Chi hộ (thu / trả)</th>
            <th scope="col" className="ppc-col--money">Tiền đường</th>
            <th scope="col" className="ppc-col--status">Trạng thái</th>
            <th scope="col" className="ppc-col--date">Ngày hẹn</th>
            <th scope="col" className="ppc-col--ghichu" title="Ghi chú vận tải của CUS và điều vận">Ghi chú vận tải</th>
            {/* Card 20260928_162 — the second ruled surface for the not-charged
                reason. Same content as the dispatch plan grids, through the same
                shared component; reason text only, never an amount. */}
            <th scope="col" className="ppc-col--ghichu-ops" title="Lý do khoản không thu khách và ghi chú thu khách của lô — chỉ nội dung lý do, không kèm số tiền">Ghi chú chi phí OPS</th>
            <th scope="col" className="ppc-col--ghichu">Ghi chú lái xe</th>
          </tr></thead>
          <tbody>
            {rows.map((row) => {
              const pickable = canSelect(row);
              const isSelected = selection.isSelected(row.tripId);
              return (
              <tr
                key={row.tripId}
                data-selected={isSelected || undefined}
                aria-selected={pickable ? isSelected : undefined}
                className={pickable ? 'ppc-row--pickable' : 'ppc-row--locked'}
                tabIndex={pickable ? 0 : undefined}
                {...selection.rowProps(row.tripId, { selectable: pickable })}
              >
                <td className="ppc-col--lich-trinh"><span className="ppc-identity">{billBookingReference(row.billOrBooking)}</span></td>
                <td className="ppc-col--customer-route">Khách hàng: {row.customerName ?? 'Chưa có khách hàng'}<br /><small>Nhà máy: {row.factoryName ?? 'Chưa có nhà máy'}</small><br /><small>Tuyến: {row.routeName ?? 'Chưa có tuyến'}</small></td>
                <td className="ppc-col--thongso">
                  <span className="ppc-identity">{row.containerNumber ?? '—'}</span>
                  <br /><small>{row.containerTypeLabel ?? ''}</small>
                  {/* Card 20260928_172: the PM asked for TRỌNG TẢI CONTAINER, and
                      the line that used to read "Trọng tải" was the CARGO weight —
                      a different number that reads the same. Now both are named. A
                      type with no ISO rating prints "—" rather than a guess. */}
                  <br /><small>Trọng tải container: {row.containerPayloadKg != null ? formatNumber(row.containerPayloadKg) + ' kg' : '—'}</small>
                  <br /><small>Trọng lượng hàng: {row.cargoWeightKg != null ? formatNumber(row.cargoWeightKg) + ' kg' : 'Chưa có'}</small>
                </td>
                <td className="ppc-col--diadiem">{row.liftSite ?? '—'} → {row.dropSite ?? '—'}</td>
                <td className="ppc-col--xe"><span className="ppc-identity">{row.plateNumber ?? '—'}</span><br /><small>Nhà vận tải: {row.carrierName ?? 'Chưa xác định nhà vận tải'}</small><br /><small>Lái xe: {row.driverName ?? 'Chưa có lái xe'}</small></td>
                <td className="ppc-col--chiho">
                  <span className="ppc-line">Phải thu: <span className="ppc-value">{money(row.chiHoThu)}</span></span>
                  <span className="ppc-line">Phải trả: <span className="ppc-value">{money(row.chiHoTra)}</span></span>
                  <span className="ppc-cell-actions">
                    <button type="button" className="btn btn--secondary btn--icon" aria-label={`Chi tiết chi hộ ${billBookingReference(row.billOrBooking)}`} title="Chi tiết chi hộ" onClick={() => { setTienDuongTripId(null); setChiHoTripId(row.tripId); }}><ReceiptText size={14} aria-hidden="true" /></button>
                  </span>
                </td>
                <td className="ppc-col--money">
                  <span className="ppc-line"><span className="ppc-value">{money(row.tienDuong)}</span></span>
                  <button type="button" className="btn btn--secondary" onClick={() => { setChiHoTripId(null); setTienDuongTripId(row.tripId); }}>Xem chi tiết</button>
                </td>
                <td className="ppc-col--status">{row.tripStatus ? STATUS_LABELS[row.tripStatus] ?? row.tripStatus : '—'}</td>
                <td className="ppc-col--date">{formatDate(row.transportDate ?? null, { empty: 'Chưa có ngày hẹn' })}</td>
                <td className="ppc-col--ghichu">{row.cusDispatchNotes.length ? row.cusDispatchNotes.join('; ') : '—'}</td>
                <td className="ppc-col--ghichu-ops">{row.opsRecoveryNotes?.length ? <OpsExpenseNoteLines notes={row.opsRecoveryNotes} /> : '—'}</td>
                <td className="ppc-col--ghichu">{row.driverNote ?? '—'}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="ppc-board-hint ledger-desktop">Vuốt ngang để xem đầy đủ các cột.</p>
      {tienDuongTripId != null && (
        <PhoiPhieuTienDuongDialog
          tripId={tienDuongTripId}
          billOrBooking={rows.find((row) => row.tripId === tienDuongTripId)?.billOrBooking}
          onClose={() => setTienDuongTripId(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.rowsAll })}
        />
      )}
      <div style={{ margin: '16px 0' }}>
        <h2 style={{ fontSize: 'var(--text-body-size)' }}>Báo cáo tháng</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
          <label style={{ fontSize: 'var(--text-caption-size)' }}>Phạm vi: </label>
          <UuiSelectField
            label="Phạm vi báo cáo"
            hideLabel
            value={reportScope}
            onChange={(event) => setReportScope(event.target.value as typeof reportScope)}
            options={[
              { value: '', label: 'Mặc định (của tôi với kế toán)' },
              { value: 'SELF', label: 'Của tôi' },
              { value: 'ALL', label: 'Tất cả' },
              { value: 'UNASSIGNED', label: 'Chưa gán' },
            ]}
            width="content"
          />
        </div>
        <PhoiPhieuReportTable kind="THU" dateFrom={filters.dateFrom} dateTo={filters.dateTo} scope={reportScope || undefined} />
        <PhoiPhieuReportTable kind="TRA" dateFrom={filters.dateFrom} dateTo={filters.dateTo} scope={reportScope || undefined} />
      </div>
      <PhoiPhieuTruckAssignments />
      {chiHoTripId != null && (
        <PhoiPhieuChiHoDialog
          tripId={chiHoTripId}
          billOrBooking={rows.find((row) => row.tripId === chiHoTripId)?.billOrBooking}
          confirmation={filters.confirmation || undefined}
          onClose={() => setChiHoTripId(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.rowsAll })}
        />
      )}
    </div>
  );
}
