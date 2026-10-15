import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DriverIncidentalCostType } from '@tingting/shared';
import { driverClient } from '../../api/driverClient';
import { qk } from '../../api/keys';
import { businessDateISO } from '../../lib/format';
import { driverExpenseOption, driverExpenseOptionInvoiceClass, driverExpenseOptions } from './driver-expense-options';
import type { LotCostDocumentKind } from '../../components/costs/LotCostForm';

export interface DriverExpenseDraft {
  optionCode: string; amount: number | ''; occurredAt: string; note: string;
  feeName: string; documentKind: LotCostDocumentKind; receiptStorageKey: string | null;
}

const blankDraft = (): DriverExpenseDraft => ({ optionCode: 'lift', amount: '', occurredAt: businessDateISO(), note: '', feeName: '', documentKind: 'INVOICE', receiptStorageKey: null });
export type DriverExpenseEntryRow = Awaited<ReturnType<typeof driverClient.listIncidentalCosts>>[number];

export function useDriverExpenseEntry(tripId: number, readOnly: boolean) {
  const norms = useQuery({ queryKey: qk.driverFeeNorms, queryFn: driverClient.getFeeNorms, staleTime: 60_000, refetchOnWindowFocus: false });
  const options = driverExpenseOptions(norms.data?.items ?? []);
  const [entries, setEntries] = useState<DriverExpenseEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState(blankDraft);
  const [openGroup, setOpenGroup] = useState<'DRIVER_SHIPMENT' | 'DRIVER_ROAD' | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(false);
  const loadSequence = useRef(0);
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const items = await driverClient.listIncidentalCosts(tripId);
      if (sequence === loadSequence.current) { setEntries(items.filter(item => item.costType !== DriverIncidentalCostType.FUEL)); setLoadError(null); }
    } catch (cause) {
      if (sequence === loadSequence.current) setLoadError(cause instanceof Error ? cause.message : 'Không tải được chi phí.');
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [tripId]);
  useEffect(() => {
    const pending = loadSequence;
    void refresh();
    return () => { pending.current++; };
  }, [refresh]);

  const patch = (next: Partial<DriverExpenseDraft>) => setDraft(current => ({ ...current, ...next }));
  // The document kind follows the CATALOG class of the picked fee (cards
  // 20260928_163/164 — classified fees are locked to what the catalog says;
  // unclassified fees default to the hand receipt the driver can change).
  const kindForOption = (code: string | undefined): LotCostDocumentKind =>
    driverExpenseOptionInvoiceClass(code == null ? undefined : driverExpenseOption(code, options)) === 'INVOICED' ? 'INVOICE' : 'RECEIPT';
  function chooseOption(code: string) {
    const option = driverExpenseOption(code, options);
    setDraft(current => ({ ...current, optionCode: code, feeName: option.label, amount: option.amount ?? '', documentKind: kindForOption(code) }));
  }
  function openGroupEntry(group: 'DRIVER_SHIPMENT' | 'DRIVER_ROAD') {
    if (operation.current) return;
    const first = options.find(option => option.group === group);
    setDraft({ ...blankDraft(), ...(first ? { optionCode: first.code, feeName: first.label, amount: first.amount ?? '' } : {}), documentKind: kindForOption(first?.code) });
    setOpenGroup(group); setPendingFile(null); setError(null); request.current = null;
  }
  function cancel() {
    if (operation.current) return;
    setOpenGroup(null); setDraft(blankDraft()); setPendingFile(null); setError(null); request.current = null;
  }
  async function upload(file: File) {
    if (readOnly || operation.current) return;
    setPendingFile(file);
    operation.current = true; setUploading(true); setError(null);
    try { const result = await driverClient.uploadReceiptPhoto({ tripId, file }); patch({ receiptStorageKey: result.storageKey }); setPendingFile(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa tải được ảnh. Giữ nguyên khoản chi để thử lại.'); }
    finally { operation.current = false; setUploading(false); }
  }
  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    if (operation.current || readOnly || !openGroup) return;
    if (pendingFile) { setError('Ảnh chưa tải thành công. Thử tải lại hoặc bỏ ảnh trước khi lưu.'); return; }
    // Card 20260928_197 — the PM's "mọi màn hình nhập chi phí … cho phép nhập
    // số DƯƠNG và số ÂM". Mirrors the backend `signedExpenseVndSchema` and the
    // Ops modal exactly: a signed integer inside the money ceiling, with 0
    // still rejected — 0 is an empty row, not a signed one.
    if (draft.amount === '' || !Number.isSafeInteger(draft.amount) || draft.amount === 0 || Math.abs(draft.amount) > 999_999_999_999_999) {
      setError('Nhập số tiền nguyên, tối đa 999.999.999.999.999đ (0 không dùng được).'); return;
    }
    const option = options.find(item => item.code === draft.optionCode && item.group === openGroup);
    if (!option) { setError('Định mức đã thay đổi. Chọn lại loại chi phí trước khi lưu.'); return; }
    // Cost-doc redesign: the driver enters the amount and the DOCUMENT PHOTO;
    // invoice number/date are the accountant's reconciliation fields, and the
    // payer is the driver by definition (kế toán sửa trên hệ thống của họ).
    // Classified fees carry their catalog identity so the server keeps
    // deciding invoice class and customer charge from DATA (cards 163/164).
    const body = { ...(option.expenseTypeCode ? { expenseTypeCode: option.expenseTypeCode } : {}),
      ...(option.feeNormCode ? { feeNormCode: option.feeNormCode } : {}), costType: option.type, costGroup: option.group,
      feeName: draft.feeName.trim() || option.label,
      amount: draft.amount, occurredAt: draft.occurredAt, note: draft.note.trim() || undefined,
      receiptStorageKey: draft.receiptStorageKey ?? undefined };
    const fingerprint = JSON.stringify([tripId, body]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    operation.current = true; setBusy(true); setError(null);
    try {
      await driverClient.createIncidentalCost(tripId, body, request.current.key);
      request.current = null; setDraft(blankDraft()); setOpenGroup(null);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa xác định được kết quả lưu. Thử lại cùng nội dung để tra đúng yêu cầu.'); }
    finally { operation.current = false; setBusy(false); }
  }
  return { options, norms, entries, loading, loadError, refresh, draft, patch, chooseOption, openGroup, openGroupEntry, busy, uploading, pendingFile, discardPendingFile: () => setPendingFile(null), error, cancel, upload, save: (event?: React.FormEvent) => save(event) };
}
