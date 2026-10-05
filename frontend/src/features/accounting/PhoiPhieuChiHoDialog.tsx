import { useMemo, useState } from 'react';
import { sumExcludingNegative } from '@tingting/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  correctPhoiPhieuRow, getPhoiPhieuChiHo, updatePhoiPhieuMeta,
  updatePhoiPhieuRowAmounts, voidPhoiPhieuRow, type PhoiPhieuFeeRow, type ChiHoConfirmation,
} from '../../api/phoiPhieuClient';
import { billBookingReference } from '../../lib/business-reference';
import { formatMoney } from '../../lib/format';
import { qk } from '../../api/keys';
import { Btn } from '../../components/UI';
import { useReasonPrompt } from '../../components/reason-prompt';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { BufferedUuiDateInput } from '../../design-system/forms/BufferedUuiDateInput';
import { EmptyState, Modal, NumberField, TextField } from '../../design-system';
import { ExpenseCreateDrawer } from '../expense-accounting/ExpenseCreateDrawer';
import { PhoiPhieuDetailSummary } from './PhoiPhieuDetailSummary';
import './phoi-phieu-dialogs.css';

interface Props {
  tripId: number;
  billOrBooking?: string | null;
  confirmation?: ChiHoConfirmation;
  onClose: () => void;
  onSaved: () => void;
}

export function PhoiPhieuChiHoDialog({ tripId, billOrBooking, confirmation, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: qk.phoiPhieu.chiHo(tripId, confirmation),
    queryFn: () => getPhoiPhieuChiHo(tripId, confirmation),
  });
  const [edits, setEdits] = useState<Record<number, { thu: number | ''; tra: number | '' }>>({});
  const [linked, setLinked] = useState(false);
  const [linkNotice, setLinkNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [adding, setAdding] = useState(false);
  const [ngayLayPhoi, setNgayLayPhoi] = useState<string | null>(null);
  const [trangThaiLay, setTrangThaiLay] = useState<string | null>(null);
  const catalog = useQuery({ queryKey: qk.expenseAccounting.catalog, queryFn: expenseAccountingClient.catalog, enabled: adding });
  // Card 20261005_373: the void now REQUIRES a reason and the audit log stores
  // it, so the old hardcoded sentence ("Kế toán xóa dòng trong xem chi tiết chi
  // hộ") said nothing about why the row was dropped. The accountant types the
  // grounds through the ONE house reason prompt (components/reason-prompt) — the
  // same surface the tiền-đường reject uses. Its Confirm button stays disabled
  // while the trimmed reason is empty, and a cancel resolves to null, so no
  // request is sent without a reason.
  const { prompt, dialog } = useReasonPrompt();

  // Card 20260923_11: this dialog and the "Thêm khoản chi" panel are two
  // aria-modal surfaces. `adding` used to mount the drawer *beside* the still
  // rendered dialog shell, so both bodies shared the viewport (the P3
  // screenshot: the "Nhập Thu và Trả bằng nhau" checkbox sat inside the
  // overlap). Exactly one surface is active at a time: once the panel has its
  // catalog and is therefore on screen, this dialog's surface is not rendered
  // at all. The component stays mounted, so row edits survive the round trip,
  // and the panel's own loading/error feedback still lands in this dialog
  // because the panel only exists after `catalog.data` arrives.
  const addPanelOpen = adding && Boolean(catalog.data);

  // Memoized so the `totals` memo below keeps a stable `rows` identity: the
  // `?? []` fallback would otherwise hand it a new array every render and
  // recompute the footer figures on every keystroke.
  const rows = useMemo(() => detail.data?.rows ?? [], [detail.data]);
  const totals = useMemo(() => {
    const live = (row: PhoiPhieuFeeRow, key: 'thu' | 'tra') => {
      const edit = edits[row.entryId];
      const value = edit ? edit[key] : row[key === 'thu' ? 'amountThu' : 'amountTra'] ?? 0;
      return value === '' ? 0 : value;
    };
    return {
      thu: rows.reduce((sum, row) => sum + live(row, 'thu'), 0),
      tra: sumExcludingNegative(rows, row => live(row, 'tra')),
    };
  }, [rows, edits]);
  const meta = {
    ...(ngayLayPhoi !== null && (ngayLayPhoi || null) !== (detail.data?.ngayLayPhoi || null) ? { ngayLayPhoi: ngayLayPhoi || null } : {}),
    ...(trangThaiLay !== null && (trangThaiLay.trim() || null) !== (detail.data?.trangThaiLay || null) ? { trangThaiLay: trangThaiLay.trim() || null } : {}),
  };
  const dirty = Object.keys(meta).length > 0 || rows.some(row => {
    if (row.sourceKind === 'TRIP') return false;
    const edit = edits[row.entryId];
    return edit && (edit.thu !== (row.amountThu ?? '') || edit.tra !== (row.amountTra ?? ''));
  });

  function setEdit(row: PhoiPhieuFeeRow, key: 'thu' | 'tra', value: number | '') {
    const releaseLink = linked && key === 'tra' && typeof value === 'number' && value < 0;
    if (releaseLink) { setLinked(false); setLinkNotice('Khoản chi âm không áp dụng Thu bằng trả. Số tiền thu được giữ nguyên.'); }
    setEdits((current) => {
      const target = { ...(current[row.entryId] ?? { thu: row.amountThu ?? '', tra: row.amountTra ?? '' }) };
      target[key] = value;
      if (linked && !releaseLink) target[key === 'thu' ? 'tra' : 'thu'] = value;
      return { ...current, [row.entryId]: target };
    });
  }

  function setEquality(next: boolean) {
    if (next && rows.some(row => Number(edits[row.entryId]?.tra ?? row.amountTra) < 0)) {
      setLinked(false);
      setLinkNotice('Khoản chi âm không áp dụng Thu bằng trả. Số tiền thu được giữ nguyên.');
      return;
    }
    setLinked(next); setLinkNotice('');
  }

  async function refreshDetail() {
    const result = await detail.refetch();
    setRefreshRequired(result.isError);
  }

  async function saveAll() {
    if (saving || detail.isFetching || refreshRequired) return;
    setSaving(true);
    setError('');
    try {
      for (const row of rows) {
        if (row.sourceKind === 'TRIP') continue;
        const edit = edits[row.entryId];
        if (!edit) continue;
        const thu = edit.thu === '' ? null : edit.thu;
        const tra = edit.tra === '' ? null : edit.tra;
        if (thu === (row.amountThu ?? null) && tra === (row.amountTra ?? null)) continue;
        const payload = {
          expectedVersion: row.version, reason: 'Kế toán sửa số tiền trong xem chi tiết chi hộ',
          ...(Number.isFinite(thu ?? NaN) ? { customerChargeAmount: thu! } : {}),
          ...(Number.isFinite(tra ?? NaN) ? { amount: tra! } : {}),
        };
        if (row.confirmed) {
          await correctPhoiPhieuRow(row.entryId, payload);
        } else {
          await updatePhoiPhieuRowAmounts(tripId, row.entryId, payload);
        }
      }
      if (Object.keys(meta).length > 0) await updatePhoiPhieuMeta(tripId, meta);
      await queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.chiHo(tripId) });
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

  async function removeRow(row: PhoiPhieuFeeRow) {
    if (saving || detail.isFetching) return;
    const reason = await prompt(`Xóa dòng "${row.feeName ?? 'phí'}"? Khoản đã đối chiếu sẽ không xóa được.`, { confirmLabel: 'Xóa' });
    if (!reason) return;
    setSaving(true);
    setError('');
    try {
      await voidPhoiPhieuRow(tripId, row.sourceId, reason);
      await queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.chiHo(tripId) });
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : 'Không xóa được dòng.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* The one design-system modal module owns the shell (portal, scrim,
          Escape, focus return, scroll lock — card 20260930_227); house chrome
          renders the header/close/footer so this dialog no longer re-assembles
          them per surface. Card 20260923_11: suppressed while the add panel
          owns the screen. */}
      {!addPanelOpen && <Modal
        isOpen
        onClose={onClose}
        title={`Chi tiết chi hộ ${billBookingReference(billOrBooking)}`}
        ariaLabel="Chi tiết chi hộ"
        maxWidth={1240}
        footer={detail.data && <>
          <Btn size="sm" disabled={saving || adding} onClick={() => setAdding(true)}>＋ Thêm dòng</Btn>
          <Btn size="sm" disabled={saving} onClick={onClose}>Hủy</Btn>
          <Btn size="sm" variant="primary" disabled={saving || detail.isFetching || refreshRequired} onClick={() => void saveAll()}>Lưu</Btn>
        </>}
      >
      <div className="phoi-detail-body">
        {detail.isLoading && <p>Đang tải…</p>}
        {error && <div role="alert" className="phoi-detail-error">
          <p>{error}</p>
          {refreshRequired && <>
            <p>{detail.error?.message} Tải lại khoản chi trước khi lưu tiếp.</p>
            <Btn size="sm" disabled={saving || detail.isFetching} onClick={() => void refreshDetail()}>Tải lại khoản chi</Btn>
          </>}
        </div>}
        {detail.data && (
          <>
            {rows.length === 0 ? <EmptyState variant="compact" context="expenses" title="Chưa có khoản chi hộ" description="Thêm dòng để ghi nhận khoản chi của chuyến này." /> : <div className="record-table-wrap" role="region" aria-label="Các khoản chi hộ">
            {/* Card 20261002_278. `--sticky-thead-top` is -24px so a page table's header pins flush under the topbar while `.app-body` scrolls. This table lives in a DIFFERENT scrollport (`.modal__body`, 12px padding), so the inherited offset rode the header above the scrollport edge and over row 1 — the "nội dung bị cắt mép chữ" report. Overriding the token the shared rule actually consumes re-pins it flush here without touching the page-level default. */}
            <table className="record-table ops-table phoi-detail-matrix" style={{ '--sticky-thead-top': '0px' } as React.CSSProperties}>
              <thead><tr>
                <th className="phoi-detail-col--ordinal">STT</th><th className="phoi-detail-col--description">Nội dung phí</th><th className="phoi-detail-col--identity">Hóa đơn</th><th className="phoi-detail-col--money">Số tiền thu</th><th className="phoi-detail-col--money">Số tiền trả</th><th className="phoi-detail-col--identity">Người thanh toán</th><th className="phoi-detail-col--action" aria-label="Thao tác" />
              </tr></thead>
              <tbody>
                {detail.data.rows.map((row, index) => {
                  const isTrip = row.sourceKind === 'TRIP';
                  return (
                    <tr key={row.sourceId}>
                      <td data-label="STT" className="phoi-detail-col--ordinal">{index + 1}</td>
                      <td data-label="Nội dung phí" className="phoi-detail-col--description">{row.feeName ?? '—'}</td>
                      <td data-label="Hóa đơn" className="phoi-detail-col--identity">{row.invoiceNumber ?? '—'}</td>
                      <td data-label="Số tiền thu" className="phoi-detail-col--money">
                        {isTrip ? (
                          <span style={{ fontWeight: 600 }}>{row.amountThu != null ? `${formatMoney(row.amountThu)} ₫` : '—'}</span>
                        ) : (
                          <NumberField aria-label={`Số tiền thu dòng ${index + 1}`} suffix="₫" grouped value={edits[row.entryId]?.thu ?? row.amountThu ?? ''} onChange={(n) => setEdit(row, 'thu', n)} />
                        )}
                      </td>
                      <td data-label="Số tiền trả" className="phoi-detail-col--money">
                        {isTrip ? (
                          <span style={{ fontWeight: 600 }}>{`${formatMoney(row.amountTra)} ₫`}</span>
                        ) : (
                          <NumberField aria-label={`Số tiền trả dòng ${index + 1}`} suffix="₫" grouped signed value={edits[row.entryId]?.tra ?? row.amountTra ?? ''} onChange={(n) => setEdit(row, 'tra', n)} />
                        )}
                      </td>
                      <td data-label="Người thanh toán" className="phoi-detail-col--identity">{row.payerName ?? '—'}</td>
                      <td data-label="Thao tác" className="phoi-detail-col--action">
                        {isTrip ? (
                          <span style={{ color: 'var(--ink-3)', fontSize: 'var(--text-caption-size)' }}>Chi phí chuyến</span>
                        ) : (
                          <Btn size="sm" disabled={saving || row.confirmed} title={row.confirmed ? 'Khoản đã đối chiếu — dùng điều chỉnh thay vì xóa' : undefined} onClick={() => void removeRow(row)}>Xóa</Btn>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>}
            <PhoiPhieuDetailSummary items={[{ label: 'Tổng thu', amount: totals.thu }, { label: 'Tổng trả', amount: totals.tra }]} />
            {dirty && <p role="status" className="phoi-detail-note">Có thay đổi chưa lưu</p>}
            <label className="phoi-detail-linked">
              <input type="checkbox" checked={linked} onChange={(e) => setEquality(e.target.checked)} />
              Nhập Thu và Trả bằng nhau
            </label>
            {linkNotice && <p role="status" className="phoi-detail-note">{linkNotice}</p>}
            <div className="phoi-detail-meta">
              <BufferedUuiDateInput label="Ngày lấy phơi" size="sm" value={ngayLayPhoi ?? (detail.data.ngayLayPhoi ?? '')} onChange={setNgayLayPhoi} />
              <TextField label="Trạng thái lấy" value={trangThaiLay ?? detail.data.trangThaiLay ?? ''} onChange={(e) => setTrangThaiLay(e.target.value)} />
            </div>
          </>
        )}
        {dialog}
        {adding && catalog.isPending && <p role="status">Đang tải loại phí và nhân viên…</p>}
        {adding && catalog.isError && <p role="alert">{catalog.error.message} <button type="button" onClick={() => void catalog.refetch()}>Thử lại</button><button type="button" onClick={() => setAdding(false)}>Hủy</button></p>}
      </div>
      </Modal>}
      {addPanelOpen && catalog.data && <ExpenseCreateDrawer
      work={{ tripId, shipmentCode: billBookingReference(billOrBooking), containerNumber: null }}
      catalog={catalog.data} initialGroup="OPS_INCIDENTAL" entryScope="OPS"
      onClose={() => setAdding(false)}
      onSaved={() => { void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.chiHo(tripId) }); onSaved(); }}
    />}</>
  );
}
