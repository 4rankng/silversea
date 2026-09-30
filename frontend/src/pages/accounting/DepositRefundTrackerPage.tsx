// Card 20260921_19 — THEO DÕI HOÀN CƯỢC CONTAINER. Kế toán tracks container
// deposits per lot: CV date (+14-day expected default, editable), the ĐÃ
// hoàn cược tick posts the collection into the configured company fund, and the
// two standing warnings always run. Display keys are BILL + names — never a
// bare internal id.

import { useEffect, useRef, useState } from 'react';
import { expenseVndSchema } from '@tingting/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { CalendarClock, Plus, X } from 'lucide-react';
import { SkeletonTable, StatusText, useToast } from '../../components/shared';
import { Btn, FormGroup, Modal, PageHeader, useConfirm } from '../../components/UI';
import { FilterDropdown } from '../../components/FilterDropdown';
import { DateRangeFields, EmptyState, FilterBar, NumberField, SummaryRail, UuiSelectField } from '../../design-system';
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
import { qk } from '../../api/keys';
import { ApiError } from '../../lib/api';
// The record-table base + ops-table typography: the shared table pattern
// (recipe at styles/record-table.css:10-30). Page CSS declares no table skin.
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';
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

/** Work order c12 _14: the overdue count renders zero-padded, matching the
 *  acceptance doc's own example ("01 lô hàng"). */
export function formatOverdueCount(count: number): string {
  return String(count).padStart(2, '0');
}

// Per-session dismissal (PM ruling via lead): hides the overdue ALERT line and
// its toast until the session ends. The unrefunded-total line stays visible —
// work order line 2 runs continuously per status.
const CV_ALERT_DISMISS_KEY = 'deposit-cv-overdue-alert-dismissed';

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

  // Card 20260923_14: the overdue-CV alert is dismissible per session; the
  // unrefunded-total line runs continuously (work order c12 _14 line 2).
  const { toast } = useToast();
  const [cvAlertDismissed, setCvAlertDismissed] = useState(() => {
    try { return sessionStorage.getItem(CV_ALERT_DISMISS_KEY) === '1'; } catch { return false; }
  });
  const cvOverdueCount = warnings?.cvOverdueCount ?? 0;
  const unrefundedTotal = warnings?.unrefundedTotal ?? 0;
  const showCvAlert = cvOverdueCount > 0 && !cvAlertDismissed;

  // Toast once per page load when the alert is live; suppressed once the
  // alert is dismissed for this session.
  const cvAlertToastedRef = useRef(false);
  useEffect(() => {
    if (showCvAlert && !cvAlertToastedRef.current) {
      cvAlertToastedRef.current = true;
      toast({ kind: 'warning', message: `kiểm tra check cược số lượng: ${formatOverdueCount(cvOverdueCount)} lô hàng` });
    }
  }, [showCvAlert, cvOverdueCount, toast]);

  const dismissCvAlert = () => {
    try { sessionStorage.setItem(CV_ALERT_DISMISS_KEY, '1'); } catch { /* private mode */ }
    setCvAlertDismissed(true);
  };

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

  // A failed load is neither an empty result nor a populated table: it renders
  // only the error line + retry above (never the empty face — that would claim
  // a successful empty read).
  const isEmptyResult = !query.isPending && !query.isError && rows.length === 0;
  const hasRows = !query.isPending && !query.isError && rows.length > 0;

  return (
    <div className="deposit-tracker-page">
      <PageHeader title="Theo dõi hoàn cược" description="Theo dõi số tiền cược và ngày nộp công văn theo từng lô. Tiền hoàn cược được ghi nhận vào quỹ công ty đã cấu hình." />
      {dialog}
      {/* Card 20260927_152: the ONE shared strip. The from/to pair is the group
          every list shares and `Trạng thái` is the only secondary criterion, so
          it renders inline while the strip still fits two rows and folds into
          `Bộ lọc` only when the width leaves no other choice. The two page
          actions ride the bar's action slot; the page declares no filter layout
          of its own. The surrounding `<section aria-label="Bộ lọc">` is the
          landmark the page always exposed — it carries no styling. */}
      <section aria-label="Bộ lọc">
        <FilterBar
          actions={(
            <>
              <Btn variant="secondary" size="sm" onClick={() => void query.refetch()}>Lọc</Btn>
              <Btn variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setCreateModal(true)}>Thêm dòng</Btn>
            </>
          )}
        >
          <DateRangeFields
            id="deposit-date-range"
            ariaLabel="Khoảng ngày nộp công văn"
            from={from}
            to={to}
            onChange={({ from: nextFrom, to: nextTo }) => { setFrom(nextFrom); setTo(nextTo); }}
          />
          <FilterDropdown
            count={status ? 1 : 0}
            ariaLabel="Bộ lọc"
            dialogLabel="Bộ lọc hoàn cược"
            onReset={() => setStatus('')}
          >
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
          </FilterDropdown>
        </FilterBar>
      </section>

      {(showCvAlert || unrefundedTotal > 0) && (
        <section className="deposit-tracker-warnings" role="alert">
          {showCvAlert && (
            <p className="deposit-tracker-warnings__item deposit-tracker-warnings__item--danger">
              kiểm tra check cược số lượng: <strong>{formatOverdueCount(cvOverdueCount)} lô hàng</strong>
            </p>
          )}
          {unrefundedTotal > 0 && (
            <p className="deposit-tracker-warnings__item">
              Chưa hoàn cược số tiền: <strong>{formatMoney(unrefundedTotal)} ₫</strong> — Vui lòng kiểm tra lại!
            </p>
          )}
          {showCvAlert && (
            <button type="button" className="deposit-tracker-warnings__dismiss" onClick={dismissCvAlert} aria-label="Ẩn cảnh báo quá 7 ngày chưa nộp công văn">
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </section>
      )}

      {/* Recipe #4: the summary strip is the ONE shared rail — a hand-rolled
          KPI/tile block is exactly the page-local variant the rails ban. */}
      <SummaryRail
        ariaLabel="Tổng tiền cược"
        items={[{ label: 'Tổng tiền cược (theo bộ lọc)', value: `${formatMoney(query.data?.total ?? 0)} ₫` }]}
      />

      {actionError && <p role="alert" style={{ color: 'var(--err, #dc2626)' }}>{actionError}</p>}
      {query.isError && <p role="alert">{query.error.message} <Btn variant="secondary" size="sm" onClick={() => void query.refetch()}>Thử lại</Btn></p>}

      {/* Recipe #1: the shared record-table base. The container band in
          record-table.css collapses each row into a labelled record card at
          ≤1100px, so every cell carries its own `data-label`. */}
      {query.isPending && <SkeletonTable rows={5} cols={6} />}
      {isEmptyResult && (
        <EmptyState
          variant="compact"
          context="wallet"
          title="Không có dòng theo dõi nào trong bộ lọc."
          description="Điều chỉnh khoảng ngày hoặc trạng thái, hoặc thêm một dòng theo dõi mới."
        />
      )}
      {hasRows && (
        <div className="record-table-wrap">
          <table className="record-table ops-table">
            <thead>
              <tr>
                <th>STT</th><th>Ngày</th><th>Khách hàng</th><th>Hãng tàu</th><th>Bill</th>
                <th className="num">Số tiền cược</th><th>Ngày nộp CV</th><th>Ngày dự kiến hoàn cược</th>
                <th>Trạng thái</th><th>Ghi chú</th><th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <td data-label="STT" className="deposit-col--token">{index + 1}</td>
                  <td data-label="Ngày" className="deposit-col--token">{formatDepositDate(row.createdAt)}</td>
                  <td data-label="Khách hàng">{row.customerName}</td>
                  <td data-label="Hãng tàu">{row.carrierName}</td>
                  <td data-label="Bill" className="deposit-col--token">{row.billNumber}</td>
                  <td data-label="Số tiền cược" className="num deposit-col--token">{formatMoney(Number(row.depositAmount))} ₫</td>
                  <td data-label="Ngày nộp CV" className="deposit-col--token">{row.cvSubmittedDate ? formatDepositDate(row.cvSubmittedDate) : '—'}</td>
                  <td data-label="Ngày dự kiến hoàn cược" className="deposit-col--token">{row.expectedRefundDate ? formatDepositDate(row.expectedRefundDate) : '—'}</td>
                  <td data-label="Trạng thái">
                    <StatusText variant={row.status === 'DA_HOAN_CUOC' ? 'success' : 'warning'}>
                      {STATUS_LABELS[row.status]}
                    </StatusText>
                  </td>
                  <td data-label="Ghi chú">{row.note ?? '—'}</td>
                  <td data-label="" className="record-table__action">
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
            </tbody>
          </table>
        </div>
      )}

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
  const [amount, setAmount] = useState<number | ''>(Number(row.depositAmount) > 0 ? Number(row.depositAmount) : '');
  const [note, setNote] = useState(row.note ?? '');
  const refundMutation = useMutation({
    mutationFn: () => updateDepositTrackerDates(row.id, {
      cvSubmittedDate: cvDate || null,
      expectedRefundDate: expected || null,
      ...(amount !== '' ? { depositAmount: parseDepositAmount(String(amount)) } : {}),
      note: note.trim() || null,
    }),
    onSuccess: () => {
      onSaved();
    },
  });
  return (
    <form className="deposit-tracker-form" onSubmit={(event) => { event.preventDefault(); refundMutation.mutate(); }}>
      <NumberField label="Số tiền cược (₫)" grouped value={amount} onChange={setAmount} />
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
  const [amount, setAmount] = useState<number | ''>('');
  const [cvDate, setCvDate] = useState('');
  const [note, setNote] = useState('');
  const createMutation = useMutation({
    mutationFn: () => createDepositTracker({
      billNumber, customerName, carrierName,
      depositAmount: parseDepositAmount(amount === '' ? '' : String(amount)),
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
      <NumberField label="Số tiền cược (₫)" grouped value={amount} onChange={setAmount} />
      <BufferedUuiDateInput label="Ngày nộp CV (tùy chọn)" value={cvDate} onChange={setCvDate} />
      <FormGroup label="Ghi chú"><input className="input" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></FormGroup>
      {createMutation.isError && <p role="alert">{createMutation.error.message}</p>}
      <Btn type="submit" variant="primary" size="sm" disabled={createMutation.isPending || !billNumber || !customerName || !carrierName}>Lưu dòng</Btn>
    </form>
  );
}
