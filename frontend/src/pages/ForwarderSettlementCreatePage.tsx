import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Check, ArrowLeft, Info, Search, Wallet, Receipt, FileText, ChevronRight } from 'lucide-react';
import { formatCurrency, formatDate } from '../lib/format';
import { Money } from '../components/shared/Money';
import { EmptyState } from '../design-system';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { groupExpensesByType } from '../lib/expense-breakdown';
import { PageHeader, useConfirm } from '../components/UI';
import { useForwarderEligibleAdvanceRequests, useCreateAdvanceSettlement, useUnlinkedExpenses } from '../hooks/useForwarderQueries';
import { useCatalogs } from '../hooks/useCatalogs';
import { ExpenseEntryStatus, type AdvanceRequestWithRefs } from '@tingting/shared';
import { expenseLabel, isFullyFundedAdvance } from '../features/forwarder/forwarder-settlement-model';
import { ForwarderSettlementSection } from '../features/forwarder/ForwarderSettlementSection';
import './ForwarderSettlementsPage.css';

interface CreatedSettlement {
  id: number;
  code: string;
}

export default function ForwarderSettlementCreatePage() {
  const navigate = useNavigate();
  const { rootRef } = usePageAnimations({ ready: true });
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<number>>(new Set());
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<number>>(new Set());
  const [refundAmount, setRefundAmount] = useState('0');
  const [note, setNote] = useState('');
  const [created, setCreated] = useState<CreatedSettlement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { confirm, dialog } = useConfirm();
  const handleBack = () => navigate('/my-settlements');
  const isDirty = () => !created && (selectedRequestIds.size > 0 || selectedExpenseIds.size > 0 || note.trim() !== '' || refundAmount !== '0');
  useBackShortcut(handleBack, {
    isDirty,
    confirmDiscard: () => confirm('Thoát mà không lưu? Các thay đổi chưa lưu sẽ bị mất.', { variant: 'warning', confirmLabel: 'Thoát' }),
  });

  const requestsQuery = useForwarderEligibleAdvanceRequests();
  const expensesQuery = useUnlinkedExpenses();
  const { data: requestsData } = requestsQuery;
  const { data: unlinkedData } = expensesQuery;
  const sourcesUnavailable = [requestsQuery, expensesQuery].some(query => query.isPending || query.isFetching || query.error || query.data === undefined);
  const { data: catalogs } = useCatalogs();
  const createSettlement = useCreateAdvanceSettlement();

  const allRequests = ((requestsData?.items ?? requestsData ?? []) as AdvanceRequestWithRefs[]);
  const fundedRequests = allRequests.filter(isFullyFundedAdvance);
  const hasStaleAdvanceSelection = !sourcesUnavailable && [...selectedRequestIds]
    .some(id => !fundedRequests.some(request => request.id === id));
  const unlinkedExpenses = useMemo(() => (unlinkedData?.items ?? []) as Array<{
    id: number; tripId: number; expenseType: string; buyAmount: string; approvalStatus?: string; completionStatus?: ExpenseEntryStatus; note: string | null; createdAt: string; tripCode: string | null; departureDate: string | null; truckPlate: string | null; containerNumbers: string | null;
  }>, [unlinkedData]);
  const expenseTypeOptions = useMemo(
    () => catalogs?.forwarderExpenseTypes ?? [],
    [catalogs],
  );

  const totalAdvance = useMemo(() => {
    return fundedRequests
      .filter(r => selectedRequestIds.has(r.id))
      .reduce((sum, r) => sum + Number(r.amount), 0);
  }, [fundedRequests, selectedRequestIds]);

  const totalExpense = useMemo(() => {
    return unlinkedExpenses
      .filter(e => selectedExpenseIds.has(e.id))
      .reduce((sum, e) => sum + Number(e.buyAmount), 0);
  }, [unlinkedExpenses, selectedExpenseIds]);

  const totalRefund = Number(refundAmount) || 0;
  const balance = totalAdvance - totalExpense - totalRefund;

  const expenseBreakdown = useMemo(() => {
    const selected = unlinkedExpenses.filter(e => selectedExpenseIds.has(e.id));
    return groupExpensesByType(selected, expenseTypeOptions);
  }, [unlinkedExpenses, selectedExpenseIds, expenseTypeOptions]);

  const filteredUnlinkedExpenses = useMemo(() => {
    if (!searchQuery.trim()) return unlinkedExpenses;
    const lowerQ = searchQuery.toLowerCase();
    return unlinkedExpenses.filter(e => {
      const matchTrip = e.tripCode?.toLowerCase().includes(lowerQ);
      const matchTruck = e.truckPlate?.toLowerCase().includes(lowerQ);
      const matchContainer = e.containerNumbers?.toLowerCase().includes(lowerQ);
      return matchTrip || matchTruck || matchContainer;
    });
  }, [unlinkedExpenses, searchQuery]);

  // A6 / C3 — group the selectable expenses by container number; expenses with
  // no container are grouped under their trip code. Each section is ordered
  // chronologically by earliest departure. The free-text filter above applies
  // within these groups; submit still sends a flat tripExpenseId set, so the
  // grouping is presentational only.
  const groupedExpenses = useMemo(() => {
    type Exp = typeof filteredUnlinkedExpenses[number];
    const map = new Map<string, { key: string; label: string; expenses: Exp[]; minDeparture: string | null; total: number }>();
    for (const exp of filteredUnlinkedExpenses) {
      const key = exp.containerNumbers?.trim() || exp.tripCode || `trip-${exp.tripId}`;
      const label = exp.containerNumbers?.trim() || exp.tripCode || 'Không rõ chuyến';
      let g = map.get(key);
      if (!g) {
        g = { key, label, expenses: [], minDeparture: exp.departureDate ?? null, total: 0 };
        map.set(key, g);
      }
      g.expenses.push(exp);
      g.total += Number(exp.buyAmount);
      if (exp.departureDate && (!g.minDeparture || exp.departureDate < g.minDeparture)) {
        g.minDeparture = exp.departureDate;
      }
    }
    return [...map.values()].sort((a, b) => {
      if (a.minDeparture && b.minDeparture) return a.minDeparture < b.minDeparture ? -1 : 1;
      if (a.minDeparture) return -1;
      if (b.minDeparture) return 1;
      return 0;
    });
  }, [filteredUnlinkedExpenses]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  function toggleGroup(key: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleRequest(id: number) {
    setSelectedRequestIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpense(id: number) {
    const expense = unlinkedExpenses.find(item => item.id === id);
    if (expense?.completionStatus !== ExpenseEntryStatus.COMPLETED) return;
    setSelectedExpenseIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedRequestIds.size === 0 || hasStaleAdvanceSelection || sourcesUnavailable || createSettlement.isPending) return;
    try {
      const result = await createSettlement.mutateAsync({
        totalExpenseAmount: totalExpense,
        refundAmount: totalRefund,
        note: note || undefined,
        advanceRequestIds: Array.from(selectedRequestIds),
        tripExpenseIds: selectedExpenseIds.size > 0 ? Array.from(selectedExpenseIds) : undefined,
      });
      setCreated(result as CreatedSettlement);
    } catch {
      // Mutation state renders the API error; keep the selections and draft.
    }
  }

  const isFormReady = selectedRequestIds.size > 0 && !hasStaleAdvanceSelection && !sourcesUnavailable;

  // ── Success state ──
  if (created) {
    return (
      <div className="fset-page">
        <button className="btn btn--ghost btn--sm" onClick={handleBack} style={{ marginBottom: 4 }}>
          <ArrowLeft size={14} /> Danh sách phiếu thanh toán
        </button>
        <PageHeader
          title="Tạo phiếu thanh toán"
          iconName="settlement"
          description="Thanh toán tạm ứng"
          onBack={handleBack}
        />

        <div className="fset-create-success fade-up">
          <div className="fset-create-success__icon">
            <Check size={32} />
          </div>
          <h2 className="fset-create-success__title">Phiếu đã tạo thành công!</h2>
          <p className="fset-create-success__code">{created.code}</p>

          <div className="fset-create-success__actions">
            <button className="btn btn--primary" onClick={() => navigate(`/my-settlements/${created.id}`)}>
              <ChevronRight size={14} /> Xem chi tiết
            </button>
            <button className="btn btn--ghost" onClick={handleBack}>
              <ArrowLeft size={14} /> Quay lại danh sách
            </button>
          </div>
        </div>

      </div>
    );
  }

  // ── Form state ──
  return (
    <div ref={rootRef} className="fset-page">
      <button className="btn btn--ghost btn--sm" onClick={handleBack} style={{ marginBottom: 4 }}>
        <ArrowLeft size={14} /> Danh sách phiếu thanh toán
      </button>
      <PageHeader
        title="Tạo phiếu thanh toán"
        iconName="settlement"
        description="Chọn tạm ứng đã nhận đủ tiền và chi phí phát sinh để ghi nhận phiếu quyết toán"
      />

      <form onSubmit={handleSubmit} className="fset-create-form fade-up">
        {/* ── Step 1: Select advance requests ── */}
        <ForwarderSettlementSection step={1} title="Chọn tạm ứng chưa quyết toán" icon={Wallet} query={requestsQuery}>
            {fundedRequests.length === 0 ? (
              <EmptyState
                variant="compact"
                context="forwarder-advance"
                title="Chưa có tạm ứng đã nhận đủ tiền và chưa quyết toán."
                className="fset-empty-inline fset-empty-inline--advance"
              />
            ) : (
              <div className="fset-check-list">
                <label className="fset-check-all">
                  <input
                    type="checkbox"
                    checked={fundedRequests.length > 0 && selectedRequestIds.size === fundedRequests.length}
                    onChange={() => {
                      if (selectedRequestIds.size === fundedRequests.length) {
                        setSelectedRequestIds(new Set());
                      } else {
                        setSelectedRequestIds(new Set(fundedRequests.map(r => r.id)));
                      }
                    }}
                  />
                  <span>Chọn tất cả</span>
                  <span className="fset-check-all__count">{fundedRequests.length}</span>
                </label>
                {fundedRequests.map(r => (
                  <label key={r.id} className={`fset-check-item ${selectedRequestIds.has(r.id) ? 'fset-check-item--selected' : ''}`}>
                    <input type="checkbox" checked={selectedRequestIds.has(r.id)} onChange={() => toggleRequest(r.id)} />
                    <div className="fset-check-item__body">
                      <div className="fset-check-item__row">
                        <span className="fset-check-item__amount">{formatCurrency(Number(r.amount))}</span>
                        <span className="fset-check-item__reason">{r.reason}</span>
                      </div>
                      <span className="fset-check-item__date">{formatDate(r.createdAt)}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
        </ForwarderSettlementSection>

        {/* ── Step 2: Select trip expenses ── */}
        <ForwarderSettlementSection step={2} title="Chọn chi phí phát sinh" icon={Receipt} query={expensesQuery}>
            {unlinkedExpenses.length === 0 ? (
              <EmptyState
                variant="compact"
                context="forwarder-expense"
                title="Không có chi phí nào chưa thanh toán. Các chi phí đã nằm trong phiếu khác sẽ không hiện ở đây."
                className="fset-empty-inline fset-empty-inline--expense"
              />
            ) : (
              <>
                <div className="fset-expense-toolbar">
                  <label className="fset-check-all">
                    <input
                      type="checkbox"
                      checked={filteredUnlinkedExpenses.length > 0 && filteredUnlinkedExpenses.every(e => selectedExpenseIds.has(e.id))}
                      onChange={() => {
                        if (filteredUnlinkedExpenses.every(e => selectedExpenseIds.has(e.id))) {
                          setSelectedExpenseIds(prev => {
                            const next = new Set(prev);
                            filteredUnlinkedExpenses.forEach(e => next.delete(e.id));
                            return next;
                          });
                        } else {
                          setSelectedExpenseIds(prev => {
                            const next = new Set(prev);
                            filteredUnlinkedExpenses.filter(e => e.completionStatus === ExpenseEntryStatus.COMPLETED).forEach(e => next.add(e.id));
                            return next;
                          });
                        }
                      }}
                    />
                    <span>Chọn tất cả</span>
                    <span className="fset-check-all__count">{filteredUnlinkedExpenses.length}</span>
                  </label>
                  <div className="fset-search-bar">
                    <Search size={14} className="fset-search-bar__icon" />
                    <input
                      type="text"
                      className="fset-search-bar__input"
                      placeholder="Tìm mã chuyến, số xe, số cont..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="fset-check-list">
                  {groupedExpenses.map(g => {
                    const eligibleExpenses = g.expenses.filter(e => e.completionStatus === ExpenseEntryStatus.COMPLETED);
                    const groupComplete = eligibleExpenses.length === g.expenses.length;
                    const allSelected = eligibleExpenses.length > 0 && eligibleExpenses.every(e => selectedExpenseIds.has(e.id));
                    const collapsed = collapsedGroups.has(g.key);
                    return (
                      <div key={g.key} className="fset-expense-group">
                        <div className="fset-expense-group__head">
                          <label className="fset-check-all">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              disabled={!groupComplete}
                              onChange={() => {
                                setSelectedExpenseIds(prev => {
                                  const next = new Set(prev);
                                  if (allSelected) eligibleExpenses.forEach(e => next.delete(e.id));
                                  else eligibleExpenses.forEach(e => next.add(e.id));
                                  return next;
                                });
                              }}
                            />
                            <span>{g.label}</span>
                            <span className="fset-check-all__count">{g.expenses.length}</span>
                            {!groupComplete && <span className="fset-incomplete-label">Chưa kê xong</span>}
                          </label>
                          <button
                            type="button"
                            className="fset-expense-group__toggle"
                            onClick={() => toggleGroup(g.key)}
                            aria-label={collapsed ? 'Mở rộng' : 'Thu gọn'}
                          >
                            {g.minDeparture ? formatDate(g.minDeparture) : '—'} · {formatCurrency(g.total)} {collapsed ? '▸' : '▾'}
                          </button>
                        </div>
                        {!collapsed && g.expenses.map(exp => (
                          <label key={exp.id} className={`fset-check-item fset-check-item--expense ${selectedExpenseIds.has(exp.id) ? 'fset-check-item--selected' : ''} ${exp.completionStatus !== ExpenseEntryStatus.COMPLETED ? 'fset-check-item--disabled' : ''}`}>
                            <input type="checkbox" checked={selectedExpenseIds.has(exp.id)} disabled={exp.completionStatus !== ExpenseEntryStatus.COMPLETED} onChange={() => toggleExpense(exp.id)} />
                            <div className="fset-check-item__body">
                              <div className="fset-check-item__row">
                                <span className="fset-check-item__label">
                                  {expenseLabel(exp.expenseType, expenseTypeOptions)}
                                </span>
                                {exp.tripCode && (
                                  <span className="fset-check-item__meta">({exp.tripCode})</span>
                                )}
                                <span className="fset-check-item__price">
                                  {formatCurrency(Number(exp.buyAmount))}
                                </span>
                              </div>
                              <span className="fset-check-item__sub">
                                {exp.departureDate ? formatDate(exp.departureDate) : formatDate(exp.createdAt)}
                                {exp.truckPlate ? ` · ${exp.truckPlate}` : ''}
                                {exp.containerNumbers && (
                                  <span className="fset-cont-badge">{exp.containerNumbers}</span>
                                )}
                                {exp.note && ` · ${exp.note}`}
                                {exp.completionStatus !== ExpenseEntryStatus.COMPLETED && ' · Ops chưa xác nhận kê xong'}
                              </span>
                            </div>
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
        </ForwarderSettlementSection>

        {/* ── Summary receipt ── */}
        <div className="fset-summary">
          <div className="fset-summary__header">
            <FileText size={15} />
            <span>Tổng kết</span>
          </div>
          <div className="fset-summary__grid">
            <div className="fset-summary__row">
              <span className="fset-summary__label">Tổng tạm ứng</span>
              <span className="fset-summary__value"><Money value={totalAdvance} /></span>
            </div>
            <div className="fset-summary__row">
              <span className="fset-summary__label">Tổng chi phí</span>
              <span className="fset-summary__value fset-summary__value--expense"><Money value={totalExpense} sign="−" /></span>
            </div>
            <div className="fset-summary__row">
              <span className="fset-summary__label">Tiền hoàn lại</span>
              <span className="fset-summary__value fset-summary__value--refund"><Money value={totalRefund} sign="−" /></span>
            </div>
            <div className="fset-summary__divider" />
            <div className="fset-summary__row fset-summary__row--total">
              <span>Chênh lệch</span>
              <span className={`fset-summary__total ${balance > 0 ? 'fset-summary__total--positive' : balance < 0 ? 'fset-summary__total--negative' : ''}`}>
                <Money value={Math.abs(balance)} />
              </span>
            </div>
          </div>
          {expenseBreakdown.size > 0 && (
            <div className="fset-summary__breakdown">
              <span className="fset-summary__breakdown-label">Chi tiết theo hạng mục</span>
              <div className="fset-summary__breakdown-chips">
                {[...expenseBreakdown.entries()].map(([label, amount]) => (
                  <span key={label} className="fset-chip">{label}: {formatCurrency(amount)}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="fset-details-card">
          <div className="fset-input-group">
            <label className="fset-input-label">Tiền hoàn lại</label>
            <input
              type="number"
              className="fset-input"
              value={refundAmount}
              onChange={e => setRefundAmount(e.target.value)}
              placeholder="0"
              min={0}
            />
          </div>

          {totalAdvance > 0 && balance !== 0 && (
            <div className="fset-warn-banner">
              <div className="fset-warn-banner__icon">
                <Info size={15} />
              </div>
              <span>Chênh lệch: {formatCurrency(balance)} (tạm ứng − chi phí − hoàn lại)</span>
            </div>
          )}

          <div className="fset-input-group">
            <label className="fset-input-label">Ghi chú</label>
            <textarea
              className="fset-textarea"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Ghi chú (không bắt buộc)"
              rows={3}
            />
          </div>
        </div>

        {hasStaleAdvanceSelection && (
          <div className="fset-error-banner" role="alert">
            Tạm ứng đã chọn không còn đủ điều kiện. Chọn lại tạm ứng trước khi ghi nhận.
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelectedRequestIds(new Set())}>
              Chọn lại tạm ứng
            </button>
          </div>
        )}

        {/* ── Error ── */}
        {createSettlement.error && (
          <div className="fset-error-banner">
            {(createSettlement.error as Error)?.message || 'Có lỗi xảy ra'}
          </div>
        )}

        {/* ── Actions ── */}
        <div className="fset-form-actions">
          <button type="button" className="btn btn--secondary" onClick={handleBack}>
            <ArrowLeft size={14} /> Hủy bỏ
          </button>
          <button
            type="submit"
            className={`btn btn--primary ${!isFormReady || createSettlement.isPending ? 'btn--disabled' : ''}`}
            disabled={!isFormReady || createSettlement.isPending}
          >
            {createSettlement.isPending ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
            Ghi nhận phiếu thanh toán
          </button>
        </div>
      </form>

      {dialog}
    </div>
  );
}
