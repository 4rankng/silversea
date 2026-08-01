import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Filter, Loader2, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useToast } from '../shared/Toast';
import { AssetIcon } from '../AssetIcon';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { financialClient } from '../../api/financialClient';
import { configClient } from '../../api/configClient';
import { qk } from '../../api/keys';
import { documentFileName, filterAuthoritativeDebitNoteLines, groupLinesByContainer, lineTotal, normalizeLine, selectedTripIdsFromSearch, splitRouteName, thisMonthRange, displayDate, TITLE, type BillingRouteGroup } from './billing-document-builder-utils';
import './BillingDocumentBuilder.css';
import type {
  BillingDocument,
  BillingDraftEligibilitySummary,
  BillingDocumentType,
  BillingDocumentEntityType,
  BillingDocumentLine,
  DebitNoteTemplate,
  SaveBillingDocumentInput,
} from '@tingting/shared';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  type: BillingDocumentType;
  entityType: BillingDocumentEntityType;
  entityId: number;
  entityName: string;
  initialDoc?: BillingDocument | null;
  onSaved?: () => void;
  selectedTripIds?: number[];
  initialRangeFrom?: string;
  initialRangeTo?: string;
}

export default function BillingDocumentBuilder({
  isOpen,
  onClose,
  type,
  entityType,
  entityId,
  entityName,
  initialDoc,
  onSaved,
  selectedTripIds,
  initialRangeFrom,
  initialRangeTo,
}: Props) {
  const { toast: showToast } = useToast();
  const isEdit = !!initialDoc;
  const autoGenerateRef = useRef(false);
  const month = useMemo(() => thisMonthRange(), []);
  const requestedSelection = useMemo(() => {
    const urlIds = selectedTripIdsFromSearch(window.location.search);
    return [...new Set(selectedTripIds?.length ? selectedTripIds : urlIds)];
  }, [selectedTripIds]);
  const requestedFrom = initialRangeFrom ?? new URLSearchParams(window.location.search).get('from') ?? month.from;
  const requestedTo = initialRangeTo ?? new URLSearchParams(window.location.search).get('to') ?? month.to;
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  const [rangeFrom, setRangeFrom] = useState(initialDoc?.rangeFrom ?? requestedFrom);
  const [rangeTo, setRangeTo] = useState(initialDoc?.rangeTo ?? requestedTo);
  const [lines, setLines] = useState<BillingDocumentLine[]>((initialDoc?.lines as BillingDocumentLine[]) ?? []);
  const [note, setNote] = useState(initialDoc?.note ?? '');
  const [savedId, setSavedId] = useState<number | null>(initialDoc?.id ?? null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [eligibilitySummary, setEligibilitySummary] = useState<BillingDraftEligibilitySummary | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  // Selected export template. null = auto (customer/default for debit notes,
  // document-type default for payment statements), resolved + snapshotted server-side.
  const [templateId, setTemplateId] = useState<number | null>(initialDoc?.debitNoteTemplateId ?? null);

  const { data: templates } = useQuery<DebitNoteTemplate[]>({
    queryKey: qk.catalogs.debitNoteTemplatesByType(type),
    queryFn: () => configClient.getDebitNoteTemplates(type),
    staleTime: 60_000,
    enabled: isOpen,
  });

  const groupedLines = useMemo<BillingRouteGroup[]>(() => {
    const groups: BillingRouteGroup[] = [];
    let index = 0;
    while (index < lines.length) {
      const route = lines[index]?.routeName ?? '';
      let end = index + 1;
      while (end < lines.length && (lines[end]?.routeName ?? '') === route) end += 1;
      const groupLines = lines.slice(index, end).map((line, offset) => ({ line, index: index + offset }));
      groups.push({
        key: `${route || 'no-route'}-${index}`,
        routeName: route,
        lines: groupLines,
        subtotal: groupLines.reduce((sum, item) => sum + lineTotal(item.line), 0),
        visibleCount: groupLines.filter((item) => !item.line.excluded).length,
      });
      index = end;
    }
    return groups;
  }, [lines]);

  const vatTotals = useMemo(() => lines.reduce((totals, line) => {
    if (line.excluded) return totals;
    totals.net += Number(line.netAmount ?? line.baseAmount ?? 0);
    totals.tax += Number(line.taxAmount ?? 0);
    totals.gross += Number(line.grossAmount ?? lineTotal(line));
    return totals;
  }, { net: 0, tax: 0, gross: 0 }), [lines]);

  useEffect(() => {
    if (!isOpen) {
      autoGenerateRef.current = false;
      return;
    }

    if (initialDoc) {
      setRangeFrom(initialDoc.rangeFrom);
      setRangeTo(initialDoc.rangeTo);
      setLines(((initialDoc.lines as BillingDocumentLine[]) ?? []).map(normalizeLine));
      setNote(initialDoc.note ?? '');
      setSavedId(initialDoc.id);
      setTemplateId(initialDoc.debitNoteTemplateId ?? null);
      setEligibilitySummary(null);
      setSelectionError(null);
      return;
    }

    setRangeFrom(requestedFrom);
    setRangeTo(requestedTo);
    setLines([]);
    setNote('');
    setSavedId(null);
    setTemplateId(null);
    setEligibilitySummary(null);
    setSelectionError(null);
  }, [isOpen, initialDoc, requestedFrom, requestedTo]);

  const generateDraft = async (from = rangeFrom, to = rangeTo, silent = false) => {
    setLoading(true);
    try {
      const draft = await financialClient.generateBillingDraft({
        type,
        entityType,
        entityId,
        rangeFrom: from,
        rangeTo: to,
      });
      const authoritativeLines = (draft.lines as BillingDocumentLine[]).map(normalizeLine);
      const selection = type === 'DEBIT_NOTE'
        ? filterAuthoritativeDebitNoteLines(authoritativeLines, requestedSelection)
        : { lines: authoritativeLines, missingTripIds: [] };
      const selectedLines = selection.lines;
      const missingIds = selection.missingTripIds;
      const nextSelectionError = missingIds.length > 0
        ? `${missingIds.length} chuyến đã chọn không còn đủ điều kiện. Vui lòng quay lại danh sách vận tải và chọn lại.`
        : null;
      setSelectionError(nextSelectionError);
      setLines(selectedLines);
      setEligibilitySummary(draft.eligibilitySummary ?? null);
      setSavedId(null);
      if (nextSelectionError) {
        showToast({ kind: 'error', message: nextSelectionError });
      } else if (!silent && selectedLines.length === 0) {
        showToast({ kind: 'info', message: 'Không có dòng công nợ trong khoảng ngày đã chọn.' });
      }
    } catch (err) {
      showToast({ kind: 'error', message: (err as Error).message || 'Lỗi lọc dòng' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || isEdit) return;
    if (autoGenerateRef.current) return;
    autoGenerateRef.current = true;
    void generateDraft(requestedFrom, requestedTo, true);
    // Auto-generate only once per open. generateDraft intentionally stays out
    // of deps because it changes with range state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, entityType, isEdit, isOpen, type]);

  const updateLine = (index: number, patch: Partial<BillingDocumentLine>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
    setSavedId(null);
  };

  const addAdhoc = () => {
    setLines((prev) => [
      ...prev,
      {
        sourceType: 'ADHOC',
        sourceId: null,
        lineType: 'ADHOC',
        typeLabel: 'Khác',
        unit: 'lần',
        description: '',
        routeName: null,
        containerNumbers: null,
        baseAmount: 0,
        amountOverride: 0,
        excluded: false,
        sortOrder: prev.length,
      } as BillingDocumentLine,
    ]);
    setSavedId(null);
  };

  const removeLine = (index: number) => {
    setLines((prev) => prev.flatMap((line, i) => {
      if (i !== index) return [line];
      // Preserve source rows as exclusions so saving can reduce the matching
      // receivable. Ad-hoc rows have no pre-existing posting and can disappear.
      return line.sourceType === 'ADHOC' ? [] : [{ ...line, excluded: !line.excluded }];
    }));
    setSavedId(null);
  };

  const buildPayload = (): SaveBillingDocumentInput => {
    const common = {
      entityId,
      entityName,
      rangeFrom,
      rangeTo,
      note: note.trim() || null,
      debitNoteTemplateId: templateId,
    };
    if (type === 'DEBIT_NOTE') {
      if (entityType !== 'CUSTOMER') throw new Error('Giấy báo nợ chỉ áp dụng cho khách hàng.');
      return {
        ...common,
        type: 'DEBIT_NOTE',
        entityType: 'CUSTOMER',
        sourceRefs: lines.map((line) => {
          if (line.sourceType === 'TRIP') {
            if (!line.sourceId || !line.financialPostingId || !line.financialPostingVersion || !line.postingChecksum) {
              throw new Error('Dòng chuyến thiếu nguồn hạch toán. Vui lòng lọc lại dữ liệu.');
            }
            return {
              sourceType: 'TRIP' as const,
              sourceId: line.sourceId,
              financialPostingId: line.financialPostingId,
              financialPostingVersion: line.financialPostingVersion,
              postingChecksum: line.postingChecksum,
            };
          }
          if (line.sourceType !== 'EXPENSE' || !line.sourceId || !line.renderData?.sourceVersion) {
            throw new Error('Giấy báo nợ chỉ nhận nguồn chuyến hoặc chi phí đã được phê duyệt.');
          }
          return {
            sourceType: 'EXPENSE' as const,
            sourceId: line.sourceId,
            sourceVersion: line.renderData.sourceVersion,
          };
        }),
      };
    }
    return {
      ...common,
      type: 'PAYMENT_STATEMENT',
      entityType,
      lines: lines.map((line, index) => ({
      sourceType: line.sourceType,
      sourceId: line.sourceId,
      lineType: line.lineType,
      typeLabel: line.typeLabel || 'Khác',
      unit: line.unit || 'lần',
      description: line.description,
      routeName: line.routeName ?? null,
      containerNumbers: line.containerNumbers ?? null,
      renderData: line.renderData ? { ...line.renderData } : null,
      baseAmount: Number(line.baseAmount),
      amountOverride: line.amountOverride != null ? Number(line.amountOverride) : null,
      excluded: line.excluded ?? false,
      sortOrder: index,
      })),
    };
  };

  const persistDocument = async ({ notify = true }: { notify?: boolean } = {}): Promise<BillingDocument | null> => {
    if (selectionError) {
      showToast({ kind: 'error', message: selectionError });
      return null;
    }
    if (lines.length === 0) {
      showToast({ kind: 'error', message: 'Chưa có dòng nào để lưu. Hãy lọc dòng hoặc thêm dòng trước.' });
      return null;
    }

    setSaving(true);
    try {
      const updateId = isEdit ? (initialDoc?.id ?? null) : savedId;
      const saved = updateId
        ? await financialClient.updateBillingDocument(updateId, buildPayload())
        : await financialClient.saveBillingDocument(buildPayload());
      setSavedId(saved.id);
      if (notify) showToast({ kind: 'success', message: 'Đã lưu tài liệu.' });
      onSaved?.();
      return saved;
    } catch (err) {
      showToast({ kind: 'error', message: (err as Error).message || 'Lỗi lưu tài liệu' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const exportXlsx = async () => {
    if (exporting || saving) return;
    setExporting(true);
    try {
      const saved = await persistDocument({ notify: false });
      if (!saved) return;

      const blob = await api.getBlob(financialClient.getBillingDocumentExportUrl(saved.id, templateId));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = documentFileName(type, entityName);
      a.click();
      URL.revokeObjectURL(url);
      showToast({ kind: 'success', message: 'Đã lưu và xuất Excel.' });
    } catch (err) {
      showToast({ kind: 'error', message: (err as Error).message || 'Lỗi xuất Excel' });
    } finally {
      setExporting(false);
    }
  };

  const busy = loading || saving || exporting;

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, isOpen, onClose]);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  if (!isOpen) return null;

  if (!portalTarget) return null;

  const content = (
    <section className="billing-builder" role="dialog" aria-modal="true" aria-labelledby="billing-builder-title">
      <header className="billing-builder__topbar">
        <div className="billing-builder__title-block">
          <div className="billing-builder__icon">
            <AssetIcon name={type === 'DEBIT_NOTE' ? 'receivables' : 'document'} size={34} />
          </div>
          <div>
            <p className="billing-builder__eyebrow">{isEdit ? 'Chỉnh sửa tài liệu' : 'Tạo tài liệu mới'}</p>
            <h2 id="billing-builder-title">{TITLE[type]}</h2>
            <div className="billing-builder__meta">
              <span>{entityName}</span>
              <span>{displayDate(rangeFrom)} - {displayDate(rangeTo)}</span>
              <span>{lines.length} dòng</span>
            </div>
          </div>
        </div>
        <button className="billing-builder__close" type="button" onClick={onClose} disabled={busy} aria-label="Đóng">
          <X size={22} />
        </button>
      </header>

      <main className="billing-builder__body">
        <section className="billing-builder__controls" aria-label="Khoảng thời gian và thao tác">
          <label>
            <span>Từ ngày</span>
            <input
              type="date"
              className="input billing-builder__date-input"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            <span>Đến ngày</span>
            <input
              type="date"
              className="input billing-builder__date-input"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            <span>Mẫu xuất</span>
            <select
              className="input billing-builder__template-select"
              value={templateId ?? ''}
              onChange={(e) => setTemplateId(e.target.value === '' ? null : Number(e.target.value))}
              disabled={busy}
            >
              <option value="">{type === 'DEBIT_NOTE' ? 'Mặc định (theo khách hàng)' : 'Mặc định bảng kê'}</option>
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.isDefault ? ' — mặc định' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="billing-builder__action-cell">
            <span className="billing-builder__action-spacer" aria-hidden="true">Lọc</span>
            <button className="btn btn--secondary" type="button" onClick={() => generateDraft(rangeFrom, rangeTo)} disabled={busy}>
              {loading ? <Loader2 size={15} className="spin" /> : <Filter size={15} />}
              Lọc lại
            </button>
          </div>
          {type === 'PAYMENT_STATEMENT' && (
            <button className="btn btn--ghost" type="button" onClick={addAdhoc} disabled={busy}>
              <Plus size={15} />
              Thêm dòng trình bày
            </button>
          )}
        </section>

        <section className="billing-builder__content">
          {type === 'DEBIT_NOTE' && eligibilitySummary && eligibilitySummary.blockedTrips.length > 0 && (
            <div
              style={{
                marginBottom: 16,
                padding: 12,
                borderRadius: 12,
                border: '1px solid #f2b8b5',
                background: '#fff4f3',
                color: '#8f2f2f',
              }}
            >
              <strong style={{ display: 'block', marginBottom: 6 }}>
                Đã lấy {eligibilitySummary.includedTripCount} chuyến đủ điều kiện. {eligibilitySummary.blockedTrips.length} chuyến bị loại khỏi giấy báo nợ.
              </strong>
              <div style={{ display: 'grid', gap: 4 }}>
                {eligibilitySummary.blockedTrips.slice(0, 6).map((trip) => (
                  <span key={trip.tripId}>
                    {trip.tripCode || `Chuyến #${trip.tripId}`}: {trip.reason}
                  </span>
                ))}
                {eligibilitySummary.blockedTrips.length > 6 && (
                  <span>... và {eligibilitySummary.blockedTrips.length - 6} chuyến khác.</span>
                )}
              </div>
            </div>
          )}
          <div className="billing-builder__table-wrap">
            {loading ? (
              <div className="billing-builder__state">
                <Loader2 size={24} className="spin" />
                <span>Đang lấy dòng công nợ trong kỳ...</span>
              </div>
            ) : lines.length === 0 ? (
              <div className="billing-builder__state billing-builder__state--empty">
                <AssetIcon name="document" size={46} />
                <strong>Không có dòng công nợ trong khoảng ngày này</strong>
                <span>Đổi khoảng ngày để lấy lại các nguồn hạch toán đủ điều kiện.</span>
              </div>
            ) : (
              <>
                <table className="billing-builder__table">
                  <colgroup>
                    <col className="billing-builder__col-desc" />
                    <col className="billing-builder__col-containers" />
                    <col className="billing-builder__col-unit" />
                    <col className="billing-builder__col-amount" />
                    <col className="billing-builder__col-action" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Container / khoản mục</th>
                      <th>Loại</th>
                      <th>ĐVT</th>
                      <th>Số tiền (VNĐ)</th>
                      <th aria-label="Thao tác"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedLines.map((group) => {
                      const routeParts = splitRouteName(group.routeName);
                      const containerGroups = groupLinesByContainer(group.lines);
                      return (
                        <Fragment key={group.key}>
                          <tr className="billing-builder__route-row">
                            <td colSpan={5}>
                              <div className="billing-builder__route-summary">
                                <div className="billing-builder__route-lines">
                                  {routeParts ? (
                                    <>
                                      <div className="billing-builder__route-line">
                                        <span>Điểm đi</span>
                                        <strong>{routeParts.origin}</strong>
                                      </div>
                                      <div className="billing-builder__route-line">
                                        <span>Điểm đến</span>
                                        <strong>{routeParts.destination}</strong>
                                      </div>
                                    </>
                                  ) : (
                                    <div className="billing-builder__route-line">
                                      <span>Tuyến</span>
                                      <strong>{group.routeName || 'Chưa có tuyến'}</strong>
                                    </div>
                                  )}
                                </div>
                                <div className="billing-builder__route-metrics">
                                  <span>{group.visibleCount}/{group.lines.length} dòng</span>
                                  <strong className="mono">{formatCurrency(group.subtotal).replace(' ₫', '')}</strong>
                                </div>
                              </div>
                            </td>
                          </tr>
                          {containerGroups.map((containerGroup) => (
                            <Fragment key={`${group.key}-${containerGroup.key}`}>
                              <tr className="billing-builder__container-row">
                                <td colSpan={3}>
                                  <div className="billing-builder__container-summary">
                                    <strong>{containerGroup.label}</strong>
                                    <span>{containerGroup.visibleCount}/{containerGroup.lines.length} khoản</span>
                                  </div>
                                </td>
                                <td className="billing-builder__subtotal mono">{formatCurrency(containerGroup.subtotal).replace(' ₫', '')}</td>
                                <td />
                              </tr>
                              {containerGroup.lines.map(({ line, index }) => {
                                const amount = line.amountOverride != null ? line.amountOverride : line.baseAmount;
                                return (
                                  <tr key={`${line.sourceType}-${line.sourceId ?? 'adhoc'}-${index}`} className={`billing-builder__item-row${line.excluded ? ' is-excluded' : ''}`}>
                                    <td>
                                      <textarea
                                        className="input billing-builder__text-field"
                                        value={line.description}
                                        rows={1}
                                        disabled={busy || type === 'DEBIT_NOTE'}
                                        onChange={(e) => updateLine(index, { description: e.target.value })}
                                      />
                                    </td>
                                    <td>
                                      <textarea
                                        className="input billing-builder__text-field"
                                        value={line.typeLabel}
                                        rows={1}
                                        disabled={busy || type === 'DEBIT_NOTE'}
                                        onChange={(e) => updateLine(index, { typeLabel: e.target.value })}
                                      />
                                    </td>
                                    <td>
                                      <textarea
                                        className="input billing-builder__text-field"
                                        style={{ textAlign: 'center' }}
                                        value={line.unit}
                                        rows={1}
                                        disabled={busy || type === 'DEBIT_NOTE'}
                                        onChange={(e) => updateLine(index, { unit: e.target.value })}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        type="number"
                                        className="input mono billing-builder__amount"
                                        value={amount}
                                        disabled
                                        readOnly
                                      />
                                    </td>
                                    <td className="billing-builder__row-actions">
                                      {type === 'PAYMENT_STATEMENT' && (
                                        <button className="billing-builder__action billing-builder__action--delete" type="button" onClick={() => removeLine(index)} disabled={busy} aria-label={`${line.excluded ? 'Khôi phục' : 'Xóa'} dòng ${index + 1}`}>
                                          {line.excluded ? <RotateCcw size={15} /> : <Trash2 size={15} />}
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </Fragment>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>

                <div className="billing-builder__mobile-groups">
                  {groupedLines.map((group) => {
                    const routeParts = splitRouteName(group.routeName);
                    const containerGroups = groupLinesByContainer(group.lines);
                    return (
                      <section className="billing-builder__mobile-group" key={`${group.key}-mobile`}>
                        <div className="billing-builder__mobile-route">
                          <div>
                            {routeParts ? (
                              <>
                                <span>Điểm đi</span>
                                <strong>{routeParts.origin}</strong>
                                <span>Điểm đến</span>
                                <strong>{routeParts.destination}</strong>
                              </>
                            ) : (
                              <>
                                <span>Tuyến</span>
                                <strong>{group.routeName || 'Chưa có tuyến'}</strong>
                              </>
                            )}
                          </div>
                          <strong className="mono">{formatCurrency(group.subtotal).replace(' ₫', '')}</strong>
                        </div>
                        <div className="billing-builder__mobile-items">
                          {containerGroups.map((containerGroup) => (
                            <section className="billing-builder__mobile-container" key={`${group.key}-${containerGroup.key}-mobile`}>
                              <div className="billing-builder__mobile-container-head">
                                <strong>{containerGroup.label}</strong>
                                <b className="mono">{formatCurrency(containerGroup.subtotal).replace(' ₫', '')}</b>
                              </div>
                              {containerGroup.lines.map(({ line, index }) => {
                                const amount = line.amountOverride != null ? line.amountOverride : line.baseAmount;
                                return (
                                  <div key={`${line.sourceType}-${line.sourceId ?? 'adhoc'}-${index}-mobile`} className={`billing-builder__mobile-item${line.excluded ? ' is-excluded' : ''}`}>
                                    <textarea
                                      className="input billing-builder__text-field"
                                      value={line.description}
                                      rows={2}
                                      disabled={busy || type === 'DEBIT_NOTE'}
                                      onChange={(e) => updateLine(index, { description: e.target.value })}
                                    />
                                    <div className="billing-builder__mobile-row">
                                      <span>Loại</span>
                                      <textarea
                                        className="input billing-builder__text-field"
                                        value={line.typeLabel}
                                        rows={1}
                                        disabled={busy || type === 'DEBIT_NOTE'}
                                        onChange={(e) => updateLine(index, { typeLabel: e.target.value })}
                                      />
                                    </div>
                                    <div className="billing-builder__mobile-row">
                                      <span>ĐVT</span>
                                      <textarea
                                        className="input billing-builder__text-field"
                                        value={line.unit}
                                        rows={1}
                                        disabled={busy || type === 'DEBIT_NOTE'}
                                        onChange={(e) => updateLine(index, { unit: e.target.value })}
                                      />
                                    </div>
                                    <div className="billing-builder__mobile-money">
                                      <label>
                                        <span>Số tiền</span>
                                        <input
                                          type="number"
                                          className="input mono billing-builder__amount"
                                          value={amount}
                                          disabled
                                          readOnly
                                        />
                                      </label>
                                      {type === 'PAYMENT_STATEMENT' && (
                                        <button className="billing-builder__action billing-builder__action--delete" type="button" onClick={() => removeLine(index)} disabled={busy} aria-label={`${line.excluded ? 'Khôi phục' : 'Xóa'} dòng ${index + 1}`}>
                                          {line.excluded ? <RotateCcw size={17} /> : <Trash2 size={17} />}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </section>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {type === 'DEBIT_NOTE' && lines.length > 0 && (
            <section aria-label="Tổng hợp VAT" style={{ display: 'grid', gap: 8, marginTop: 16, justifyContent: 'end' }}>
              <span>Tiền trước VAT: <strong className="mono">{formatCurrency(vatTotals.net)}</strong></span>
              <span>VAT: <strong className="mono">{formatCurrency(vatTotals.tax)}</strong></span>
              <span>Tổng thanh toán: <strong className="mono">{formatCurrency(vatTotals.gross)}</strong></span>
            </section>
          )}

          <label className="billing-builder__note">
            <span>Ghi chú</span>
            <textarea
              className="input"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Điều khoản thanh toán, ghi chú cho khách hàng/đối tác..."
              disabled={busy}
            />
          </label>
        </section>
      </main>

      <footer className="billing-builder__footer">
        <button className="btn btn--secondary" type="button" onClick={onClose} disabled={busy}>
          Đóng
        </button>
        <button className="btn btn--primary" type="button" onClick={exportXlsx} disabled={busy || lines.length === 0}>
          {exporting || saving ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
          {exporting || saving ? 'Đang lưu & xuất...' : 'Xuất Excel'}
        </button>
      </footer>
    </section>
  );

  return createPortal(content, portalTarget);
}
