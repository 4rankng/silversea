// Card 20260921_19 — THEO DÕI HOÀN CƯỢC CONTAINER. Kế toán tracks container
// deposits per lot: CV date (+14-day expected default, editable), the ĐÃ
// hoàn cược tick posts the collection into the configured company fund, and the
// two standing warnings always run. Display keys are BILL + names — never a
// bare internal id.

import { useRef, useState } from 'react';
import { expenseVndSchema } from '@tingting/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { CalendarClock, Plus, X } from 'lucide-react';
import { SkeletonTable, StatusText } from '../../components/shared';
import { Money } from '../../components/shared/Money';
import { Btn, FormGroup, Modal, PageHeader } from '../../components/UI';
import { FilterDropdown } from '../../components/FilterDropdown';
import { DateRangeFields, EmptyState, FilterBar, NumberField, SummaryRail, UuiSelectField } from '../../design-system';
import { BufferedUuiDateInput } from '../../design-system/forms/BufferedUuiDateInput';
import {
  createDepositTracker,
  DEPOSIT_CATEGORY_LABELS,
  listDepositTrackers,
  searchBillSuggestions,
  markDepositRefunded,
  updateDepositTrackerDates,
  type DepositCategory,
  type DepositStatus,
  type DepositTrackerRow,
} from '../../api/depositRefundClient';
import { formatISODate, formatMoney } from '../../lib/format';
import { qk } from '../../api/keys';
import { ApiError } from '../../lib/api';
// The record-table base + ops-table typography: the shared table pattern
// (recipe at styles/record-table.css:10-30). Page CSS declares no table skin.
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';
import { usePeriodRange } from '../../hooks/usePeriodRange';
import './DepositRefundTrackerPage.css';

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

// Per-session dismissal (PM ruling via lead): hides the overdue ALERT line
// until the session ends. The unrefunded-total line stays visible — work
// order line 2 runs continuously per status. SIL-877 (CR-009.1 3.3): the red
// banner at the top of the table is the ONE overdue surface — the duplicate
// bottom toast is gone.
const CV_ALERT_DISMISS_KEY = 'deposit-cv-overdue-alert-dismissed';

const STATUS_LABELS: Record<DepositStatus, string> = {
  // SIL-1298 — "nhãn ngắn hơn" branch of the expected: the full
  // 'Chưa hoàn cược' needed a 92px column for two lines (the dot + gutters
  // eat 24px of it) and that broke the 1129px canvas law — 'Chưa hoàn'/
  // 'Đã hoàn' read on ONE line inside the 78px floor, in the refund-tracker
  // context the column header owns. The filter/create-modal vocabulary keeps
  // the full 'Chưa hoàn cược' name.
  CHUA_HOAN_CUOC: 'Chưa hoàn',
  DA_HOAN_CUOC: 'Đã hoàn',
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

/** SIL-1061 — số đã hoàn ghi nhận trên dòng (NULL/0 = chưa có đợt nào). */
export function depositRecovered(row: Pick<DepositTrackerRow, 'depositAmount' | 'recoveredAmount'>): number {
  return Number(row.recoveredAmount ?? 0);
}

/** Còn lại phải hoàn = số cược − đã hoàn (không âm) — dòng bảng và prefill
 *  của hộp hoàn cược cùng đọc đúng một số này. */
export function depositRemaining(row: Pick<DepositTrackerRow, 'depositAmount' | 'recoveredAmount'>): number {
  return Math.max(0, Number(row.depositAmount) - depositRecovered(row));
}

/** Ngày hôm nay theo lịch VN (UTC+7 cố định — đối chiếu vnCalendarDate của BE). */
export function vnTodayIso(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

export default function DepositRefundTrackerPage() {
  // SIL-1295 — the window opens on the current work period (the exact range
  // the header chip prints). The date fields stay visible and clearable, so
  // the older outstanding deposits this list used to open on ("start with all
  // dates") remain one clear away — and the active window is never invisible.
  const periodRange = usePeriodRange();
  const [from, setFrom] = useState(periodRange.from);
  const [to, setTo] = useState(periodRange.to);
  const [status, setStatus] = useState<DepositStatus | ''>('');
  // SIL-764 — Phân loại: all | Cược container | Tạm thu sửa chữa.
  const [category, setCategory] = useState<DepositCategory | ''>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [dateModal, setDateModal] = useState<DepositTrackerRow | null>(null);
  // SIL-1061 — hộp nhập số đã hoàn + ngày nhận thực tế thay confirm trần.
  const [refundModal, setRefundModal] = useState<DepositTrackerRow | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [editingAmountId, setEditingAmountId] = useState<number | null>(null);
  const [editingAmountVal, setEditingAmountVal] = useState<number | ''>('');
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: qk.depositTracker.list(from, to, status, category),
    queryFn: () => listDepositTrackers(from || undefined, to || undefined, status || undefined, category || undefined),
  });
  const rows = query.data?.items ?? [];
  const warnings = query.data?.warnings;
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: qk.depositTracker.all });

  // Card 20260923_14: the overdue-CV alert is dismissible per session; the
  // unrefunded-total line runs continuously (work order c12 _14 line 2).
  const [cvAlertDismissed, setCvAlertDismissed] = useState(() => {
    try { return sessionStorage.getItem(CV_ALERT_DISMISS_KEY) === '1'; } catch { return false; }
  });
  const cvOverdueCount = warnings?.cvOverdueCount ?? 0;
  const unrefundedTotal = warnings?.unrefundedTotal ?? 0;
  const showCvAlert = cvOverdueCount > 0 && !cvAlertDismissed;

  const dismissCvAlert = () => {
    try { sessionStorage.setItem(CV_ALERT_DISMISS_KEY, '1'); } catch { /* private mode */ }
    setCvAlertDismissed(true);
  };

  const inlineAmountMutation = useMutation({
    mutationFn: ({ id, depositAmount }: { id: number; depositAmount: number }) =>
      updateDepositTrackerDates(id, { depositAmount }),
    onSuccess: () => {
      setActionError(null);
      setEditingAmountId(null);
      invalidate();
    },
    onError: (error: Error) => {
      setActionError(error.message);
    },
  });

  const startInlineAmountEdit = (row: DepositTrackerRow) => {
    if (row.status !== 'CHUA_HOAN_CUOC') return;
    setEditingAmountId(row.id);
    const current = Number(row.depositAmount);
    setEditingAmountVal(current > 0 ? current : '');
  };

  const commitInlineAmountEdit = (row: DepositTrackerRow) => {
    if (editingAmountVal === '' || Number(editingAmountVal) <= 0) {
      setActionError('Số tiền cược phải là số nguyên dương.');
      return;
    }
    const parsed = parseDepositAmount(String(editingAmountVal));
    if (parsed === Number(row.depositAmount)) {
      setEditingAmountId(null);
      return;
    }
    inlineAmountMutation.mutate({ id: row.id, depositAmount: parsed });
  };

  const refundMutation = useMutation({
    mutationFn: ({ row, recoveredAmount, refundReceivedDate }: { row: DepositTrackerRow; recoveredAmount: number; refundReceivedDate: string }) =>
      markDepositRefunded(row.id, { expectedDepositAmount: Number(row.depositAmount), recoveredAmount, refundReceivedDate }),
    onSuccess: () => {
      setActionError(null);
      setRefundModal(null);
      invalidate();
    },
    onError: async (error: Error) => {
      setRefundModal(null);
      setActionError(error.message);
      if (error instanceof ApiError && error.status === 409) {
        await queryClient.invalidateQueries({ queryKey: qk.depositTracker.all });
      }
    },
  });

  const handleRefundTick = (row: DepositTrackerRow) => {
    if (refundMutation.isPending) return;
    setRefundModal(row);
  };

  // A failed load is neither an empty result nor a populated table: it renders
  // only the error line + retry above (never the empty face — that would claim
  // a successful empty read).
  const isEmptyResult = !query.isPending && !query.isError && rows.length === 0;
  const hasRows = !query.isPending && !query.isError && rows.length > 0;

  return (
    <div className="deposit-tracker-page">
      <PageHeader title="Theo dõi hoàn cược" description="Theo dõi số tiền cược và ngày nộp công văn theo từng lô. Tiền hoàn cược được ghi nhận vào quỹ công ty đã cấu hình." />
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
              <Btn variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setCreateModal(true)}>Thêm cược</Btn>
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
            count={(status ? 1 : 0) + (category ? 1 : 0)}
            ariaLabel="Bộ lọc"
            dialogLabel="Bộ lọc hoàn cược"
            onReset={() => { setStatus(''); setCategory(''); }}
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
            {/* SIL-764 — lọc theo phân loại trên cùng bảng hoàn cược. */}
            <UuiSelectField
              label="Phân loại"
              ariaLabel="Phân loại hoàn cược"
              value={category}
              onChange={(event) => setCategory(event.target.value as DepositCategory | '')}
              options={[
                { value: '', label: 'Tất cả' },
                { value: 'CUOC_CONTAINER', label: DEPOSIT_CATEGORY_LABELS.CUOC_CONTAINER },
                { value: 'TAM_THU_SUA_CHUA', label: DEPOSIT_CATEGORY_LABELS.TAM_THU_SUA_CHUA },
              ]}
            />
          </FilterDropdown>
        </FilterBar>
      </section>

      {(showCvAlert || unrefundedTotal > 0) && (
        <section className="deposit-tracker-warnings" role="alert">
          {showCvAlert && (
            <p className="deposit-tracker-warnings__item deposit-tracker-warnings__item--danger">
              Cảnh báo quá hạn nộp công văn hoàn cược: <strong>{formatOverdueCount(cvOverdueCount)} lô hàng</strong>
            </p>
          )}
          {unrefundedTotal > 0 && (
            <p className="deposit-tracker-warnings__item">
              Chưa hoàn cược số tiền: <strong>{`${formatMoney(unrefundedTotal)} ₫`}</strong> — Vui lòng kiểm tra lại!
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
        <div className="record-table-wrap record-table-wrap--scroll">
          <table className="record-table ops-table">
            <thead>
              <tr>
                <th>STT</th><th>Ngày</th><th>Phân loại</th><th>Khách hàng</th><th>Hãng tàu</th><th>Bill</th>
                <th className="num">Số tiền cược</th><th>Ngày nộp CV</th><th>Ngày dự kiến hoàn cược</th>
                <th>Trạng thái</th><th>Ghi chú</th><th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <td data-label="STT" className="deposit-col--token">{index + 1}</td>
                  {/* SIL-878 — Ngày = Ngày cược (intake pre-stamps it); legacy
                      rows without the field keep the creation-day fallback.
                      KB §10.8.4 (24/11): DD/MM/YYYY — the shared formatter. */}
                  <td data-label="Ngày" className="deposit-col--token">{formatISODate(row.depositDate ?? row.createdAt)}</td>
                  <td data-label="Phân loại">{DEPOSIT_CATEGORY_LABELS[row.category]}</td>
                  <td data-label="Khách hàng" className="record-table__text">{row.customerName}</td>
                  <td data-label="Hãng tàu">{row.carrierName?.trim() || '—'}</td>
                  <td data-label="Bill"><span className="record-table__reference">{row.billNumber}</span></td>
                  <td data-label="Số tiền cược" className="num deposit-col--token">
                    {row.status === 'CHUA_HOAN_CUOC' ? (
                      editingAmountId === row.id ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <NumberField
                            aria-label={`Sửa số tiền cược Bill ${row.billNumber}`}
                            controlSize="sm"
                            grouped
                            value={editingAmountVal}
                            onChange={setEditingAmountVal}
                            min={1}
                            step={1}
                          />
                          <Btn
                            variant="primary"
                            size="sm"
                            disabled={inlineAmountMutation.isPending}
                            onClick={() => commitInlineAmountEdit(row)}
                          >
                            Lưu
                          </Btn>
                          <Btn
                            variant="ghost"
                            size="sm"
                            disabled={inlineAmountMutation.isPending}
                            onClick={() => setEditingAmountId(null)}
                          >
                            Hủy
                          </Btn>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            title="Bấm để sửa nhanh số tiền cược"
                            aria-label={`Sửa số tiền cược Bill ${row.billNumber}`}
                            onClick={() => startInlineAmountEdit(row)}
                          >
                            <Money value={Number(row.depositAmount)} />
                          </button>
                          {/* SIL-1061 — dòng hoàn từng phần: đã hoàn/còn lại. */}
                          {depositRecovered(row) > 0 && (
                            <div className="deposit-col--recovery">
                              Đã hoàn {formatMoney(depositRecovered(row))} · Còn lại {formatMoney(depositRemaining(row))} ₫
                            </div>
                          )}
                        </>
                      )
                    ) : (
                      <Money value={Number(row.depositAmount)} />
                    )}
                  </td>
                  <td data-label="Ngày nộp CV" className="deposit-col--token">{row.cvSubmittedDate ? formatISODate(row.cvSubmittedDate) : '—'}</td>
                  <td data-label="Ngày dự kiến hoàn cược" className="deposit-col--token">{row.expectedRefundDate ? formatISODate(row.expectedRefundDate) : '—'}</td>
                  <td data-label="Trạng thái">
                    <StatusText variant={row.status === 'DA_HOAN_CUOC' ? 'success' : 'warning'}>
                      {STATUS_LABELS[row.status]}
                    </StatusText>
                  </td>
                  <td data-label="Ghi chú" className="record-table__text">{row.note ?? '—'}</td>
                  <td data-label="Thao tác" className="record-table__action">
                    {row.status === 'CHUA_HOAN_CUOC' && (
                      <>
                        <Btn variant="secondary" size="sm" icon={<CalendarClock size={14} />} onClick={() => setDateModal(row)}>
                          Ngày CV / số tiền
                        </Btn>
                        <Btn
                          variant="primary"
                          size="sm"
                          disabled={Number(row.depositAmount) <= 0 || refundMutation.isPending}
                          onClick={() => handleRefundTick(row)}
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

      {/* SIL-1061 — nhập số tiền đã hoàn (prefill phần còn lại, lần tích đầu
          là trọn số cược) + ngày nhận thực tế trước khi đóng bút toán quỹ. */}
      <Modal isOpen={refundModal !== null} title={`Ghi nhận hoàn cược - Bill ${refundModal?.billNumber ?? ''}`} onClose={() => setRefundModal(null)}>
        {refundModal && (
          <RefundForm
            row={refundModal}
            pending={refundMutation.isPending}
            onConfirm={(recoveredAmount, refundReceivedDate) => refundMutation.mutate({ row: refundModal, recoveredAmount, refundReceivedDate })}
            onCancel={() => setRefundModal(null)}
          />
        )}
      </Modal>

      <Modal isOpen={createModal} title="Thêm cược" onClose={() => setCreateModal(false)}>
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

/** SIL-1061 — SỐ TIỀN ĐÃ HOÀN (prefill phần còn lại — lần tích đầu là trọn
 *  số cược) + NGÀY NHẬN THỰC TẾ, cả hai bắt buộc trước khi đóng bút toán quỹ. */
function RefundForm({ row, pending, onConfirm, onCancel }: {
  row: DepositTrackerRow;
  pending: boolean;
  onConfirm: (recoveredAmount: number, refundReceivedDate: string) => void;
  onCancel: () => void;
}) {
  const remaining = depositRemaining(row);
  const [amount, setAmount] = useState<number | ''>(remaining > 0 ? remaining : '');
  const [receivedDate, setReceivedDate] = useState(vnTodayIso());
  const [formError, setFormError] = useState<string | null>(null);
  const submit = () => {
    if (amount === '' || Number(amount) <= 0) {
      setFormError('Số tiền đã hoàn phải là số nguyên dương.');
      return;
    }
    if (Number(amount) > remaining) {
      setFormError(`Số tiền đã hoàn không được vượt số tiền cược còn lại (${formatMoney(remaining)} ₫).`);
      return;
    }
    if (!receivedDate) {
      setFormError('Số tiền đã hoàn lớn hơn 0 bắt buộc có Ngày nhận thực tế.');
      return;
    }
    setFormError(null);
    onConfirm(Number(amount), receivedDate);
  };
  return (
    <form className="deposit-tracker-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <NumberField label="Số tiền đã hoàn (₫)" grouped value={amount} onChange={setAmount} />
      <BufferedUuiDateInput label="Ngày nhận thực tế" value={receivedDate} onChange={setReceivedDate} />
      <p className="deposit-tracker-form__hint">
        Còn lại phải hoàn: {formatMoney(remaining)} ₫ của tổng {formatMoney(Number(row.depositAmount))} ₫. Tiền hoàn cược
        ghi vào quỹ công ty đã cấu hình — không phải doanh thu vận tải.
      </p>
      {formError && <p role="alert">{formError}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel}>Hủy</Btn>
        <Btn type="submit" variant="primary" size="sm" disabled={pending}>Xác nhận đã hoàn cược</Btn>
      </div>
    </form>
  );
}

function DateEditForm({ row, onSaved }: {
  row: DepositTrackerRow;
  onSaved: () => void;
}) {
  const [cvDate, setCvDate] = useState(row.cvSubmittedDate ?? '');
  // SIL-878 — Ngày cược edits here; the table cell falls back to createdAt
  // only for legacy rows that never carried the field.
  const [depositDate, setDepositDate] = useState(row.depositDate ?? '');
  const [expected, setExpected] = useState(row.expectedRefundDate ?? nextExpectedRefundDefault(row.cvSubmittedDate) ?? '');
  // SIL-1125 — the stored expected date may be stale (an old CV+24 formula).
  // The field rides the PATCH only when the user typed in it; untouched, it
  // is omitted and the backend recomputes cvSubmittedDate + 14. See the
  // payload below.
  const expectedTouchedRef = useRef(false);
  const [amount, setAmount] = useState<number | ''>(Number(row.depositAmount) > 0 ? Number(row.depositAmount) : '');
  // SIL-1061 — số đã hoàn + ngày nhận thực tế edit with the same dialog.
  const [recovered, setRecovered] = useState<number | ''>(depositRecovered(row) > 0 ? depositRecovered(row) : '');
  const [receivedDate, setReceivedDate] = useState(row.refundReceivedDate ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [note, setNote] = useState(row.note ?? '');
  // SIL-764 — Phân loại edits with the rest of the row.
  const [category, setCategory] = useState<DepositCategory>(row.category);
  const refundMutation = useMutation({
    mutationFn: () => updateDepositTrackerDates(row.id, {
      depositDate: depositDate || null,
      cvSubmittedDate: cvDate || null,
      // SIL-1125 — untouched (including after a CV-date change auto-tracks
      // the display) the stale prefill is never re-sent; the backend's
      // resolveExpectedRefundDate recomputes cvSubmittedDate + 14.
      ...(expectedTouchedRef.current ? { expectedRefundDate: expected || null } : {}),
      ...(amount !== '' ? { depositAmount: parseDepositAmount(String(amount)) } : {}),
      recoveredAmount: recovered === '' ? 0 : parseDepositAmount(String(recovered)),
      refundReceivedDate: receivedDate || null,
      note: note.trim() || null,
      category,
    }),
    onSuccess: () => {
      onSaved();
    },
  });
  const submitEdit = () => {
    if (recovered !== '' && Number(recovered) > 0 && !receivedDate) {
      setFormError('Số tiền đã hoàn lớn hơn 0 bắt buộc có Ngày nhận thực tế.');
      return;
    }
    setFormError(null);
    refundMutation.mutate();
  };
  return (
    <form className="deposit-tracker-form" onSubmit={(event) => { event.preventDefault(); submitEdit(); }}>
      <UuiSelectField
        label="Phân loại"
        value={category}
        onChange={(event) => setCategory(event.target.value as DepositCategory)}
        options={[
          { value: 'CUOC_CONTAINER', label: DEPOSIT_CATEGORY_LABELS.CUOC_CONTAINER },
          { value: 'TAM_THU_SUA_CHUA', label: DEPOSIT_CATEGORY_LABELS.TAM_THU_SUA_CHUA },
        ]}
      />
      <NumberField label="Số tiền cược (₫)" grouped value={amount} onChange={setAmount} />
      {/* SIL-1061 — số đã hoàn + ngày nhận thực tế. */}
      <NumberField label="Số tiền đã hoàn (₫)" grouped value={recovered} onChange={setRecovered} />
      <BufferedUuiDateInput label="Ngày nhận thực tế" value={receivedDate} onChange={setReceivedDate} />
      <BufferedUuiDateInput label="Ngày cược" value={depositDate} onChange={setDepositDate} />
      <BufferedUuiDateInput label="Ngày nộp CV" value={cvDate} onChange={(value) => {
        if (!expected || expected === nextExpectedRefundDefault(cvDate)) setExpected(nextExpectedRefundDefault(value) ?? '');
        setCvDate(value);
      }} />
      <BufferedUuiDateInput label="Ngày dự kiến hoàn cược" value={expected} onChange={(value) => {
        expectedTouchedRef.current = true;
        setExpected(value);
      }} />
      <p className="deposit-tracker-form__hint">Bỏ trống ngày dự kiến để hệ thống tự điền ngày nộp CV + 14 ngày.</p>
      <FormGroup label="Ghi chú"><input className="input" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></FormGroup>
      {(formError || refundMutation.isError) && <p role="alert">{formError ?? refundMutation.error?.message}</p>}
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
  const [depositDate, setDepositDate] = useState('');
  const [cvDate, setCvDate] = useState('');
  const [expected, setExpected] = useState('');
  // SIL-1125 — same dirty law as the edit dialog: an untouched expected
  // field is omitted from the create payload so the backend derives CV + 14.
  const expectedTouchedRef = useRef(false);
  const [status, setStatus] = useState<DepositStatus>('CHUA_HOAN_CUOC');
  // SIL-764 — Phân loại; default is the existing-row law (Cược container).
  const [category, setCategory] = useState<DepositCategory>('CUOC_CONTAINER');
  const [note, setNote] = useState('');
  // Bill typeahead: only the LAST FOUR DIGITS are searched (the customer's
  // lookup habit from the paper Bill). Digits only, and never below four.
  const [billLookup, setBillLookup] = useState('');
  const [shipmentId, setShipmentId] = useState<number | null>(null);
  const suggestionQuery = useQuery({
    queryKey: qk.depositTracker.billSuggestions(billLookup),
    queryFn: () => searchBillSuggestions(billLookup),
    enabled: /^\d{4}$/.test(billLookup),
  });
  const createMutation = useMutation({
    mutationFn: () => createDepositTracker({
      shipmentId, billNumber, customerName, carrierName,
      depositAmount: parseDepositAmount(amount === '' ? '' : String(amount)),
      cvSubmittedDate: cvDate || null,
      ...(expectedTouchedRef.current ? { expectedRefundDate: expected || null } : {}),
      note: note || null,
      depositDate: depositDate || null,
      status,
      category,
    }),
    onSuccess: () => {
      onSaved();
    },
  });
  return (
    <form className="deposit-tracker-form" onSubmit={(event) => { event.preventDefault(); createMutation.mutate(); }}>
      <FormGroup label="Tra cứu Bill (4 số cuối)" helpText="Gõ 4 số cuối của Số Bill hoặc Số Booking để chọn nhanh lô hàng.">
        <input
          className="input"
          value={billLookup}
          inputMode="numeric"
          maxLength={4}
          placeholder="4 số cuối"
          onChange={(event) => setBillLookup(event.target.value.replace(/\D/g, '').slice(0, 4))}
        />
      </FormGroup>
      <ul id="bill-suggestions" className="bill-suggestions" aria-label="Lô hàng khớp 4 số cuối">
        {(suggestionQuery.data ?? []).map(suggestion => (
          <li key={suggestion.shipmentId}>
            <button
              type="button"
              className="bill-suggestions__item"
              onClick={() => {
                setBillNumber(suggestion.billNumber ?? suggestion.bookingRef ?? '');
                setCustomerName(suggestion.customerName);
                setCarrierName(suggestion.carrierName ?? '');
                setShipmentId(suggestion.shipmentId);
                setBillLookup('');
              }}
            >
              <span>{suggestion.billDisplay}</span>
              <span>{suggestion.carrierName || '—'}</span>
              <span>{suggestion.customerName || '—'}</span>
              {suggestion.existingTrackerCount > 0 && <span>Đã cược {suggestion.existingTrackerCount} lần</span>}
            </button>
          </li>
        ))}
        {billLookup.length === 4 && suggestionQuery.isError && (
          <li className="bill-suggestions__error" role="alert">
            Không tra cứu được lô hàng ({suggestionQuery.error instanceof Error ? suggestionQuery.error.message : 'lỗi không rõ'}). Nhập tay bên dưới.
          </li>
        )}
        {billLookup.length === 4 && !suggestionQuery.isError && !suggestionQuery.isPending && (suggestionQuery.data ?? []).length === 0 && (
          <li className="bill-suggestions__no-match">Không có lô hàng nào khớp {billLookup} trong Số Bill/Số Booking. Nhập tay bên dưới.</li>
        )}
      </ul>
      <FormGroup label="Số Bill"><input className="input" value={billNumber} onChange={(event) => { setBillNumber(event.target.value); setShipmentId(null); }} required maxLength={80} /></FormGroup>
      <FormGroup label="Khách hàng"><input className="input" value={customerName} onChange={(event) => { setCustomerName(event.target.value); setShipmentId(null); }} required /></FormGroup>
      <FormGroup label="Hãng tàu"><input className="input" value={carrierName} onChange={(event) => { setCarrierName(event.target.value); setShipmentId(null); }} required /></FormGroup>
      <NumberField label="Số tiền cược (₫)" grouped value={amount} onChange={setAmount} />
      <BufferedUuiDateInput label="Ngày cược" value={depositDate} onChange={setDepositDate} />
      <BufferedUuiDateInput label="Ngày nộp CV (tùy chọn)" value={cvDate} onChange={(value) => {
        if (!expected || expected === nextExpectedRefundDefault(cvDate)) setExpected(nextExpectedRefundDefault(value) ?? '');
        setCvDate(value);
      }} />
      <BufferedUuiDateInput label="Ngày dự kiến hoàn cược" value={expected} onChange={(value) => {
        expectedTouchedRef.current = true;
        setExpected(value);
      }} />
      <p className="deposit-tracker-form__hint">Bỏ trống ngày dự kiến để hệ thống tự điền ngày nộp CV + 14 ngày.</p>
      <UuiSelectField
        label="Trạng thái"
        value={status}
        onChange={(event) => setStatus(event.target.value as DepositStatus)}
        options={[
          { value: 'CHUA_HOAN_CUOC', label: 'Chưa hoàn cược' },
          { value: 'DA_HOAN_CUOC', label: 'Đã hoàn cược' },
        ]}
      />
      {/* SIL-764 — một dòng tạm thu sửa chữa vỏ container vẫn nằm chung bảng,
          lọc được theo Phân loại. */}
      <UuiSelectField
        label="Phân loại"
        value={category}
        onChange={(event) => setCategory(event.target.value as DepositCategory)}
        options={[
          { value: 'CUOC_CONTAINER', label: DEPOSIT_CATEGORY_LABELS.CUOC_CONTAINER },
          { value: 'TAM_THU_SUA_CHUA', label: DEPOSIT_CATEGORY_LABELS.TAM_THU_SUA_CHUA },
        ]}
      />
      <FormGroup label="Ghi chú"><input className="input" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></FormGroup>
      {createMutation.isError && <p role="alert">{createMutation.error.message}</p>}
      <Btn type="submit" variant="primary" size="sm" disabled={createMutation.isPending || !billNumber || !customerName || !carrierName}>Lưu dòng</Btn>
    </form>
  );
}
