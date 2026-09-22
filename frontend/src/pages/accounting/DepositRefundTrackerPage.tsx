// Card 20260921_19 — THEO DÕI HOÀN CƯỢC CONTAINER. Kế toán tracks container
// deposits per lot: CV date (+14-day expected default, editable), the ĐÃ
// hoàn cược tick posts the collection into the configured company fund, and the
// two standing warnings always run. Display keys are BILL + names — never a
// bare internal id.

import { useState } from 'react';
import { expenseVndSchema } from '@tingting/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { CalendarClock, Plus } from 'lucide-react';
import { Btn, FormGroup, Modal, PageHeader, useConfirm } from '../../components/UI';
import { BufferedUuiDateInput } from '../../design-system/forms/BufferedUuiDateInput';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import {
  createDepositTracker,
  listDepositTrackers,
  markDepositRefunded,
  updateDepositTrackerDates,
  type DepositStatus,
  type DepositTrackerRow,
} from '../../api/depositRefundClient';
import { formatMoney } from '../../lib/format';
import { qk } from '../../api/keys';
import { ApiError } from '../../lib/api';
import './DepositRefundTrackerPage.css';

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

/** Preserve signs/decimals as invalid rather than silently changing money. */
export function parseDepositAmount(value: string): number {
  const text = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+|\d{1,3}(?:,\d{3})+)$/.test(text)) {
    throw new Error('Số tiền cược phải là số nguyên dương.');
  }
  const amount = Number(text.replace(/[.,]/g, ''));
  if (!expenseVndSchema.safeParse(amount).success || amount <= 0) throw new Error('Số tiền cược phải là số nguyên dương.');
  return amount;
}

export default function DepositRefundTrackerPage() {
  // Outstanding deposits may be older than this month; start with all dates.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<DepositStatus | ''>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [dateModal, setDateModal] = useState<DepositTrackerRow | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const { confirm, dialog } = useConfirm();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: qk.depositTracker.list(from, to, status),
    queryFn: () => listDepositTrackers(from || undefined, to || undefined, status || undefined),
  });
  const rows = query.data?.items ?? [];
  const warnings = query.data?.warnings;
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: qk.depositTracker.all });

  const refundMutation = useMutation({
    mutationFn: (row: DepositTrackerRow) => markDepositRefunded(row.id, Number(row.depositAmount)),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: async (error: Error) => {
      setActionError(error.message);
      if (error instanceof ApiError && error.status === 409) {
        await queryClient.invalidateQueries({ queryKey: qk.depositTracker.all });
      }
    },
  });

  const handleRefundTick = async (row: DepositTrackerRow) => {
    if (refundMutation.isPending) return;
    const ok = await confirm(
      `Xác nhận đã thu hoàn cược cho Bill ${row.billNumber} (${formatMoney(Number(row.depositAmount))} ₫)? Tiền sẽ về quỹ công ty đã cấu hình.`,
      { confirmLabel: 'Đã hoàn cược' },
    );
    if (ok) refundMutation.mutate(row);
  };

  return (
    <div className="deposit-tracker-page">
      <PageHeader title="Theo dõi hoàn cược container" description="Theo dõi số tiền cược và ngày nộp công văn theo từng lô. Tiền hoàn cược được ghi nhận vào quỹ công ty đã cấu hình." />
      {dialog}
      <section className="deposit-tracker-filters" aria-label="Bộ lọc">
        <BufferedUuiDateInput label="Từ ngày" size="sm" value={from} onChange={setFrom} />
        <BufferedUuiDateInput label="Đến ngày" size="sm" value={to} onChange={setTo} />
        <UuiSelectField
          label="Trạng thái"
          ariaLabel="Trạng thái hoàn cược"
          value={status}
          onChange={(event) => setStatus(event.target.value as DepositStatus | '')}
          options={[
            { value: '', label: 'Tất cả' },
            { value: 'CHUA_HOAN_CUOC', label: 'Chưa hoàn cược' },
            { value: 'DA_HOAN_CUOC', label: 'Đã hoàn cược' },
          ]}
        />
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

      {actionError && <p role="alert" style={{ color: 'var(--err, #dc2626)' }}>{actionError}</p>}
      {query.isError && <p role="alert">{query.error.message} <Btn variant="secondary" size="sm" onClick={() => void query.refetch()}>Thử lại</Btn></p>}

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
                <td className="date-cell">{formatDepositDate(row.createdAt)}</td>
                <td>{row.customerName}</td>
                <td>{row.carrierName}</td>
                <td className="bill">{row.billNumber}</td>
                <td className="num">{formatMoney(Number(row.depositAmount))} ₫</td>
                <td className="date-cell">{row.cvSubmittedDate ? formatDepositDate(row.cvSubmittedDate) : '—'}</td>
                <td className="date-cell">{row.expectedRefundDate ? formatDepositDate(row.expectedRefundDate) : '—'}</td>
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
                        <CalendarClock size={14} /> Ngày CV / số tiền
                      </Btn>
                      <Btn
                        variant="primary"
                        size="sm"
                        disabled={Number(row.depositAmount) <= 0 || refundMutation.isPending}
                        onClick={() => void handleRefundTick(row)}
                      >
                        Đã hoàn cược
                      </Btn>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {query.isPending && <tr><td colSpan={11}>Đang tải theo dõi hoàn cược…</td></tr>}
            {!query.isPending && !query.isError && rows.length === 0 && (
              <tr><td colSpan={11}>Không có dòng theo dõi nào trong bộ lọc.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal isOpen={dateModal !== null} title={`Cập nhật hoàn cược - Bill ${dateModal?.billNumber ?? ''}`} onClose={() => setDateModal(null)}>
        {dateModal && (
          <DateEditForm
            row={dateModal}
            onSaved={() => {
              setDateModal(null);
              invalidate();
            }}
          />
        )}
      </Modal>

      <Modal isOpen={createModal} title="Thêm dòng theo dõi hoàn cược" onClose={() => setCreateModal(false)}>
        <CreateForm
          onSaved={() => {
            setCreateModal(false);
            invalidate();
          }}
        />
      </Modal>
    </div>
  );
}

function DateEditForm({ row, onSaved }: {
  row: DepositTrackerRow;
  onSaved: () => void;
}) {
  const [cvDate, setCvDate] = useState(row.cvSubmittedDate ?? '');
  const [expected, setExpected] = useState(row.expectedRefundDate ?? nextExpectedRefundDefault(row.cvSubmittedDate) ?? '');
  const [amount, setAmount] = useState(Number(row.depositAmount) > 0 ? row.depositAmount : '');
  const [note, setNote] = useState(row.note ?? '');
  const refundMutation = useMutation({
    mutationFn: () => updateDepositTrackerDates(row.id, {
      cvSubmittedDate: cvDate || null,
      expectedRefundDate: expected || null,
      ...(amount.trim() ? { depositAmount: parseDepositAmount(amount) } : {}),
      note: note.trim() || null,
    }),
    onSuccess: () => {
      onSaved();
    },
  });
  return (
    <form className="deposit-tracker-form" onSubmit={(event) => { event.preventDefault(); refundMutation.mutate(); }}>
      <FormGroup label="Số tiền cược (₫)"><input className="input" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" /></FormGroup>
      <BufferedUuiDateInput label="Ngày nộp CV" value={cvDate} onChange={(value) => {
        if (!expected || expected === nextExpectedRefundDefault(cvDate)) setExpected(nextExpectedRefundDefault(value) ?? '');
        setCvDate(value);
      }} />
      <BufferedUuiDateInput label="Ngày dự kiến hoàn cược" value={expected} onChange={setExpected} />
      <p className="deposit-tracker-form__hint">Bỏ trống ngày dự kiến để hệ thống tự điền ngày nộp CV + 14 ngày.</p>
      <FormGroup label="Ghi chú"><input className="input" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></FormGroup>
      {refundMutation.isError && <p role="alert">{refundMutation.error.message}</p>}
      <Btn type="submit" variant="primary" size="sm" disabled={refundMutation.isPending}>Lưu thay đổi</Btn>
    </form>
  );
}

function CreateForm({ onSaved }: {
  onSaved: () => void;
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
      depositAmount: parseDepositAmount(amount),
      cvSubmittedDate: cvDate || null,
      note: note || null,
    }),
    onSuccess: () => {
      onSaved();
    },
  });
  return (
    <form className="deposit-tracker-form" onSubmit={(event) => { event.preventDefault(); createMutation.mutate(); }}>
      <FormGroup label="Số Bill"><input className="input" value={billNumber} onChange={(event) => setBillNumber(event.target.value)} required maxLength={80} /></FormGroup>
      <FormGroup label="Khách hàng"><input className="input" value={customerName} onChange={(event) => setCustomerName(event.target.value)} required /></FormGroup>
      <FormGroup label="Hãng tàu"><input className="input" value={carrierName} onChange={(event) => setCarrierName(event.target.value)} required /></FormGroup>
      <FormGroup label="Số tiền cược (₫)"><input className="input" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" required /></FormGroup>
      <BufferedUuiDateInput label="Ngày nộp CV (tùy chọn)" value={cvDate} onChange={setCvDate} />
      <FormGroup label="Ghi chú"><input className="input" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></FormGroup>
      {createMutation.isError && <p role="alert">{createMutation.error.message}</p>}
      <Btn type="submit" variant="primary" size="sm" disabled={createMutation.isPending || !billNumber || !customerName || !carrierName}>Lưu dòng</Btn>
    </form>
  );
}
