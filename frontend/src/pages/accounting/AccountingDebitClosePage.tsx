import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAccountingDebitBoard,
  sendRateAdjustmentRequests,
  confirmRateAdjustments,
  withdrawRateAdjustments,
  listSettlementRounds,
  createSettlementRound,
  DEBIT_SETTLEMENT_ROUNDS_KEY,
  type AccountingDebitBoardRow,
} from '../../api/accountingDebitClient';
import { formatCurrency } from '../../lib/format';
import { qk } from '../../api/keys';
import { PageHeader } from '../../components/UI';
import { DebitSettlementRoundDialog } from './DebitSettlementRoundDialog';

const money = (value: string | null, missingLabel: string) => {
  // Card 20260924_21 (BATCH A, item 7): the PHẢI THU / PHẢI TRẢ columns name
  // the missing field on the wire (e.g. "Thiếu cước thu", "Thiếu lạch
  // huyền") instead of repeating the generic "Chưa xác định" three times per
  // row (surface 08/11 §1). The summary / settle-dialog paths keep the
  // generic "Chưa xác định" because they have no specific field name to
  // attribute the gap to.
  if (value == null) return <span style={{ color: 'var(--text-muted, #64748b)' }}>{missingLabel}</span>;
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
    <details style={{ position: 'relative', display: 'inline-block', width: 260, maxWidth: '100%' }}>
      <summary className="btn btn--secondary" style={{ cursor: 'pointer', fontSize: 'var(--text-caption-size)', listStyle: 'none', width: '100%' }}>
        {label}
        {selected.size > 0 ? ` (${selected.size})` : ''} ▾
      </summary>
      <div style={{
        position: 'absolute', insetInline: 0, zIndex: 30, background: 'var(--surface, #fff)',
        border: '1px solid var(--border, #e2e8f0)', borderRadius: 8, padding: '8px 10px',
        maxHeight: 260, overflowY: 'auto',
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
          <button type="button" className="btn btn--secondary btn--sm" style={{ marginTop: 6 }} onClick={() => onChange(new Set())}>
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
  const [settlementOpen, setSettlementOpen] = useState(false);
  const queryClient = useQueryClient();

  const boardQuery = useQuery({
    queryKey: qk.accounting.debitBoard(filters.dateFrom, filters.dateTo),
    queryFn: () => listAccountingDebitBoard({ dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined }),
  });
  const roundsQuery = useQuery({
    queryKey: DEBIT_SETTLEMENT_ROUNDS_KEY,
    queryFn: listSettlementRounds,
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
  // Tickable = no live adjustment (NONE) or a CONFIRMED one (re-request a
  // new adjustment cycle until the lot's cost lock freezes it). A live
  // PENDING shows its Xác nhận/Rút controls instead of a tick.
  const selectable = (row: AccountingDebitBoardRow) =>
    row.adjustment.status === 'NONE' || row.adjustment.status === 'CONFIRMED';

  const refresh = () => {
    setSelected(new Set());
    void queryClient.invalidateQueries({ queryKey: qk.accounting.debitBoardAll });
    void queryClient.invalidateQueries({ queryKey: DEBIT_SETTLEMENT_ROUNDS_KEY });
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
  const settlementMutation = useMutation({
    mutationFn: createSettlementRound,
    onSuccess: (round) => {
      const total = Number(round.amount) + Math.round(Number(round.amount) * round.vatRate) / 100;
      setMessage({ kind: 'ok', text: `Đã chốt đợt: Lần ${round.roundNo} · ${round.periodKey.replaceAll('-', '/')} — ${formatCurrency(total)} (đã gồm VAT).` });
      setSettlementOpen(false);
      refresh();
    },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.shipmentId)),
    [rows, selected],
  );

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

  const moneyCell = (value: string | null, missingLabel: string) => (
    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(value, missingLabel)}</td>
  );

  return (
    <div className="page-shell">
      <PageHeader title="Kế toán chốt debit — KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end', margin: '12px 0' }}>
        <label style={{ display: 'grid', gap: 4 }}>Từ ngày <input className="input" type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} /></label>
        <label style={{ display: 'grid', gap: 4 }}>Đến ngày <input className="input" type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} /></label>
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
        <button
          type="button"
          className="btn btn--primary"
          disabled={selected.size === 0 || settlementMutation.isPending}
          onClick={() => setSettlementOpen(true)}
        >
          Chọn Debit ({selected.size} dòng)
        </button>
        <button type="button" className="btn btn--primary" disabled={selected.size === 0 || sendMutation.isPending} onClick={() => void sendRequest()}>
          {sendMutation.isPending ? 'Đang gửi…' : `Gửi yêu cầu điều chỉnh cước (${selected.size} dòng)`}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
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
        {/* 18 columns cannot squeeze below readable width — fixed layout with
            EXPLICIT column shares (colgroup), so every header wraps inside
            its own cell instead of overflowing into its neighbor (the auto
            layout starved the money columns to their nowrap data width,
            colliding the PHẢI THU/PHẢI TRẢ sub-headers at every desktop
            width — QA FAILED 2026-09-22). Shares sum to 2640; the wrapper
            scrolls horizontally below that. */}
        <table className="tt-table" style={{ tableLayout: 'fixed', width: 2640 }}>
          <colgroup>
            <col style={{ width: 44 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 230 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 152 }} />
            <col style={{ width: 152 }} />
            <col style={{ width: 152 }} />
            <col style={{ width: 152 }} />
            <col style={{ width: 152 }} />
            <col style={{ width: 152 }} />
            <col style={{ width: 152 }} />
            <col style={{ width: 152 }} />
            <col style={{ width: 152 }} />
            <col style={{ width: 152 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 150 }} />
          </colgroup>
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
              <th scope="col" style={{ whiteSpace: 'normal' }}>Cước thu (tự động)</th>
              <th scope="col" style={{ whiteSpace: 'normal' }}>Lạch Huyện (tự động)</th>
              <th scope="col" style={{ whiteSpace: 'normal' }}>Phụ ps (tự động)</th>
              <th scope="col" style={{ whiteSpace: 'normal' }}>Phát sinh (cus)</th>
              <th scope="col" style={{ whiteSpace: 'normal' }}>Tổng thu</th>
              <th scope="col" style={{ whiteSpace: 'normal' }}>Cước trả ĐV</th>
              <th scope="col" style={{ whiteSpace: 'normal' }}>Lạch Huyện ĐV</th>
              <th scope="col" style={{ whiteSpace: 'normal' }}>Phát sinh ĐV</th>
              <th scope="col" style={{ whiteSpace: 'normal' }}>Tổng 1</th>
              <th scope="col" style={{ whiteSpace: 'normal' }}>Phí RU (tự động)</th>
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
                {moneyCell(row.thu.cuocThu, 'Thiếu cước thu')}
                {moneyCell(row.thu.lachHuyen, 'Thiếu lạch huyền')}
                {moneyCell(row.thu.phuPs, 'Thiếu phụ PS')}
                {moneyCell(row.thu.phatSinhCus, 'Thiếu phát sinh (cus)')}
                {moneyCell(row.thu.tongThu, 'Thiếu tổng thu')}
                {moneyCell(row.tra.cuocTraDv, 'Thiếu cước trả ĐV')}
                {moneyCell(row.tra.lachHuyenDv, 'Thiếu lạch huyền ĐV')}
                {moneyCell(row.tra.phatSinhDv, 'Thiếu phát sinh ĐV')}
                {moneyCell(row.tra.tong1, 'Thiếu tổng 1')}
                {moneyCell(row.tra.phiRu, 'Thiếu phí RU')}
                <td style={{ textAlign: 'right' }}>{money(row.loiNhuan, 'Thiếu lợi nhuận')}</td>
                <td>{row.ghiChu ?? '—'}</td>
                <td>
                  {row.adjustment.status === 'PENDING' && (
                    <>
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => confirmMutation.mutate([row.adjustment.requestId!])}>Xác nhận</button>
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => withdrawMutation.mutate([row.adjustment.requestId!])}>Rút</button>
                    </>
                  )}
                  {row.adjustment.status === 'CONFIRMED' && <small>Đã đối soát</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DebitSettlementRoundDialog
        isOpen={settlementOpen}
        rows={selectedRows}
        defaultDateFrom={filters.dateFrom}
        defaultDateTo={filters.dateTo}
        serverError={settlementMutation.error instanceof Error ? settlementMutation.error.message : null}
        onSubmit={(body) => settlementMutation.mutate(body)}
        onClose={() => setSettlementOpen(false)}
        isPending={settlementMutation.isPending}
      />
      <section aria-label="Tổng hợp công nợ khách hàng" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 'var(--text-body-size, 1rem)', margin: '0 0 8px' }}>TỔNG HỢP CÔNG NỢ KHÁCH HÀNG</h2>
        <div className="shipment-container-ledger" role="region" aria-label="Bảng tổng hợp công nợ khách hàng" tabIndex={0} style={{ overflowX: 'auto' }}>
          <table className="tt-table">
            <caption>TỔNG HỢP CÔNG NỢ KHÁCH HÀNG — các đợt chốt (kỳ theo dõi = lần + tháng)</caption>
            <thead>
              <tr>
                <th scope="col">Kỳ theo dõi</th>
                <th scope="col">Khách hàng</th>
                <th scope="col">Đối tượng</th>
                <th scope="col">Chiều</th>
                <th scope="col">Từ ngày</th>
                <th scope="col">Đến ngày</th>
                <th scope="col">Số tiền (chưa VAT)</th>
                <th scope="col">VAT</th>
                <th scope="col">Tiền VAT</th>
                <th scope="col">Tổng tiền (gồm VAT)</th>
                <th scope="col">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {roundsQuery.data?.items.length === 0 && (
                <tr><td colSpan={10}>Chưa có đợt chốt nào.</td></tr>
              )}
              {(roundsQuery.data?.items ?? []).map((round) => (
                <tr key={round.id}>
                  <td>{`Lần ${round.roundNo} · ${round.periodKey.replaceAll('-', '/')}`}</td>
                  <td>{round.customerName ?? '—'}</td>
                  <td>{round.carrierLabel ?? '—'}</td>
                  <td>{round.direction === 'THU' ? 'Phải thu' : 'Phải trả'}</td>
                  <td>{round.dateFrom}</td>
                  <td>{round.dateTo}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(Number(round.amount))}</td>
                  <td>{`${round.vatRate}%`}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(round.vatAmount)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(round.totalAmount)}</td>
                  <td>{round.ghiChu ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
