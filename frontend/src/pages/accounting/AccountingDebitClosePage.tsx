import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAccountingDebitBoard,
  sendRateAdjustmentRequests,
  confirmRateAdjustments,
  withdrawRateAdjustments,
  type AccountingDebitBoardRow,
} from '../../api/accountingDebitClient';
import { formatCurrency } from '../../lib/format';

const money = (value: string | null) => {
  if (value == null) return <span style={{ color: 'var(--text-muted, #64748b)' }}>Chưa xác định</span>;
  return formatCurrency(Number(value));
};

/** Excel/Sheets-style checkbox filter dropdown (card: chỉ 2 cột được lọc). */
function DebitFilterDropdown({ label, values, selected, onChange }: {
  label: string;
  values: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  return (
    <details style={{ position: 'relative', display: 'inline-block' }}>
      <summary style={{ cursor: 'pointer', fontSize: 'var(--text-caption-size)', listStyle: 'none' }}>
        {label}
        {selected.size > 0 ? ` (${selected.size})` : ''} ▾
      </summary>
      <div style={{
        position: 'absolute', zIndex: 30, background: 'var(--surface, #fff)',
        border: '1px solid var(--border, #e2e8f0)', borderRadius: 8, padding: '8px 10px',
        minWidth: 200, maxHeight: 260, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
      }}>
        {values.length === 0 && <span style={{ fontSize: 'var(--text-caption-size)' }}>Không có dữ liệu</span>}
        {values.map((value) => (
          <label key={value} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '3px 0', fontSize: 'var(--text-caption-size)' }}>
            <input
              type="checkbox"
              checked={selected.has(value)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(value); else next.delete(value);
                onChange(next);
              }}
            />
            {value}
          </label>
        ))}
        {selected.size > 0 && (
          <button type="button" className="btn-secondary btn--sm" style={{ marginTop: 6 }} onClick={() => onChange(new Set())}>
            Xóa lọc
          </button>
        )}
      </div>
    </details>
  );
}

interface BoardFilters { dateFrom: string; dateTo: string; }

export default function AccountingDebitClosePage() {
  const [filters, setFilters] = useState<BoardFilters>({ dateFrom: '', dateTo: '' });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [customerFilter, setCustomerFilter] = useState<Set<string>>(new Set());
  const [truckFilter, setTruckFilter] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const queryClient = useQueryClient();

  const boardQuery = useQuery({
    queryKey: ['accounting-debit-board', filters.dateFrom, filters.dateTo],
    queryFn: () => listAccountingDebitBoard({ dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined }),
  });
  const rows = useMemo(() => boardQuery.data?.items ?? [], [boardQuery.data]);

  const customerValues = useMemo(
    () => [...new Set(rows.map((row) => row.customerName).filter((v): v is string => v != null))].sort(),
    [rows],
  );
  const truckValues = useMemo(
    () => [...new Set(rows.flatMap((row) => row.phanXe))].sort(),
    [rows],
  );
  const visibleRows = useMemo(() => rows.filter((row) =>
    (customerFilter.size === 0 || (row.customerName != null && customerFilter.has(row.customerName)))
    && (truckFilter.size === 0 || row.phanXe.some((t) => truckFilter.has(t)))), [rows, customerFilter, truckFilter]);

  const pendingRows = visibleRows.filter((row) => row.adjustment.status === 'PENDING');
  const pendingIds = pendingRows.map((row) => row.adjustment.requestId).filter((id): id is number => id != null);
  const selectable = (row: AccountingDebitBoardRow) => row.adjustment.status === 'NONE';

  const refresh = () => {
    setSelected(new Set());
    void queryClient.invalidateQueries({ queryKey: ['accounting-debit-board'] });
  };

  const sendMutation = useMutation({
    mutationFn: sendRateAdjustmentRequests,
    onSuccess: (result) => {
      const parts = [
        result.requested.length > 0 ? `đã gửi ${result.requested.length} lô` : null,
        result.alreadyPending.length > 0 ? `${result.alreadyPending.length} lô đã có yêu cầu chờ` : null,
        result.locked.length > 0 ? `${result.locked.length} lô đã khóa, không gửi được` : null,
      ].filter(Boolean);
      setMessage({ kind: 'ok', text: `Yêu cầu điều chỉnh cước: ${parts.join(', ')}.` });
      refresh();
    },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });
  const confirmMutation = useMutation({
    mutationFn: confirmRateAdjustments,
    onSuccess: () => { setMessage({ kind: 'ok', text: 'Đã xác nhận đối soát.' }); refresh(); },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });
  const withdrawMutation = useMutation({
    mutationFn: withdrawRateAdjustments,
    onSuccess: () => { setMessage({ kind: 'ok', text: 'Đã rút yêu cầu.' }); refresh(); },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });

  const visiblePendingCount = pendingIds.length;
  const allSelected = visibleRows.some(selectable) && visibleRows.filter(selectable).every((row) => selected.has(row.shipmentId));

  function toggleRow(row: AccountingDebitBoardRow) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(row.shipmentId)) next.delete(row.shipmentId);
      else next.add(row.shipmentId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) => {
      const selectableRows = visibleRows.filter(selectable);
      if (selectableRows.length > 0 && selectableRows.every((row) => current.has(row.shipmentId))) {
        return new Set();
      }
      return new Set(selectableRows.map((row) => row.shipmentId));
    });
  }

  async function sendRequest() {
    if (selected.size === 0) {
      setMessage({ kind: 'err', text: 'Chọn ít nhất một dòng lô hàng.' });
      return;
    }
    sendMutation.mutate({ shipmentIds: [...selected] });
  }

  const moneyCell = (value: string | null) => (
    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(value)}</td>
  );

  return (
    <div className="page-shell">
      <h1>Kế toán chốt debit — KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end', margin: '12px 0' }}>
        <label>Từ ngày <input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} /></label>
        <label>Đến ngày <input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} /></label>
        <DebitFilterDropdown
          label="Lọc khách hàng (Thông tin lô hàng)"
          values={customerValues}
          selected={customerFilter}
          onChange={(next) => { setCustomerFilter(next); setSelected(new Set()); }}
        />
        <DebitFilterDropdown
          label="Lọc nhà xe (Phân xe)"
          values={truckValues}
          selected={truckFilter}
          onChange={(next) => { setTruckFilter(next); setSelected(new Set()); }}
        />
        <button type="button" className="btn-primary" disabled={selected.size === 0 || sendMutation.isPending} onClick={() => void sendRequest()}>
          {sendMutation.isPending ? 'Đang gửi…' : `Gửi yêu cầu điều chỉnh cước (${selected.size} dòng)`}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={visiblePendingCount === 0 || confirmMutation.isPending}
          onClick={() => confirmMutation.mutate(pendingIds)}
        >
          {confirmMutation.isPending ? 'Đang xác nhận…' : `Xác nhận đối soát (${visiblePendingCount})`}
        </button>
        <span aria-live="polite">
          {message && <p role="status" style={{ color: message.kind === 'ok' ? 'var(--ok, #16a34a)' : 'var(--err, #dc2626)', margin: 0 }}>{message.text}</p>}
        </span>
      </div>
      {boardQuery.isError && <p role="alert">Không tải được bảng tổng hợp. Vui lòng thử lại.</p>}
      <div className="shipment-container-ledger" role="region" aria-label="Bảng Kế hoạch điều động tổng hợp" tabIndex={0} style={{ overflowX: 'auto' }}>
        {/* 18 columns cannot squeeze below readable width — floor the table
            and let the wrapper scroll horizontally (hard-gate fix: at 1440
            the auto layout collapsed cells into overlapping text). */}
        <table className="tt-table" style={{ minWidth: 2600 }}>
          <caption>KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP — thu/trả theo lô (cước vận chuyển)</caption>
          <thead>
            <tr>
              <th rowSpan={2} scope="col"><input type="checkbox" aria-label="Chọn tất cả" checked={allSelected} onChange={toggleAll} /></th>
              <th rowSpan={2} scope="col">Ngày</th>
              <th rowSpan={2} scope="col">Thông tin lô hàng</th>
              <th rowSpan={2} scope="col">Thông số container</th>
              <th rowSpan={2} scope="col">Phân xe</th>
              <th colSpan={5} scope="colgroup">PHẢI THU</th>
              <th colSpan={5} scope="colgroup">PHẢI TRẢ</th>
              <th rowSpan={2} scope="col">Lợi nhuận</th>
              <th rowSpan={2} scope="col">Ghi chú</th>
              <th rowSpan={2} scope="col">Đối soát</th>
            </tr>
            <tr>
              <th scope="col">Cước thu (tự động)</th>
              <th scope="col">Lạch Huyện (tự động)</th>
              <th scope="col">Phụ ps (tự động)</th>
              <th scope="col">Phát sinh (cus)</th>
              <th scope="col">Tổng thu</th>
              <th scope="col">Cước trả ĐV</th>
              <th scope="col">Lạch Huyện ĐV</th>
              <th scope="col">Phát sinh ĐV</th>
              <th scope="col">Tổng 1</th>
              <th scope="col">Phí RU (tự động)</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr><td colSpan={18}>Không có lô hàng trong khoảng thời gian này.</td></tr>
            )}
            {visibleRows.map((row) => (
              <tr key={row.shipmentId}>
                <td>
                  {selectable(row) && (
                    <input type="checkbox" aria-label={`Chọn lô ${row.code ?? row.shipmentId}`} checked={selected.has(row.shipmentId)} onChange={() => toggleRow(row)} />
                  )}
                  {row.adjustment.status === 'PENDING' && <span title="Chờ đối soát">⏳</span>}
                  {row.adjustment.status === 'CONFIRMED' && <span title="Đã đối soát">✅</span>}
                </td>
                <td>{row.ngay ?? '—'}</td>
                <td>
                  {row.code ?? '—'}<br />
                  <small>{row.billOrBooking ?? ''}</small><br />
                  <small>{row.customerName ?? ''}</small>
                </td>
                <td>{(row.containers.length > 0 ? row.containers : ['—']).map((label, i) => (
                  <span key={i}>{label}<br /></span>
                ))}</td>
                <td>{row.phanXe.length > 0 ? row.phanXe.join(', ') : '—'}</td>
                {moneyCell(row.thu.cuocThu)}
                {moneyCell(row.thu.lachHuyen)}
                {moneyCell(row.thu.phuPs)}
                {moneyCell(row.thu.phatSinhCus)}
                {moneyCell(row.thu.tongThu)}
                {moneyCell(row.tra.cuocTraDv)}
                {moneyCell(row.tra.lachHuyenDv)}
                {moneyCell(row.tra.phatSinhDv)}
                {moneyCell(row.tra.tong1)}
                {moneyCell(row.tra.phiRu)}
                <td style={{ textAlign: 'right' }}>{money(row.loiNhuan)}</td>
                <td>{row.ghiChu ?? '—'}</td>
                <td>
                  {row.adjustment.status === 'PENDING' && (
                    <>
                      <button type="button" className="btn-secondary btn--sm" onClick={() => confirmMutation.mutate([row.adjustment.requestId!])}>Xác nhận</button>
                      <button type="button" className="btn-secondary btn--sm" onClick={() => withdrawMutation.mutate([row.adjustment.requestId!])}>Rút</button>
                    </>
                  )}
                  {row.adjustment.status === 'CONFIRMED' && <small>Đã đối soát</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
