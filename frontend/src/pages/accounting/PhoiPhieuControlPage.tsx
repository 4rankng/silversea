import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPhoiPhieuVoucher, getPhoiPhieuReport, listPhoiPhieuRows, listPhoiPhieuStk, type PhoiPhieuRow } from '../../api/phoiPhieuClient';
import { PhoiPhieuReportTable } from './PhoiPhieuControlPage.reports';
import { formatCurrency } from '../../lib/format';
import { UuiSelectField } from '../../design-system';
import { PhoiPhieuChiHoDialog } from '../../features/accounting/PhoiPhieuChiHoDialog';
import { PhoiPhieuTienDuongDialog } from '../../features/accounting/PhoiPhieuTienDuongDialog';

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

export default function PhoiPhieuControlPage() {
  const [filters, setFilters] = useState<Filters>({ dateFrom: '', dateTo: '', status: '', search: '', sortBy: 'grouped' });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [chiHoTripId, setChiHoTripId] = useState<number | null>(null);
  const [tienDuongTripId, setTienDuongTripId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const rowsQuery = useQuery({
    queryKey: ['phoi-phieu-rows', filters],
    queryFn: () => listPhoiPhieuRows(filters),
  });
  const stkQuery = useQuery({ queryKey: ['phoi-phieu-stk'], queryFn: () => listPhoiPhieuStk() });
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
      await queryClient.invalidateQueries({ queryKey: ['phoi-phieu-rows'] });
    } catch (error) {
      setMessage({ kind: 'err', text: error instanceof Error ? error.message : 'Không lập được phiếu.' });
    } finally {
      setIssuing(false);
    }
  }

  const totals = useMemo(() => {
    const visible = rows;
    return {
      thu: visible.reduce((sum, row) => sum + (row.chiHoThu ?? 0), 0),
      tra: visible.reduce((sum, row) => sum + (row.chiHoTra ?? 0), 0),
      tienDuong: visible.reduce((sum, row) => sum + (row.tienDuong ?? 0), 0),
    };
  }, [rows]);

  return (
    <div className="page-shell">
      <h1>Kiểm soát phơi phiếu - Tiền đường</h1>
      <div className="shipments-detail-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end', margin: '12px 0' }}>
        <label>Từ ngày <input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} /></label>
        <label>Đến ngày <input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} /></label>
        <UuiSelectField label="Trạng thái" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} options={TRIP_STATUS_OPTIONS} wrapperClassName="phoi-phieu-filter" />
        <label>Tìm kiếm <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Mã chuyến, container, khách" /></label>
        <UuiSelectField label="Sắp xếp" value={filters.sortBy} onChange={(e) => setFilters({ ...filters, sortBy: e.target.value as 'grouped' | 'date' })} options={[{ value: 'grouped', label: 'Gom theo số xe' }, { value: 'date', label: 'Theo ngày' }]} wrapperClassName="phoi-phieu-filter" />
      </div>

      {message && <p role="status" style={{ color: message.kind === 'ok' ? 'var(--ok, #16a34a)' : 'var(--err, #dc2626)' }}>{message.text}</p>}
      {rowsQuery.isError && <p role="alert">Không tải được bảng kiểm soát. Vui lòng thử lại.</p>}
      <div style={{ display: 'flex', gap: 12, alignItems: 'end', margin: '8px 0' }}>
        <UuiSelectField label="Loại phiếu" value={direction} onChange={(e) => setDirection(e.target.value as 'IN' | 'OUT')}
          options={[{ value: 'OUT', label: 'Phiếu chi' }, { value: 'IN', label: 'Phiếu thu' }]} wrapperClassName="phoi-phieu-filter" />
        <UuiSelectField label="Số tài khoản quỹ (STK)" value={treasuryAccountId} onChange={(e) => setTreasuryAccountId(e.target.value)}
          options={[{ value: '', label: '— Chọn STK —' }, ...(stkQuery.data?.items ?? []).map((account) => ({ value: String(account.id), label: account.code + ' - ' + account.name }))]} wrapperClassName="phoi-phieu-filter" />
        <button type="button" className="btn-primary" disabled={issuing || selected.size === 0} onClick={() => void issueVoucher()}>
          {issuing ? 'Đang lập…' : `Lập phiếu ${direction === 'IN' ? 'thu' : 'chi'} (${selected.size} dòng)`}
        </button>
      </div>

      <div className="shipment-container-ledger" role="region" aria-label="Bảng kiểm soát phơi phiếu" tabIndex={0}>
        <table className="tt-table">
          <caption>Bảng kiểm soát phơi phiếu - Tiền đường</caption>
          <thead><tr>
            <th scope="col"><input type="checkbox" aria-label="Chọn tất cả" checked={allSelected} onChange={toggleAll} /></th>
            <th scope="col">Lịch trình</th>
            <th scope="col">Khách hàng &amp; Tuyến đường</th>
            <th scope="col">Thông số container</th>
            <th scope="col">Địa điểm nâng / hạ</th>
            <th scope="col">Thông tin xe</th>
            <th scope="col">Chi hộ (Phải thu / Phải trả)</th>
            <th scope="col">Tiền đường</th>
            <th scope="col">Trạng thái</th>
            <th scope="col">Ngày</th>
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
                <td>
                  Phải thu: {money(row.chiHoThu)}<br />Phải trả: {money(row.chiHoTra)}
                  <button type="button" className="btn-secondary btn--sm" onClick={() => setChiHoTripId(row.tripId)}>Xem chi tiết</button>
                </td>
                <td>{money(row.tienDuong)}<button type="button" className="btn-secondary btn--sm" onClick={() => setTienDuongTripId(row.tripId)}>Xem chi tiết</button></td>
                <td>{row.tripStatus ? STATUS_LABELS[row.tripStatus] ?? row.tripStatus : '—'}</td>
                <td>{row.departureDate ?? '—'}</td>
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
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ['phoi-phieu-rows'] })}
        />
      )}
      <div style={{ margin: '16px 0' }}>
        <h2 style={{ fontSize: 'var(--text-body-size)' }}>Báo cáo tháng</h2>
        <PhoiPhieuReportTable kind="THU" dateFrom={filters.dateFrom} dateTo={filters.dateTo} />
        <PhoiPhieuReportTable kind="TRA" dateFrom={filters.dateFrom} dateTo={filters.dateTo} />
      </div>
      {chiHoTripId != null && (
        <PhoiPhieuChiHoDialog
          tripId={chiHoTripId}
          onClose={() => setChiHoTripId(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ['phoi-phieu-rows'] })}
        />
      )}
    </div>
  );
}