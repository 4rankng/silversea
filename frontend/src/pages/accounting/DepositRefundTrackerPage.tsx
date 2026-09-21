// Card 20260921_19 — THEO DÕI HOÀN CƯỢC CONTAINER. Kế toán tracks container
// deposits per lot: CV date (+14-day expected default, editable), the ĐÃ
// hoàn cược tick posts the collection into the ACB (COMPANY) fund, and the
// two standing warnings always run. Display keys are BILL + names — never a
// bare internal id.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { CalendarClock, Plus } from 'lucide-react';
import { Btn, FormGroup, Modal, PageHeader, useConfirm } from '../../components/UI';
import { BufferedUuiDateInput } from '../../design-system/forms/BufferedUuiDateInput';
import {
  createDepositTracker,
  listDepositTrackers,
  markDepositRefunded,
  updateDepositTrackerDates,
  type DepositStatus,
  type DepositTrackerRow,
} from '../../api/depositRefundClient';
import { formatMoney } from '../../lib/format';

/** ISO date → dd/mm/yy display (the card's typing pattern). */
export function formatDepositDate(iso: string | null): string {
  if (!iso) return '—';
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year.slice(2)}`;
}

/** Ngày dự kiến hoàn cược default: CV + 14 days (client-side mirror of the
 *  server default so the edit dialog shows what will land). */
export function nextExpectedRefundDefault(cvIso: string | null): string | null {
  if (!cvIso) return null;
  const date = new Date(`${cvIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 14);
  return date.toISOString().slice(0, 10);
}

const STATUS_LABELS: Record<DepositStatus, string> = {
  CHUA_HOAN_CUOC: 'Chưa hoàn cược',
  DA_HOAN_CUOC: 'Đã hoàn cược',
};

function firstOfMonthToday(): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export default function DepositRefundTrackerPage() {
  const initialPeriod = useMemo(firstOfMonthToday, []);
  const [from, setFrom] = useState(initialPeriod.from);
  const [to, setTo] = useState(initialPeriod.to);
  const [status, setStatus] = useState<DepositStatus | ''>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [dateModal, setDateModal] = useState<DepositTrackerRow | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const { confirm, dialog } = useConfirm();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['deposit-refund', from, to, status],
    queryFn: () => listDepositTrackers(from || undefined, to || undefined, status || undefined),
  });
  const rows = query.data?.items ?? [];
  const warnings = query.data?.warnings;
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['deposit-refund'] });

  const refundMutation = useMutation({
    mutationFn: (id: number) => markDepositRefunded(id),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (error: Error) => setActionError(error.message),
  });

  const handleRefundTick = async (row: DepositTrackerRow) => {
    const ok = await confirm(
      `Xác nhận ĐÃ thu hoàn cược cho Bill ${row.billNumber} (${formatMoney(Number(row.depositAmount))} ₫)? Tiền sẽ về quỹ ACB.`,
      { confirmLabel: 'Đã hoàn cược' },
    );
    if (ok) refundMutation.mutate(row.id);
  };

  return (
    <div className="deposit-tracker-page">
      <PageHeader title="Theo dõi hoàn cược container" description="Số tiền cược, ngày nộp công văn và trạng thái hoàn cược theo từng lô; tick ĐÃ hoàn cược đổ tiền về quỹ ACB." />
      {dialog}
      <section className="deposit-tracker-filters" aria-label="Bộ lọc">
        <BufferedUuiDateInput label="Từ ngày" size="sm" value={from} onChange={setFrom} />
        <BufferedUuiDateInput label="Đến ngày" size="sm" value={to} onChange={setTo} />
        <FormGroup label="Trạng thái">
          <select aria-label="Trạng thái hoàn cược" value={status} onChange={(event) => setStatus(event.target.value as DepositStatus | '')}>
            <option value="">Tất cả</option>
            <option value="CHUA_HOAN_CUOC">Chưa hoàn cược</option>
            <option value="DA_HOAN_CUOC">Đã hoàn cược</option>
          </select>
        </FormGroup>
        <Btn variant="secondary" size="sm" onClick={() => void query.refetch()}>Lọc</Btn>
        <Btn variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setCreateModal(true)}>Thêm dòng</Btn>
      </section>

      {warnings && (warnings.cvOverdueCount > 0 || warnings.unrefundedTotal > 0) && (
        <section className="deposit-tracker-warnings" role="alert">
          {warnings.cvOverdueCount > 0 && (
            <p className="deposit-tracker-warnings__item">
              <CalendarClock size={14} /> Kiểm tra check cược: <strong>{warnings.cvOverdueCount}</strong> lô hàng quá 7 ngày chưa có ngày nộp công văn.
            </p>
          )}
          {warnings.unrefundedTotal > 0 && (
            <p className="deposit-tracker-warnings__item">
              Chưa hoàn cược số tiền: <strong>{formatMoney(warnings.unrefundedTotal)} ₫</strong> — Vui lòng kiểm tra lại!
            </p>
          )}
        </section>
      )}

      <section className="deposit-tracker-totals" aria-label="Tổng tiền cược">
        <div className="deposit-tracker-totals__tile">
          <span>Tổng tiền cược (theo bộ lọc)</span>
          <strong>{formatMoney(query.data?.total ?? 0)} ₫</strong>
        </div>
      </section>

      <div className="table-wrap">
        <table className="deposit-tracker-table">
          <thead>
            <tr>
              <th>STT</th><th>Ngày</th><th>Khách hàng</th><th>Hãng tàu</th><th>Bill</th>
              <th className="num">Số tiền cược</th><th>Ngày nộp CV</th><th>Ngày dự kiến hoàn cược</th>
              <th>Trạng thái</th><th>Ghi chú</th><th aria-label="Thao tác" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id} className={row.status === 'DA_HOAN_CUOC' ? 'is-refunded' : undefined}>
                <td>{index + 1}</td>
                <td>{formatDepositDate(row.createdAt)}</td>
                <td>{row.customerName}</td>
                <td>{row.carrierName}</td>
                <td className="bill">{row.billNumber}</td>
                <td className="num">{formatMoney(Number(row.depositAmount))} ₫</td>
                <td>{row.cvSubmittedDate ? formatDepositDate(row.cvSubmittedDate) : '—'}</td>
                <td>{row.expectedRefundDate ? formatDepositDate(row.expectedRefundDate) : '—'}</td>
                <td>
                  <span className={`deposit-status deposit-status--${row.status === 'DA_HOAN_CUOC' ? 'done' : 'pending'}`}>
                    {STATUS_LABELS[row.status]}
                  </span>
                </td>
                <td className="note">{row.note ?? '—'}</td>
                <td className="actions">
                  {row.status === 'CHUA_HOAN_CUOC' && (
                    <>
                      <Btn variant="secondary" size="sm" onClick={() => setDateModal(row)}>
                        <CalendarClock size={14} /> Ngày CV
                      </Btn>
                      <Btn
                        variant="primary"
                        size="sm"
                        disabled={Number(row.depositAmount) <= 0}
                        onClick={() => void handleRefundTick(row)}
                      >
                        Đã hoàn cược
                      </Btn>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={11}>Không có dòng theo dõi nào trong bộ lọc.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal isOpen={dateModal !== null} title={`Ngày nộp CV - Bill ${dateModal?.billNumber ?? ''}`} onClose={() => setDateModal(null)}>
        {dateModal && (
          <DateEditForm
            row={dateModal}
            onSaved={() => {
              setDateModal(null);
              invalidate();
            }}
            onError={setActionError}
          />
        )}
      </Modal>

      <Modal isOpen={createModal} title="Thêm dòng theo dõi hoàn cược" onClose={() => setCreateModal(false)}>
        <CreateForm
          onSaved={() => {
            setCreateModal(false);
            invalidate();
          }}
          onError={setActionError}
        />
      </Modal>
    </div>
  );
}

function DateEditForm({ row, onSaved, onError }: {
  row: DepositTrackerRow;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [cvDate, setCvDate] = useState(row.cvSubmittedDate ?? '');
  const [expected, setExpected] = useState(row.expectedRefundDate ?? nextExpectedRefundDefault(row.cvSubmittedDate) ?? '');
  const refundMutation = useMutation({
    mutationFn: () => updateDepositTrackerDates(row.id, {
      cvSubmittedDate: cvDate || null,
      expectedRefundDate: expected || null,
    }),
    onSuccess: () => {
      onError('');
      onSaved();
    },
    onError: (error: Error) => onError(error.message),
  });
  return (
    <form className="deposit-tracker-form" onSubmit={(event) => { event.preventDefault(); refundMutation.mutate(); }}>
      <BufferedUuiDateInput label="Ngày nộp CV" value={cvDate} onChange={setCvDate} />
      <BufferedUuiDateInput label="Ngày dự kiến hoàn cược" value={expected} onChange={setExpected} />
      <p className="deposit-tracker-form__hint">Bỏ trống ngày dự kiến để hệ thống tự điền ngày nộp CV + 14 ngày.</p>
      <Btn type="submit" variant="primary" size="sm" disabled={refundMutation.isPending}>Lưu ngày</Btn>
    </form>
  );
}

function CreateForm({ onSaved, onError }: {
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [billNumber, setBillNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [carrierName, setCarrierName] = useState('');
  const [amount, setAmount] = useState('');
  const [cvDate, setCvDate] = useState('');
  const [note, setNote] = useState('');
  const createMutation = useMutation({
    mutationFn: () => createDepositTracker({
      billNumber, customerName, carrierName,
      depositAmount: Number(amount.replace(/\D/g, '')) || 0,
      cvSubmittedDate: cvDate || null,
      note: note || null,
    }),
    onSuccess: () => {
      onError('');
      onSaved();
    },
    onError: (error: Error) => onError(error.message),
  });
  return (
    <form className="deposit-tracker-form" onSubmit={(event) => { event.preventDefault(); createMutation.mutate(); }}>
      <FormGroup label="Số Bill"><input value={billNumber} onChange={(event) => setBillNumber(event.target.value)} required maxLength={80} /></FormGroup>
      <FormGroup label="Khách hàng"><input value={customerName} onChange={(event) => setCustomerName(event.target.value)} required /></FormGroup>
      <FormGroup label="Hãng tàu"><input value={carrierName} onChange={(event) => setCarrierName(event.target.value)} required /></FormGroup>
      <FormGroup label="Số tiền cược (₫)"><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" /></FormGroup>
      <BufferedUuiDateInput label="Ngày nộp CV (tùy chọn)" value={cvDate} onChange={setCvDate} />
      <FormGroup label="Ghi chú"><input value={note} onChange={(event) => setNote(event.target.value)} /></FormGroup>
      <Btn type="submit" variant="primary" size="sm" disabled={createMutation.isPending || !billNumber || !customerName || !carrierName}>Lưu dòng</Btn>
    </form>
  );
}
