import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmPhoiPhieuTienDuong, getPhoiPhieuTienDuong } from '../../api/phoiPhieuClient';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { formatCurrency } from '../../lib/format';
import { billBookingReference } from '../../lib/business-reference';
import { DRIVER_INCIDENTAL_COST_LABELS, sumExcludingNegative } from '@tingting/shared';
import { EmptyState, Modal, NumberField } from '../../design-system';
import { Btn } from '../../components/UI';
import { ExpenseCreateDrawer } from '../expense-accounting/ExpenseCreateDrawer';
import { Money } from '../../components/shared/Money';
import { PhoiPhieuDetailSummary } from './PhoiPhieuDetailSummary';
import './phoi-phieu-dialogs.css';

interface Props {
  tripId: number;
  billOrBooking?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/** The reason every tiền-đường amount edit carries into the audit trail
 *  (EXPENSE_ACCOUNTING_UPDATED / _CORRECTED payload.reason). */
const EDIT_REASON = 'Kế toán sửa số tiền trong xem chi tiết tiền đường';

export function PhoiPhieuTienDuongDialog({ tripId, billOrBooking, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: qk.phoiPhieu.tienDuong(tripId),
    queryFn: () => getPhoiPhieuTienDuong(tripId),
  });
  const [confirming, setConfirming] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, number | ''>>({});
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [refreshRequired, setRefreshRequired] = useState(false);
  const confirmLock = useRef(false);
  const catalog = useQuery({ queryKey: qk.expenseAccounting.catalog, queryFn: expenseAccountingClient.catalog, enabled: adding });

  // Memoized so the `totals` memo below keeps a stable `rows` identity: the
  // `?? []` fallback would otherwise hand it a new array every render and
  // recompute the footer figures on every keystroke.
  const rows = useMemo(() => detail.data?.rows ?? [], [detail.data]);
  // Card 20260928_171: the dialog now edits amounts, so both footer figures are
  // computed from the live rows+edits — the same "live" recompute the chi hộ
  // dialog uses, so a typed amount is what the accountant sees before saving.
  const totals = useMemo(() => {
    const live = (row: (typeof rows)[number]) => {
      const edit = edits[row.sourceId];
      return edit === undefined ? row.amount : edit === '' ? 0 : edit;
    };
    return {
      total: sumExcludingNegative(rows, live),
      approved: sumExcludingNegative(rows.filter((row) => row.confirmed), live),
    };
  }, [rows, edits]);
  const unapproved = totals.total - totals.approved;

  // Card 20260923_11 rule, carried here: the dialog and the "Thêm khoản chi"
  // panel are two aria-modal surfaces and exactly ONE may be on screen. Once the
  // panel has its catalog the dialog's own surface is not rendered at all; the
  // component stays mounted, so row edits survive the round trip.
  const addPanelOpen = adding && Boolean(catalog.data);

  async function tickConfirm(row: (typeof rows)[number]) {
    if (confirmLock.current || detail.isFetching || refreshRequired) return;
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

  function setAmount(sourceId: number, value: number | '') {
    setEdits((current) => ({ ...current, [sourceId]: value }));
  }

  /** The chi hộ dialog's save loop, for driver rows: unapproved money goes
   *  through the plain update, approved money through the correction path that
   *  keeps the original amount in history. */
  async function refreshDetail(clearError = false) {
    const result = await detail.refetch();
    setRefreshRequired(result.isError);
    if (clearError && !result.isError) setError('');
  }

  async function saveAll() {
    if (saving || confirming !== null || detail.isFetching || refreshRequired) return;
    setSaving(true);
    setError('');
    try {
      for (const row of rows) {
        const edit = edits[row.sourceId];
        if (edit === undefined || edit === row.amount) continue;
        const body = { expectedVersion: row.version, reason: EDIT_REASON, amount: edit === '' ? 0 : edit };
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
      setRefreshRequired(true);
      await refreshDetail();
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || confirming !== null;
  const dirty = rows.some(row => edits[row.sourceId] !== undefined && edits[row.sourceId] !== row.amount);

  return (
    <>
      {/* The one design-system modal module owns the shell (portal, scrim,
          Escape, focus return, scroll lock — card 20260930_227); house chrome
          renders the header/close so this dialog no longer re-assembles them.
          Card 20260923_11: suppressed while the add panel owns the screen. */}
      {!addPanelOpen && <Modal
        isOpen
        onClose={onClose}
        title={`Chi tiết tiền đường ${billBookingReference(billOrBooking)}`}
        ariaLabel="Chi tiết tiền đường"
        maxWidth={1240}
        footer={detail.data && <>
          <Btn size="sm" disabled={busy || adding} onClick={() => setAdding(true)}>＋ Thêm dòng</Btn>
          <Btn size="sm" disabled={busy} onClick={onClose}>Hủy</Btn>
          <Btn size="sm" variant="primary" disabled={busy || detail.isFetching || refreshRequired || Object.keys(edits).length === 0} onClick={() => void saveAll()}>Lưu</Btn>
        </>}
      >
      <div className="phoi-detail-body">
        {detail.isLoading && <p>Đang tải…</p>}
        {(error || detail.isError) && <div role="alert" className="phoi-detail-error">
          <p>{error || detail.error?.message}</p>
          {refreshRequired && <p>{detail.error?.message} Tải lại khoản chi trước khi lưu tiếp.</p>}
          <Btn size="sm" disabled={busy || detail.isFetching} onClick={() => void refreshDetail(!refreshRequired)}>Tải lại khoản chi</Btn>
        </div>}
        {detail.data && (
          <>
            {rows.length === 0 ? <EmptyState variant="compact" context="expenses" title="Chưa có khoản tiền đường" description="Thêm dòng để ghi nhận khoản chi của chuyến này." /> : <div className="record-table-wrap" role="region" aria-label="Các khoản tiền đường">
            <table className="record-table ops-table phoi-detail-matrix">
              <thead><tr>
                <th className="phoi-detail-col--ordinal">STT</th>
                <th className="phoi-detail-col--description">Khoản lái xe nhập</th>
                <th className="phoi-detail-col--date">Ngày</th>
                <th className="phoi-detail-col--identity">Lái xe</th>
                <th className="phoi-detail-col--money">Lái xe nhập ban đầu (đ)</th>
                <th className="phoi-detail-col--money">Thực chi hiện tại (đ)</th>
                <th className="phoi-detail-col--action">Kế toán duyệt</th>
              </tr></thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.sourceId}>
                    <td data-label="STT" className="phoi-detail-col--ordinal">{index + 1}</td>
                    <td data-label="Khoản lái xe nhập" className="phoi-detail-col--description">{row.feeName || DRIVER_INCIDENTAL_COST_LABELS[row.costType as keyof typeof DRIVER_INCIDENTAL_COST_LABELS] || row.costType}</td>
                    <td data-label="Ngày" className="phoi-detail-col--date">{row.occurredAt ?? '—'}</td>
                    <td data-label="Lái xe" className="phoi-detail-col--identity">{row.driverName ?? '—'}</td>
                    <td data-label="Lái xe nhập ban đầu (đ)" className="phoi-detail-col--money"><Money value={row.driverEnteredAmount ?? row.amount} /></td>
                    <td data-label="Thực chi hiện tại (đ)" className="phoi-detail-col--money">
                      <NumberField
                        aria-label={`Thực chi dòng ${index + 1}`}
                        grouped
                        signed
                        suffix="₫"
                        value={edits[row.sourceId] ?? row.amount}
                        disabled={saving}
                        onChange={(n) => setAmount(row.sourceId, n)}
                      />
                    </td>
                    <td data-label="Kế toán duyệt" className="phoi-detail-col--action">
                      {row.confirmed
                        ? <span>Đã duyệt</span>
                        : <Btn size="sm" disabled={busy || detail.isFetching || refreshRequired} onClick={() => void tickConfirm(row)}>Tích duyệt</Btn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>}
            <PhoiPhieuDetailSummary items={[{ label: 'Tổng phát sinh', amount: totals.total }, { label: 'Đã duyệt', amount: totals.approved }]} />
            {dirty && <p role="status" className="phoi-detail-note">Có thay đổi chưa lưu</p>}
            <p className="phoi-detail-note">
              Tổng phát sinh là tất cả dòng; chỉ dòng đã duyệt mới được lập phiếu chi thanh toán cho lái xe
              {unapproved > 0 ? ` — còn ${formatCurrency(unapproved)} chưa duyệt, không vào phiếu.` : '.'}
              {' '}Con số “Đã duyệt” chính là con số hiện ở cột Tiền đường của bảng kiểm soát phơi phiếu.
            </p>
          </>
        )}
        {adding && catalog.isPending && <p role="status">Đang tải loại phí và nhân viên…</p>}
        {adding && catalog.isError && <p role="alert">{catalog.error.message} <button type="button" onClick={() => void catalog.refetch()}>Thử lại</button><button type="button" onClick={() => setAdding(false)}>Hủy</button></p>}
      </div>
    </Modal>}
      {addPanelOpen && catalog.data && <ExpenseCreateDrawer
        work={{ tripId, shipmentCode: billBookingReference(billOrBooking), containerNumber: null }}
        catalog={catalog.data} initialGroup="DRIVER_ROAD"
        onClose={() => setAdding(false)}
        onSaved={() => { void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.tienDuong(tripId) }); onSaved(); }}
      />}
    </>
  );
}
