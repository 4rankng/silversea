import React, { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Check, X, Edit2, MoreVertical } from 'lucide-react';
import { ANCILLARY_EXPENSE_TYPES } from '@tingting/shared';
import type { AncillaryExpenseType } from '@tingting/shared';
import type { TripExpense } from '@tingting/shared';
import { tripClient } from '../../api/tripClient';
import { formatCurrency } from '../../lib/format';
import { useCatalogs } from '../../hooks/useCatalogs';
import { InputWithPrefix } from './InputWithPrefix';
import { StatusPill, useConfirm, Modal } from '../UI';
import { useClickOutside } from '../../hooks/useClickOutside';
import { qk } from '../../api/keys';
import { AncillaryEmptyState, AncillaryMobileTotals, AncillaryTableTotals, EMPTY_FORM, feeTypeLabel, resolveMarkupConfig, suggestedSellFor, type AncillaryFeesCardProps } from './ancillary-fees-card-utils';
import { DateInput } from '../../design-system/forms/DateInput';
import { UuiSelectField } from '../../design-system';

export function AncillaryFeesCard({ tripId, readOnly = false, hideAddButton = false }: AncillaryFeesCardProps) {
  const queryClient = useQueryClient();
  const { data: catalogData } = useCatalogs();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [activeActionId, setActiveActionId] = useState<number | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(actionMenuRef, () => setActiveActionId(null), { escapeKey: true, enabled: activeActionId !== null });

  const { data, isLoading } = useQuery({
    queryKey: qk.tripForm.tripExpenses(tripId),
    queryFn: async () => {
      const res = await tripClient.listTripExpenses(tripId);
      return res.items ?? [];
    },
    enabled: !!tripId,
  });

  const expenses: (TripExpense & { supplierName?: string | null })[] = data ?? [];
  const handleExpenseTypeChange = (newType: string) => {
    const hasMarkup = resolveMarkupConfig(catalogData?.forwarderExpenseTypes, newType);

    setForm(f => {
      const buyNum = Number(f.buyAmount);
      return {
        ...f,
        expenseType: newType as AncillaryExpenseType,
        sellAmount: suggestedSellFor(buyNum, hasMarkup),
      };
    });
  };

  const handleBuyAmountChange = (val: string) => {
    const hasMarkup = resolveMarkupConfig(catalogData?.forwarderExpenseTypes, form.expenseType);

    setForm(f => {
      const buyNum = Number(val);
      const oldBuyNum = Number(f.buyAmount);
      const oldPrefill = suggestedSellFor(oldBuyNum, hasMarkup);
      // Auto-suggest only if sell amount matches the old prefill or is empty
      // — preserves any value the user typed manually.
      const isPrefilledOrEmpty = !f.sellAmount
        || Number(f.sellAmount) === Number(oldPrefill)
        || Number(f.sellAmount) === oldBuyNum;
      const newSell = isPrefilledOrEmpty
        ? suggestedSellFor(buyNum, hasMarkup)
        : f.sellAmount;
      return {
        ...f,
        buyAmount: val,
        sellAmount: newSell,
      };
    });
  };

  const handleEdit = (fee: TripExpense) => {
    setForm({
      expenseType: fee.expenseType as AncillaryExpenseType,
      buyAmount: fee.buyAmount ? String(fee.buyAmount) : '',
      sellAmount: fee.sellAmount ? String(fee.sellAmount) : '',
      settlementMethod: fee.settlementMethod as 'COMPANY_DIRECT' | 'OPS_ADVANCE',
      supplierId: fee.supplierId ? String(fee.supplierId) : '',
      forwarderId: fee.forwarderId ? String(fee.forwarderId) : '',
      containerNumber: fee.containerNumber || '',
      invoiceNumber: fee.invoiceNumber || '',
      invoiceDate: fee.invoiceDate || '',
      declarationNumber: fee.declarationNumber || '',
      note: fee.note || '',
    });
    setEditingId(fee.id);
    setFormError('');
    setShowForm(true);
  };

  const handleAdd = async () => {
    setFormError('');
    if (!form.buyAmount || Number(form.buyAmount) <= 0) {
      setFormError('Vui lòng nhập số tiền gốc hợp lệ.');
      return;
    }
    if (form.expenseType === 'CUSTOMS' && !form.declarationNumber.trim()) {
      setFormError('Số tờ khai là bắt buộc cho phí hải quan.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        expenseType: form.expenseType,
        buyAmount: Number(form.buyAmount),
        sellAmount: form.sellAmount ? Number(form.sellAmount) : 0,
        settlementMethod: form.settlementMethod,
        supplierId: form.supplierId ? Number(form.supplierId) : undefined,
        forwarderId: form.forwarderId ? Number(form.forwarderId) : undefined,
        containerNumber: form.containerNumber.trim() || undefined,
        invoiceNumber: form.invoiceNumber.trim() || undefined,
        invoiceDate: form.invoiceDate || undefined,
        declarationNumber: form.declarationNumber.trim() || undefined,
        note: form.note.trim() || undefined,
      };

      if (editingId) {
        await tripClient.updateTripExpense(tripId, editingId, payload);
      } else {
        await tripClient.createTripExpense(tripId, payload);
      }
      
      await queryClient.invalidateQueries({ queryKey: qk.tripForm.tripExpenses(tripId) });
      setForm(EMPTY_FORM);
      setEditingId(null);
      setShowForm(false);
    } catch (e: unknown) {
      setFormError((e as Error).message || 'Lỗi khi lưu phí.');
    } finally {
      setSubmitting(false);
    }
  };

  // Wraps an approve/reject call with a confirm dialog. Returns true if the
  // user confirmed AND the action succeeded; false otherwise. Single entry
  // point so the message format stays consistent.
  const confirmAndRun = async (fee: TripExpense, action: 'approve' | 'reject') => {
    const label = feeTypeLabel(fee.expenseType);
    const amount = formatCurrency(Number(fee.buyAmount));
    const message = action === 'approve'
      ? `Duyệt khoản phí "${label}" (${amount})?`
      : `Từ chối khoản phí "${label}" (${amount})?`;
    const options = action === 'reject'
      ? { variant: 'danger' as const, confirmLabel: 'Từ chối' }
      : { confirmLabel: 'Duyệt' };
    const ok = await confirm(message, options);
    if (!ok) return false;
    setPendingId(fee.id);
    try {
      if (action === 'approve') {
        await tripClient.approveTripExpense(tripId, fee.id);
      } else {
        await tripClient.rejectTripExpense(tripId, fee.id);
      }
      await queryClient.invalidateQueries({ queryKey: qk.tripForm.tripExpenses(tripId) });
      await queryClient.invalidateQueries({ queryKey: qk.trips.tripDetail(tripId) });
      return true;
    } catch {
      // silently ignore — toast wiring lives outside this card
      return false;
    } finally {
      setPendingId(null);
    }
  };

  const totalBuy = expenses.reduce((s, e) => s + Number(e.buyAmount), 0);
  const totalSell = expenses.reduce((s, e) => s + Number(e.sellAmount), 0);
  const hasMarkup = resolveMarkupConfig(catalogData?.forwarderExpenseTypes, form.expenseType);

  return (
    <div>
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--fg-3)', fontSize: 13 }}>
          <Loader2 size={14} className="spin" /> Đang tải dịch vụ…
        </div>
      ) : (
        <>
          {expenses.length > 0 ? (
            <>
              {/* ── Desktop / Tablet: classic table ────────────────────────── */}
              <div className="table-scroll ancillary-fees__scroll ancillary-fees__desktop" style={{ marginBottom: 12 }}>
                <table className="ancillary-fees__table">
                  <thead>
                    <tr>
                      <th>Loại phí</th>
                      <th className="num" style={{ color: 'var(--ink-3)' }}>Gốc</th>
                      <th className="num" style={{ color: 'var(--ink-3)' }}>Báo khách</th>
                      <th className="num" style={{ fontWeight: 700, color: 'var(--ink)' }}>Báo nợ</th>
                      <th>Chứng từ</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((fee, i) => {
                      const buy = Number(fee.buyAmount);
                      const sell = Number(fee.sellAmount);
                      // Forwarder-owned fees are accepted with the settlement,
                      // never as a separate per-line approval on this card.
                      const canDecide = false;
                      const isBusy = pendingId === fee.id;
                      return (
                        <tr key={fee.id ?? i}>
                          <td>
                            <div style={{ lineHeight: 1.35 }}>
                              <div>{feeTypeLabel(fee.expenseType)}</div>
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
                                {fee.containerNumber && (
                                  <span style={{ fontSize: 'var(--fs-xs)', lineHeight: 1.35, color: 'var(--ink-3)' }} className="mono">
                                    {fee.containerNumber}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="num" style={{ color: 'var(--ink-2)' }}>
                            {buy > 0 ? formatCurrency(buy) : ''}
                          </td>
                          <td className="num" style={{ color: 'var(--ink-2)' }}>
                            {sell > 0 ? formatCurrency(sell) : ''}
                          </td>
                          <td
                            className="num"
                            style={{
                              color: sell > 0 ? 'var(--success)' : 'var(--ink-3)',
                              fontWeight: 700,
                            }}
                          >
                            {sell > 0 ? formatCurrency(sell) : ''}
                          </td>
                          <td
                            style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}
                            title={[fee.invoiceNumber && `HĐ ${fee.invoiceNumber}`, fee.invoiceDate && `Ngày ${fee.invoiceDate}`, fee.declarationNumber && `TK ${fee.declarationNumber}`].filter(Boolean).join(' · ') || undefined}
                          >
                            {fee.invoiceNumber || fee.declarationNumber ? (
                              <>
                                <span style={{ color: 'var(--ink)' }}>{fee.invoiceNumber ?? fee.declarationNumber}</span>
                                {fee.invoiceDate && <span style={{ marginLeft: 4, fontSize: 'var(--fs-xs)', lineHeight: 1.35 }}>· {fee.invoiceDate.slice(5)}</span>}
                              </>
                            ) : ''}
                          </td>
                          <td>
                            <div className="fee-decision-cell">
                              {fee.approvalStatus === 'APPROVED' ? (
                                <span title="Đã duyệt"><StatusPill variant="success">Duyệt</StatusPill></span>
                              ) : fee.approvalStatus === 'REJECTED' ? (
                                <span title="Từ chối"><StatusPill variant="danger">Từ chối</StatusPill></span>
                              ) : (
                                <span title="Chờ hoàn ứng"><StatusPill variant="neutral">Chờ hoàn ứng</StatusPill></span>
                              )}
                              {canDecide && !readOnly && (
                                <div
                                  className="fee-action-container"
                                  ref={activeActionId === fee.id ? actionMenuRef : null}
                                  style={{ marginLeft: 6 }}
                                >
                                  <button
                                    type="button"
                                    className={`fee-action-trigger ${activeActionId === fee.id ? 'is-active' : ''}`}
                                    onClick={() => setActiveActionId(activeActionId === fee.id ? null : fee.id)}
                                    title="Thao tác"
                                    aria-label={activeActionId === fee.id ? 'Đóng menu thao tác' : 'Thao tác'}
                                    aria-haspopup="menu"
                                    aria-expanded={activeActionId === fee.id}
                                    disabled={isBusy}
                                  >
                                    <MoreVertical size={14} />
                                  </button>
                                  {activeActionId === fee.id && (
                                    <div
                                      className="fee-action-dropdown"
                                      role="menu"
                                      style={i >= expenses.length - 2 && expenses.length > 2
                                        ? { top: 'auto', bottom: '100%', marginTop: 0, marginBottom: 4 }
                                        : undefined
                                      }
                                    >
                                      <button
                                        type="button"
                                        className="fee-action-dropdown__item"
                                        role="menuitem"
                                        onClick={() => {
                                          setActiveActionId(null);
                                          confirmAndRun(fee, 'approve');
                                        }}
                                      >
                                        <Check size={13} strokeWidth={2.6} style={{ color: 'var(--accent)' }} />
                                        Duyệt
                                      </button>
                                      <button
                                        type="button"
                                        className="fee-action-dropdown__item"
                                        role="menuitem"
                                        onClick={() => {
                                          setActiveActionId(null);
                                          handleEdit(fee);
                                        }}
                                      >
                                        <Edit2 size={13} style={{ color: 'var(--ink-2)' }} />
                                        Sửa
                                      </button>
                                      <button
                                        type="button"
                                        className="fee-action-dropdown__item"
                                        role="menuitem"
                                        onClick={() => {
                                          setActiveActionId(null);
                                          confirmAndRun(fee, 'reject');
                                        }}
                                      >
                                        <X size={13} strokeWidth={2.6} style={{ color: 'var(--danger)' }} />
                                        Từ chối
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!readOnly && !hideAddButton && !showForm && (
                      <tr
                        className="ancillary-fees__add-row"
                        onClick={() => { setForm(EMPTY_FORM); setFormError(''); setEditingId(null); setShowForm(true); }}
                      >
                        <td colSpan={6}>
                          <Plus size={13} /> Thêm phí
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <AncillaryTableTotals buy={totalBuy} sell={totalSell} />
                </table>
              </div>

              {/* ── Mobile: card-based layout ──────────────────────────────── */}
              <div className="ancillary-fees__mobile" style={{ marginBottom: 12 }}>
                <div className="ancillary-fees__cards">
                  {expenses.map((fee, i) => {
                    const buy = Number(fee.buyAmount);
                    const sell = Number(fee.sellAmount);
                    const canDecide = false;
                    const isBusy = pendingId === fee.id;
                    return (
                      <div className="ancillary-fee-card" key={fee.id ?? i}>
                        <div className="ancillary-fee-card__head">
                          <div className="ancillary-fee-card__name">
                            <span>{feeTypeLabel(fee.expenseType)}</span>
                          </div>
                          <div className="ancillary-fee-card__status">
                            {fee.approvalStatus === 'APPROVED' ? (
                              <StatusPill variant="success">Duyệt</StatusPill>
                            ) : fee.approvalStatus === 'REJECTED' ? (
                              <StatusPill variant="danger">Từ chối</StatusPill>
                            ) : (
                              <StatusPill variant="neutral">Chờ hoàn ứng</StatusPill>
                            )}
                          </div>
                        </div>

                        <div className="ancillary-fee-card__amounts">
                          <div className="ancillary-fee-card__amount">
                            <span className="ancillary-fee-card__label">Gốc</span>
                            <span className="ancillary-fee-card__value mono">{buy > 0 ? formatCurrency(buy) : '—'}</span>
                          </div>
                          <div className="ancillary-fee-card__amount">
                            <span className="ancillary-fee-card__label">Báo khách</span>
                            <span className="ancillary-fee-card__value mono">{sell > 0 ? formatCurrency(sell) : '—'}</span>
                          </div>
                          <div className="ancillary-fee-card__amount">
                            <span className="ancillary-fee-card__label">Báo nợ</span>
                            <span
                              className="ancillary-fee-card__value ancillary-fee-card__value--margin mono"
                              style={{ color: sell > 0 ? 'var(--success)' : 'var(--ink-3)' }}
                            >
                              {sell > 0 ? formatCurrency(sell) : '—'}
                            </span>
                          </div>
                        </div>

                        {(fee.containerNumber || fee.invoiceNumber || fee.declarationNumber) && (
                          <div className="ancillary-fee-card__meta">
                            {fee.containerNumber && <span className="mono">{fee.containerNumber}</span>}
                            {fee.invoiceNumber && <span>HĐ {fee.invoiceNumber}</span>}
                            {fee.declarationNumber && <span>TK {fee.declarationNumber}</span>}
                          </div>
                        )}

                        {canDecide && !readOnly && (
                          <div className="ancillary-fee-card__actions">
                            <button
                              type="button"
                              className="btn btn--sm ancillary-fee-card__btn ancillary-fee-card__btn--approve"
                              onClick={() => confirmAndRun(fee, 'approve')}
                              disabled={isBusy}
                            >
                              {isBusy ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                              Duyệt
                            </button>
                            <button
                              type="button"
                              className="btn btn--sm btn--ghost ancillary-fee-card__btn"
                              onClick={() => handleEdit(fee)}
                              disabled={isBusy}
                            >
                              <Edit2 size={13} />
                              Sửa
                            </button>
                            <button
                              type="button"
                              className="btn btn--sm btn--ghost ancillary-fee-card__btn ancillary-fee-card__btn--reject"
                              onClick={() => confirmAndRun(fee, 'reject')}
                              disabled={isBusy}
                            >
                              {isBusy ? <Loader2 size={13} className="spin" /> : <X size={13} />}
                              Từ chối
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Mobile totals bar */}
                <AncillaryMobileTotals buy={totalBuy} sell={totalSell} />

                {!readOnly && !hideAddButton && (
                  <button
                    type="button"
                    className="ancillary-fees__mobile-add"
                    onClick={() => { setForm(EMPTY_FORM); setFormError(''); setEditingId(null); setShowForm(true); }}
                  >
                    <Plus size={14} /> Thêm phí
                  </button>
                )}
              </div>
            </>
          ) : (
            <AncillaryEmptyState />
          )}

          {!readOnly && (
            <Modal
              isOpen={showForm}
              title={editingId ? 'Sửa dịch vụ đi kèm' : 'Thêm dịch vụ đi kèm'}
              onClose={() => { setShowForm(false); setFormError(''); setEditingId(null); }}
              onConfirm={handleAdd}
              footer={
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={submitting}
                    onClick={() => { setShowForm(false); setFormError(''); setEditingId(null); }}
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={submitting}
                    onClick={handleAdd}
                  >
                    {submitting ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
                    Lưu phí
                  </button>
                </div>
              }
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {formError && (
                  <div style={{ padding: '6px 10px', background: 'var(--danger-soft)', color: 'var(--danger-text)', borderRadius: 6, fontSize: 12 }}>
                    {formError}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <UuiSelectField
                    id="expense-type-select"
                    label="Loại phí *"
                    value={form.expenseType}
                    onChange={(e) => handleExpenseTypeChange(e.target.value)}
                    options={(catalogData?.forwarderExpenseTypes && catalogData.forwarderExpenseTypes.length > 0
                        ? catalogData.forwarderExpenseTypes
                        : ANCILLARY_EXPENSE_TYPES.map(t => ({ code: t, name: feeTypeLabel(t) }))
                      ).map(t => ({ value: t.code, label: t.name }))}
                  />

                  <div className="field">
                    <label style={{ fontSize: 12 }}>Số tiền gốc *</label>
                    <InputWithPrefix
                      value={form.buyAmount}
                      onChange={handleBuyAmountChange}
                      placeholder="0"
                      prefix="đ"
                      mono
                      type="money"
                    />
                  </div>

                  <div className="field">
                    <label style={{ fontSize: 12 }}>
                      Báo khách {hasMarkup ? '' : '(= số tiền gốc)'}
                    </label>
                    {hasMarkup ? (
                      <InputWithPrefix
                        value={form.sellAmount}
                        onChange={(val) => setForm(f => ({ ...f, sellAmount: val }))}
                        placeholder="0"
                        prefix="đ"
                        mono
                        type="money"
                      />
                    ) : (
                      <div style={{ position: 'relative' }}>
                        <input
                          className="input mono"
                          type="text"
                          value={form.buyAmount ? Number(form.buyAmount).toLocaleString('vi-VN') : '0'}
                          readOnly
                          disabled
                          style={{ background: 'var(--bg-2)', color: 'var(--fg-3)', cursor: 'not-allowed', paddingRight: 32 }}
                        />
                        <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--fg-3)' }}>đ</span>
                      </div>
                    )}
                  </div>

                  <div className="field" style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minHeight: 24 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--success)' }}>
                      Báo nợ: <span className="mono">{formatCurrency(Number(form.sellAmount) || 0)}</span>
                    </div>
                  </div>

                  <div className="field">
                    <label style={{ fontSize: 12 }}>Số hóa đơn</label>
                    <input
                      className="input mono"
                      type="text"
                      placeholder="Ví dụ: HD-001"
                      value={form.invoiceNumber}
                      onChange={(e) => setForm(f => ({ ...f, invoiceNumber: e.target.value }))}
                    />
                  </div>

                  <div className="field">
                    <label style={{ fontSize: 12 }}>Ngày hóa đơn</label>
                    <DateInput
                      className="input mono"
                      value={form.invoiceDate}
                      onChange={(value) => setForm(f => ({ ...f, invoiceDate: value }))}
                    />
                  </div>

                  <div className="field">
                    <label style={{ fontSize: 12 }}>Số công-te-nơ</label>
                    <input
                      className="input mono"
                      type="text"
                      placeholder="Ví dụ: HDMU1234567"
                      value={form.containerNumber}
                      onChange={(e) => setForm(f => ({ ...f, containerNumber: e.target.value.toUpperCase() }))}
                    />
                  </div>

                  {form.expenseType === 'CUSTOMS' && (
                    <div className="field">
                      <label style={{ fontSize: 12 }}>Số tờ khai hải quan *</label>
                      <input
                        className="input mono"
                        type="text"
                        placeholder="Ví dụ: TK-2024-001"
                        value={form.declarationNumber}
                        onChange={(e) => setForm(f => ({ ...f, declarationNumber: e.target.value }))}
                      />
                    </div>
                  )}

                  <div className="field" style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontSize: 12 }}>Ghi chú</label>
                    <input
                      className="input"
                      type="text"
                      placeholder="Ghi chú thêm…"
                      value={form.note}
                      onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </Modal>
          )}
        </>
      )}
      {confirmDialog}
    </div>
  );
}
