import { useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmPhoiPhieuTienDuong, getPhoiPhieuTienDuong } from '../../api/phoiPhieuClient';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { formatCurrency } from '../../lib/format';
import { DRIVER_INCIDENTAL_COST_LABELS } from '@tingting/shared';
import { ExpenseCreateDrawer } from '../expense-accounting/ExpenseCreateDrawer';
import '../ops/ops-modal.css';
import { OpsModalBackdrop } from '../ops/OpsModalBackdrop';

interface Props {
  tripId: number;
  onClose: () => void;
  onSaved: () => void;
}

/** The reason every tiền-đường amount edit carries into the audit trail
 *  (EXPENSE_ACCOUNTING_UPDATED / _CORRECTED payload.reason). */
const EDIT_REASON = 'Kế toán sửa số tiền trong xem chi tiết tiền đường';

/** Headers wrap at spaces only (keep-all) — table text never clips mid-token
 *  (design law §4; board thead contract, card 20260922_54). */
const th = (extra: React.CSSProperties): React.CSSProperties =>
  ({ whiteSpace: 'normal', wordBreak: 'keep-all', overflowWrap: 'normal', ...extra });

export function PhoiPhieuTienDuongDialog({ tripId, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: qk.phoiPhieu.tienDuong(tripId),
    queryFn: () => getPhoiPhieuTienDuong(tripId),
  });
  const [confirming, setConfirming] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const confirmLock = useRef(false);
  const catalog = useQuery({ queryKey: qk.expenseAccounting.catalog, queryFn: expenseAccountingClient.catalog, enabled: adding });

  const rows = detail.data?.rows ?? [];
  // Card 20260928_171: the dialog now edits amounts, so both footer figures are
  // computed from the live rows+edits — the same "live" recompute the chi hộ
  // dialog uses, so a typed amount is what the accountant sees before saving.
  const totals = useMemo(() => {
    const live = (row: (typeof rows)[number]) => {
      const edit = edits[row.sourceId];
      const value = edit === undefined ? row.amount : Number(edit);
      return Number.isFinite(value) ? value : 0;
    };
    return {
      total: rows.reduce((sum, row) => sum + live(row), 0),
      approved: rows.filter((row) => row.confirmed).reduce((sum, row) => sum + live(row), 0),
    };
  }, [rows, edits]);
  const totalMoney = formatCurrency(totals.total);
  const approvedMoney = formatCurrency(totals.approved);
  const unapproved = totals.total - totals.approved;

  // Card 20260923_11 rule, carried here: the dialog and the "Thêm khoản chi"
  // panel are two aria-modal surfaces and exactly ONE may be on screen. Once the
  // panel has its catalog the dialog's own surface is not rendered at all; the
  // component stays mounted, so row edits survive the round trip.
  const addPanelOpen = adding && Boolean(catalog.data);

  async function tickConfirm(row: (typeof rows)[number]) {
    if (confirmLock.current || detail.isFetching) return;
    confirmLock.current = true;
    setConfirming(row.sourceId);
    setError('');
    try {
      await confirmPhoiPhieuTienDuong(tripId, row.sourceId, row.version);
      await queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.tienDuong(tripId) });
      onSaved();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'Không xác nhận được khoản.');
    } finally {
      confirmLock.current = false;
      setConfirming(null);
    }
  }

  function setAmount(sourceId: number, value: string) {
    setEdits((current) => ({ ...current, [sourceId]: value }));
  }

  /** The chi hộ dialog's save loop, for driver rows: unapproved money goes
   *  through the plain update, approved money through the correction path that
   *  keeps the original amount in history. */
  async function saveAll() {
    setSaving(true);
    setError('');
    try {
      for (const row of rows) {
        const edit = edits[row.sourceId];
        if (edit === undefined || Number(edit) === Number(row.amount)) continue;
        const body = { expectedVersion: row.version, reason: EDIT_REASON, amount: Number(edit) };
        // `ExpenseSourceRef` carries the version too (shared/expense-accounting.ts
        // expenseSourceRefSchema) — the same row version the body states, exactly
        // as the house `sourceRef(entry)` helper builds it for other screens.
        const ref = { sourceKind: 'DRIVER' as const, sourceId: row.sourceId, expectedVersion: row.version };
        if (row.confirmed) await expenseAccountingClient.correct(ref, body);
        else await expenseAccountingClient.update(ref, body);
      }
      await queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.tienDuong(tripId) });
      setEdits({});
      onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được thay đổi.');
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || confirming !== null;

  return (
    <>
      {/* Card 20260922_67: house modal shell — portal + backdrop + Escape +
          focus return. The backdrop carries the dialog role. */}
      {/* 7 fixed-layout columns need budgeted widths: the old 640px shell
          equal-shared them to ~91px and nowrap headers clipped mid-token.
          Wider shell + wrap-at-spaces headers (design law §4). */}
      {!addPanelOpen && <OpsModalBackdrop onClose={onClose} ariaLabel="Chi tiết tiền đường">
      <div className="ops-modal" style={{ maxWidth: 760 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 'var(--text-body-size)' }}>Chi tiết tiền đường {detail.data?.tripCode ?? ''}</h2>
        <button type="button" aria-label="Đóng" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </header>
      <div className="ops-modal__body">
        {detail.isLoading && <p>Đang tải…</p>}
        {(error || detail.isError) && <p role="alert" style={{ color: 'var(--err, #dc2626)' }}>{error || detail.error?.message} <button type="button" className="btn btn--secondary btn--sm" disabled={busy || detail.isFetching} onClick={() => void detail.refetch().then(result => { if (!result.isError) setError(''); })}>Tải lại khoản chi</button></p>}
        {detail.data && (
          <>
            <table className="tt-table" style={{ fontSize: 'var(--text-caption-size)' }}>
              {/* Widths sum to 100% so the fixed layout never equal-shares
                  the money columns into clip territory (law §4). */}
              <thead><tr>
                <th style={th({ width: '5%' })}>STT</th>
                <th style={th({ width: '20%' })}>Khoản lái xe nhập</th>
                <th style={th({ width: '11%' })}>Ngày</th>
                <th style={th({ width: '17%' })}>Lái xe</th>
                <th style={th({ width: '16%' })}>Lái xe nhập ban đầu (đ)</th>
                <th style={th({ width: '15%' })}>Thực chi hiện tại (đ)</th>
                <th style={th({ width: '16%' })}>Kế toán duyệt</th>
              </tr></thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.sourceId}>
                    <td>{index + 1}</td>
                    <td>{row.feeName || DRIVER_INCIDENTAL_COST_LABELS[row.costType as keyof typeof DRIVER_INCIDENTAL_COST_LABELS] || row.costType}</td>
                    <td>{row.occurredAt ?? '—'}</td>
                    <td>{row.driverName ?? '—'}</td>
                    <td>{formatCurrency(row.driverEnteredAmount ?? row.amount)}</td>
                    <td>
                      <input
                        aria-label={`Thực chi dòng ${index + 1}`}
                        inputMode="numeric"
                        value={edits[row.sourceId] ?? String(row.amount)}
                        disabled={saving}
                        onChange={(event) => setAmount(row.sourceId, event.target.value)}
                      />
                    </td>
                    <td>
                      {row.confirmed
                        ? <span style={{ color: 'var(--ok, #16a34a)', fontWeight: 600 }}>Đã duyệt</span>
                        : <button type="button" className="btn btn--primary btn--sm" disabled={busy || detail.isFetching} onClick={() => void tickConfirm(row)}>Tích duyệt</button>}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4}><strong>TỔNG CỘNG</strong></td>
                  <td />
                  <td><strong>{totalMoney}</strong><br /><small>Tổng phát sinh — mọi dòng</small></td>
                  <td><strong>{approvedMoney}</strong><br /><small>Đã duyệt — số vào phiếu chi, khớp cột Tiền đường</small></td>
                </tr>
              </tbody>
            </table>
            <p style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-3)' }}>
              Tổng phát sinh là tất cả dòng; chỉ dòng đã duyệt mới được lập phiếu chi thanh toán cho lái xe
              {unapproved > 0 ? ` — còn ${formatCurrency(unapproved)} chưa duyệt, không vào phiếu.` : '.'}
              {' '}Con số “Đã duyệt” chính là con số hiện ở cột Tiền đường của bảng kiểm soát phơi phiếu.
            </p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginTop: 8 }}>
              <button type="button" className="btn btn--secondary btn--sm" disabled={busy || adding} onClick={() => setAdding(true)}>＋ Thêm dòng</button>
              <button type="button" className="btn btn--primary btn--sm" disabled={busy || Object.keys(edits).length === 0} onClick={() => void saveAll()}>Lưu</button>
              <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={onClose}>Hủy</button>
            </div>
          </>
        )}
        {adding && catalog.isPending && <p role="status">Đang tải loại phí và nhân viên…</p>}
        {adding && catalog.isError && <p role="alert">{catalog.error.message} <button type="button" onClick={() => void catalog.refetch()}>Thử lại</button><button type="button" onClick={() => setAdding(false)}>Hủy</button></p>}
      </div>
    </div>
    </OpsModalBackdrop>}
      {addPanelOpen && catalog.data && <ExpenseCreateDrawer
        work={{ tripId, shipmentCode: detail.data?.tripCode ?? null, containerNumber: null }}
        catalog={catalog.data} initialGroup="DRIVER_ROAD"
        onClose={() => setAdding(false)}
        onSaved={() => { void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.tienDuong(tripId) }); onSaved(); }}
      />}
    </>
  );
}
