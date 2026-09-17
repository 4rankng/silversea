import { useCallback, useEffect, useRef, useState } from 'react';
import { DriverIncidentalCostType } from '@tingting/shared';
import { driverClient } from '../../api/driverClient';
import { businessDateISO } from '../../lib/format';
import { driverExpenseOption } from './driver-expense-options';

export interface DriverExpenseDraft {
  option: string; payerKind: 'USER' | 'COMPANY'; amount: number | ''; occurredAt: string; note: string;
  feeName: string; invoiceNumber: string; invoiceDate: string; receiptStorageKey: string | null;
}

const blankDraft = (): DriverExpenseDraft => ({ option: 'lift', payerKind: 'USER', amount: '', occurredAt: businessDateISO(), note: '', feeName: '', invoiceNumber: '', invoiceDate: '', receiptStorageKey: null });
type Entry = Awaited<ReturnType<typeof driverClient.listIncidentalCosts>>[number];

export function useDriverExpenseEntry(tripId: number, readOnly: boolean) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState(blankDraft);
  const [open, setOpen] = useState(false);
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
  function chooseOption(code: string) {
    const option = driverExpenseOption(code);
    setDraft(current => ({ ...current, option: code, feeName: option.label, amount: option.amount ?? '', invoiceNumber: '', invoiceDate: '' }));
  }
  function cancel() {
    if (operation.current) return;
    setOpen(false); setDraft(blankDraft()); setPendingFile(null); setError(null); request.current = null;
  }
  async function upload(file: File) {
    if (readOnly || operation.current) return;
    setPendingFile(file);
    operation.current = true; setUploading(true); setError(null);
    try { const result = await driverClient.uploadReceiptPhoto({ tripId, file }); patch({ receiptStorageKey: result.storageKey }); setPendingFile(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa tải được ảnh. Giữ nguyên khoản chi để thử lại.'); }
    finally { operation.current = false; setUploading(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (operation.current || readOnly) return;
    if (pendingFile) { setError('Ảnh chưa tải thành công. Thử tải lại hoặc bỏ ảnh trước khi lưu.'); return; }
    if (draft.amount === '' || !Number.isSafeInteger(draft.amount) || draft.amount <= 0 || draft.amount > 999_999_999_999_999) {
      setError('Nhập số tiền nguyên dương hợp lệ.'); return;
    }
    const option = driverExpenseOption(draft.option);
    const body = { payerKind: draft.payerKind, costType: option.type, costGroup: option.group, feeName: draft.feeName.trim() || option.label,
      amount: draft.amount, occurredAt: draft.occurredAt, note: draft.note.trim() || undefined,
      invoiceNumber: option.group === 'DRIVER_SHIPMENT' ? draft.invoiceNumber.trim() || undefined : undefined,
      invoiceDate: option.group === 'DRIVER_SHIPMENT' ? draft.invoiceDate || undefined : undefined,
      receiptStorageKey: draft.receiptStorageKey ?? undefined };
    const fingerprint = JSON.stringify([tripId, body]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    operation.current = true; setBusy(true); setError(null);
    try {
      await driverClient.createIncidentalCost(tripId, body, request.current.key);
      request.current = null; setDraft(blankDraft()); setOpen(false);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa xác định được kết quả lưu. Thử lại cùng nội dung để tra đúng yêu cầu.'); }
    finally { operation.current = false; setBusy(false); }
  }
  return { entries, loading, loadError, refresh, draft, patch, chooseOption, open, setOpen, busy, uploading, pendingFile, discardPendingFile: () => setPendingFile(null), error, cancel, upload, save };
}
