import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  correctPhoiPhieuRow, getPhoiPhieuChiHo, updatePhoiPhieuMeta,
  updatePhoiPhieuRowAmounts, voidPhoiPhieuRow, type PhoiPhieuFeeRow,
} from '../../api/phoiPhieuClient';
import { formatCurrency } from '../../lib/format';
import { qk } from '../../api/keys';
import { useConfirm } from '../../components/UI';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { ExpenseCreateDrawer } from '../expense-accounting/ExpenseCreateDrawer';

interface Props {
  tripId: number;
  onClose: () => void;
  onSaved: () => void;
}

export function PhoiPhieuChiHoDialog({ tripId, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: qk.phoiPhieu.chiHo(tripId),
    queryFn: () => getPhoiPhieuChiHo(tripId),
  });
  const [edits, setEdits] = useState<Record<number, { thu: string; tra: string }>>({});
  const [linked, setLinked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const catalog = useQuery({ queryKey: qk.expenseAccounting.catalog, queryFn: expenseAccountingClient.catalog, enabled: adding });
  const { confirm, dialog } = useConfirm();

  const rows = detail.data?.rows ?? [];
  const totals = useMemo(() => {
    const live = (row: PhoiPhieuFeeRow, key: 'thu' | 'tra') => {
      const edit = edits[row.entryId];
      const value = edit ? Number(edit[key] ?? 0) : row[key === 'thu' ? 'amountThu' : 'amountTra'] ?? 0;
      return Number.isFinite(value) ? value : 0;
    };
    return {
      thu: rows.reduce((sum, row) => sum + live(row, 'thu'), 0),
      tra: rows.reduce((sum, row) => sum + live(row, 'tra'), 0),
    };
  }, [rows, edits]);

  function setEdit(row: PhoiPhieuFeeRow, key: 'thu' | 'tra', value: string) {
    setEdits((current) => {
      const target = { ...(current[row.entryId] ?? { thu: String(row.amountThu ?? ''), tra: String(row.amountTra ?? '') }) };
      target[key] = value;
      if (linked) target[key === 'thu' ? 'tra' : 'thu'] = value;
      return { ...current, [row.entryId]: target };
    });
  }

  async function saveAll() {
    setSaving(true);
    setError('');
    try {
      for (const row of rows) {
        const edit = edits[row.entryId];
        if (!edit) continue;
        const thu = edit.thu === '' ? null : Number(edit.thu);
        const tra = edit.tra === '' ? null : Number(edit.tra);
        if (Number(edit.thu ?? NaN) === Number(row.amountThu ?? NaN) && Number(edit.tra ?? NaN) === Number(row.amountTra ?? NaN)) continue;
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
      await queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.chiHo(tripId) });
      onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được thay đổi.');
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(row: PhoiPhieuFeeRow) {
    const ok = await confirm(`Xóa dòng "${row.feeName ?? 'phí'}"? Khoản đã đối chiếu sẽ không xóa được.`, { variant: 'danger', confirmLabel: 'Xóa' });
    if (!ok) return;
    setSaving(true);
    setError('');
    try {
      await voidPhoiPhieuRow(tripId, row.sourceId, 'Kế toán xóa dòng trong xem chi tiết chi hộ');
      await queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.chiHo(tripId) });
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : 'Không xóa được dòng.');
    } finally {
      setSaving(false);
    }
  }

  async function saveMeta(ngayLayPhoi: string, trangThaiLay: string) {
    await updatePhoiPhieuMeta(tripId, {
      ...(ngayLayPhoi ? { ngayLayPhoi } : {}),
      ...(trangThaiLay ? { trangThaiLay } : {}),
    });
  }

  return (
    <><div role="dialog" aria-modal="true" aria-label="Chi tiết chi hộ" className="ops-modal" style={{ maxWidth: 720 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 'var(--text-body-size)' }}>Chi tiết chi hộ {detail.data?.tripCode ?? ''}</h2>
        <button type="button" aria-label="Đóng" onClick={onClose}>✕</button>
      </header>
      <div className="ops-modal__body">
        {detail.isLoading && <p>Đang tải…</p>}
        {error && <p role="alert" style={{ color: 'var(--err, #dc2626)' }}>{error}</p>}
        {detail.data && (
          <>
            <table className="tt-table" style={{ fontSize: 'var(--text-caption-size)' }}>
              <thead><tr>
                <th>STT</th><th>Nội dung phí</th><th>Hóa đơn</th><th>Số tiền thu</th><th>Số tiền trả</th><th>Người thanh toán</th><th aria-label="Thao tác" />
              </tr></thead>
              <tbody>
                {detail.data.rows.map((row, index) => {
                  return (
                    <tr key={row.sourceId}>
                      <td>{index + 1}</td>
                      <td>{row.feeName ?? '—'}</td>
                      <td>{row.invoiceNumber ?? '—'}</td>
                      <td><input aria-label={`Số tiền thu dòng ${index + 1}`} value={edits[row.entryId]?.thu ?? String(row.amountThu ?? '')} onChange={(e) => setEdit(row, 'thu', e.target.value)} inputMode="numeric" /></td>
                      <td><input aria-label={`Số tiền trả dòng ${index + 1}`} value={edits[row.entryId]?.tra ?? String(row.amountTra ?? '')} onChange={(e) => setEdit(row, 'tra', e.target.value)} inputMode="numeric" /></td>
                      <td>{row.payerName ?? '—'}</td>
                      <td><button type="button" className="btn btn--secondary btn--sm" disabled={saving || row.confirmed} title={row.confirmed ? 'Khoản đã đối chiếu — dùng điều chỉnh thay vì xóa' : undefined} onClick={() => void removeRow(row)}>Xóa</button></td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={3}><strong>TỔNG CỘNG</strong></td>
                  <td><strong>{formatCurrency(totals.thu)}</strong></td>
                  <td><strong>{formatCurrency(totals.tra)}</strong></td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
              <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
              Nhập Thu và Trả bằng nhau
            </label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
              <label>Ngày lấy phơi <input type="date" defaultValue={detail.data.ngayLayPhoi ?? ''} onChange={(e) => void saveMeta(e.target.value, detail.data?.trangThaiLay ?? '')} /></label>
              <label>Trạng thái lấy <input defaultValue={detail.data.trangThaiLay ?? ''} onBlur={(e) => void saveMeta(detail.data?.ngayLayPhoi ?? '', e.target.value)} /></label>
              <button type="button" className="btn btn--secondary btn--sm" disabled={saving || adding} onClick={() => setAdding(true)}>＋ Thêm dòng</button>
              <button type="button" className="btn btn--primary btn--sm" disabled={saving} onClick={() => void saveAll()}>Lưu</button>
              <button type="button" className="btn btn--secondary btn--sm" disabled={saving} onClick={onClose}>Hủy</button>
            </div>
          </>
        )}
        {dialog}
        {adding && catalog.isPending && <p role="status">Đang tải loại phí và nhân viên…</p>}
        {adding && catalog.isError && <p role="alert">{catalog.error.message} <button type="button" onClick={() => void catalog.refetch()}>Thử lại</button><button type="button" onClick={() => setAdding(false)}>Hủy</button></p>}
      </div>
    </div>
    {adding && catalog.data && <ExpenseCreateDrawer
      work={{ tripId, shipmentCode: detail.data?.tripCode ?? null, containerNumber: null }}
      catalog={catalog.data} initialGroup="OPS_INCIDENTAL" entryScope="OPS"
      onClose={() => setAdding(false)}
      onSaved={() => { void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.chiHo(tripId) }); onSaved(); }}
    />}</>
  );
}
