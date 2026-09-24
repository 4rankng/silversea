import { useMemo, useState } from 'react';
import { ReceiptText } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assignPhoiPhieuTruckAccountant, createPhoiPhieuVoucher, listPhoiPhieuRows, listPhoiPhieuStk, listPhoiPhieuTruckAssignments, type PhoiPhieuRow } from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';
import { PhoiPhieuReportTable } from './PhoiPhieuControlPage.reports';
import { formatCurrency, formatDate } from '../../lib/format';
import { UuiSelectField } from '../../design-system';
import { PhoiPhieuChiHoDialog } from '../../features/accounting/PhoiPhieuChiHoDialog';
import { PhoiPhieuTienDuongDialog } from '../../features/accounting/PhoiPhieuTienDuongDialog';
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
  value == null || !Number.isFinite(value) ? 'Chưa xác định' : formatCurrency(value);

interface Filters {
  dateFrom: string; dateTo: string; status: string; search: string; sortBy: 'grouped' | 'date';
}

/** Card 20260921_8 — vehicle → kế toán phơi phiếu assignments: one vehicle
 *  belongs to exactly one accountant; the unassigned bucket stays visible so
 *  nothing is missed. Saves go through the version-guarded reassignment API. */
function PhoiPhieuTruckAssignments() {
  const queryClient = useQueryClient();
  const boardQuery = useQuery({
    queryKey: qk.phoiPhieu.truckAssignments,
    queryFn: listPhoiPhieuTruckAssignments,
  });
  const [message, setMessage] = useState<string | null>(null);
  const assignments = boardQuery.data?.assignments ?? [];
  const unassigned = boardQuery.data?.unassignedTrucks ?? [];
  const accountants = boardQuery.data?.accountants ?? [];

  const saveMutation = useMutation({
    mutationFn: (input: { truckId: number; accountantId: number | null; expectedVersion: number }) =>
      assignPhoiPhieuTruckAccountant(input.truckId, { accountantId: input.accountantId, expectedVersion: input.expectedVersion }),
    onSuccess: () => {
      setMessage(null);
      void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.truckAssignments });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  return (
    <details style={{ margin: '16px 0' }}>
      <summary style={{ cursor: 'pointer', fontSize: 'var(--text-body-size)' }}>Phân công xe cho kế toán phơi phiếu</summary>
      {message && <p role="alert">{message}</p>}
      <table className="tt-table" style={{ fontSize: 'var(--text-caption-size)', margin: '8px 0' }}>
        <caption>Xe đã phân công</caption>
        <thead><tr><th>Biển số</th><th>Kế toán phụ trách</th><th aria-label="Lưu" /></tr></thead>
        <tbody>
          {assignments.map((row) => (
            <AssignmentRow key={row.truckId} row={row} accountants={accountants} onSave={saveMutation.mutate} />
          ))}
          {assignments.length === 0 && <tr><td colSpan={3}>Chưa có xe nào được phân công.</td></tr>}
        </tbody>
      </table>
      <p style={{ fontSize: 'var(--text-caption-size)' }}>
        <strong>Xe chưa phân công:</strong>{' '}
        {unassigned.length === 0
          ? 'không còn'
          : unassigned.map((truck) => truck.plate).join(', ')}
      </p>
    </details>
  );
}

function AssignmentRow({ row, accountants, onSave }: {
  row: { truckId: number; plate: string; accountantId: number | null; version: number };
  accountants: Array<{ id: number; fullName: string | null }>;
  onSave: (input: { truckId: number; accountantId: number | null; expectedVersion: number }) => void;
}) {
  const [picked, setPicked] = useState<string>(row.accountantId == null ? '' : String(row.accountantId));
  return (
    <tr>
      <td>{row.plate}</td>
      <td>
        <UuiSelectField
          label={`Kế toán phụ trách ${row.plate}`}
          hideLabel
          value={picked}
          onChange={(event) => setPicked(event.target.value)}
          options={[{ value: '', label: '— Chưa gán —' }, ...accountants.map((accountant) => ({ value: String(accountant.id), label: accountant.fullName ?? `Kế toán #${accountant.id}` }))]}
          width="content"
        />
      </td>
      <td>
        <button
          type="button"
          onClick={() => onSave({ truckId: row.truckId, accountantId: picked === '' ? null : Number(picked), expectedVersion: row.version })}
        >
          Lưu
        </button>
      </td>
    </tr>
  );
}

export default function PhoiPhieuControlPage() {
  const [filters, setFilters] = useState<Filters>({ dateFrom: '', dateTo: '', status: '', search: '', sortBy: 'grouped' });
  const [reportScope, setReportScope] = useState<'' | 'SELF' | 'ALL' | 'UNASSIGNED'>('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
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
  const allSelected = rows.length > 0 && rows.filter(canSelect).every((row) => selected.has(row.tripId));

  function toggleRow(row: PhoiPhieuRow) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(row.tripId)) next.delete(row.tripId);
      else next.add(row.tripId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) => {
      if (rows.filter(canSelect).every((row) => current.has(row.tripId))) {
        return new Set();
      }
      return new Set(rows.filter(canSelect).map((row) => row.tripId));
    });
  }

  async function issueVoucher() {
    if (selected.size === 0) {
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
        tripIds: [...selected], direction, treasuryAccountId: Number(treasuryAccountId),
      });
      setMessage({ kind: 'ok', text: `Đã lập phiếu ${voucher.code}: ${voucher.entries} khoản, tổng ${formatCurrency(voucher.total)} — sổ quỹ đã được điều chỉnh.` });
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.rowsAll });
    } catch (error) {
      setMessage({ kind: 'err', text: error instanceof Error ? error.message : 'Không lập được phiếu.' });
    } finally {
      setIssuing(false);
    }
  }

  return (
    <div className="page-shell">
      <h1>Kiểm soát phơi phiếu - Tiền đường</h1>
      {/* Card 20260924_12: page-owned auto-fit grid (filter-bar law §5) —
          tracks band 220–320px pack every control along one row and wrap only
          when out of space; the shared .ds-uui-select width:100% now fills a
          ≤320px cell instead of claiming the whole row. */}
      <div className="ppc-filters">
        <label>Từ ngày <input className="input" type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} /></label>
        <label>Đến ngày <input className="input" type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} /></label>
        <UuiSelectField label="Trạng thái" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} options={TRIP_STATUS_OPTIONS} />
        <label>Tìm kiếm <input className="input" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Mã chuyến, container, khách" /></label>
        <UuiSelectField label="Sắp xếp" value={filters.sortBy} onChange={(e) => setFilters({ ...filters, sortBy: e.target.value as 'grouped' | 'date' })} options={[{ value: 'grouped', label: 'Gom theo số xe' }, { value: 'date', label: 'Theo ngày' }]} />
      </div>

      {message && <p role="status" style={{ color: message.kind === 'ok' ? 'var(--ok, #16a34a)' : 'var(--err, #dc2626)' }}>{message.text}</p>}
      {rowsQuery.isError && <p role="alert">Không tải được bảng kiểm soát. Vui lòng thử lại.</p>}
      {/* Voucher bar keeps its own row; the button rides a right-aligned
          full row below the two selects — never over them (card 20260924_12). */}
      <div className="ppc-filter-actions">
        <UuiSelectField label="Loại phiếu" value={direction} onChange={(e) => setDirection(e.target.value as 'IN' | 'OUT')}
          options={[{ value: 'OUT', label: 'Phiếu chi' }, { value: 'IN', label: 'Phiếu thu' }]} />
        <UuiSelectField label="Số tài khoản quỹ (STK)" value={treasuryAccountId} onChange={(e) => setTreasuryAccountId(e.target.value)}
          options={[{ value: '', label: '— Chọn STK —' }, ...(stkQuery.data?.items ?? []).map((account) => ({ value: String(account.id), label: account.code + ' - ' + account.name }))]} />
        <button type="button" className="btn btn--primary" disabled={issuing || selected.size === 0} onClick={() => void issueVoucher()}>
          {issuing
            ? 'Đang lập…'
            : selected.size === 0
              ? `Lập phiếu ${direction === 'IN' ? 'thu' : 'chi'} — chọn dòng đã duyệt`
              : `Lập phiếu ${direction === 'IN' ? 'thu' : 'chi'} (${[...selected].reduce((sum, tripId) => {
                  const row = rows.find((candidate) => candidate.tripId === tripId);
                  return sum + (row ? (direction === 'IN' ? row.eligibleIn : row.eligibleOut) : 0);
                }, 0)} khoản)`}
        </button>
      </div>

      <div className="shipment-container-ledger" role="region" aria-label="Bảng kiểm soát phơi phiếu" tabIndex={0}>
        <table className="tt-table ppc-board">
          <caption>Bảng kiểm soát phơi phiếu - Tiền đường</caption>
          <thead><tr>
            <th scope="col" className="ppc-col--select"><input type="checkbox" aria-label="Chọn tất cả" checked={allSelected} onChange={toggleAll} /></th>
            <th scope="col">Lịch trình</th>
            <th scope="col" className="ppc-col--customer-route">Khách hàng &amp; Tuyến đường</th>
            <th scope="col">Thông số container</th>
            <th scope="col">Địa điểm nâng / hạ</th>
            <th scope="col">Thông tin xe</th>
            <th scope="col" className="ppc-col--chiho">Chi hộ (Phải thu / Phải trả)</th>
            <th scope="col" className="ppc-col--money">Tiền đường</th>
            <th scope="col" className="ppc-col--status">Trạng thái</th>
            <th scope="col" className="ppc-col--date">Ngày</th>
            <th scope="col">Ghi chú vận đơn</th>
            <th scope="col">Ghi chú lái xe</th>
          </tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.tripId}>
                <td><input type="checkbox" aria-label={`Chọn chuyến ${row.tripCode ?? ''} container ${row.containerNumber ?? ''}`} disabled={!canSelect(row)} checked={selected.has(row.tripId)} onChange={() => toggleRow(row)} /></td>
                <td>{row.tripCode ?? '—'}<br /><small>{row.billOrBooking ?? ''}</small></td>
                <td>{row.customerName ?? '—'}<br /><small>{row.routeName ?? ''}</small></td>
                <td>{row.containerNumber ?? '—'}<br /><small>{row.containerTypeLabel ?? ''}</small><br /><small>Trọng tải: {row.cargoWeightKg != null ? row.cargoWeightKg.toLocaleString('vi-VN') + ' kg' : 'Chưa có trọng tải'}</small></td>
                <td>{row.liftSite ?? '—'} → {row.dropSite ?? '—'}</td>
                <td>{row.plateNumber ?? '—'}<br /><small>{row.driverName ?? ''}</small></td>
                <td className="ppc-col--chiho">
                  <span className="ppc-line">Phải thu: <span className="ppc-value">{money(row.chiHoThu)}</span></span>
                  <span className="ppc-line">Phải trả: <span className="ppc-value">{money(row.chiHoTra)}</span></span>
                  <span className="ppc-cell-actions">
                    <button type="button" className="ppc-icon-btn" aria-label={`Chi tiết chi hộ ${row.tripCode ?? ''}`} title="Chi tiết chi hộ" onClick={() => { setTienDuongTripId(null); setChiHoTripId(row.tripId); }}><ReceiptText size={14} aria-hidden="true" /></button>
                  </span>
                </td>
                <td className="ppc-col--money">
                  <span className="ppc-line"><span className="ppc-value">{money(row.tienDuong)}</span></span>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setChiHoTripId(null); setTienDuongTripId(row.tripId); }}>Xem chi tiết</button>
                </td>
                <td className="ppc-col--status">{row.tripStatus ? STATUS_LABELS[row.tripStatus] ?? row.tripStatus : '—'}</td>
                <td className="ppc-col--date">{formatDate(row.departureDate)}</td>
                <td>{row.cusDispatchNotes.length ? row.cusDispatchNotes.join('; ') : '—'}</td>
                <td>{row.driverNote ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tienDuongTripId != null && (
        <PhoiPhieuTienDuongDialog
          tripId={tienDuongTripId}
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
          onClose={() => setChiHoTripId(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.rowsAll })}
        />
      )}
    </div>
  );
}