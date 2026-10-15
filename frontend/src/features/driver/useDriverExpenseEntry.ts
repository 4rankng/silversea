import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DriverIncidentalCostType } from '@tingting/shared';
import { driverClient, type DriverIncidentalCostItem, type DriverIncidentalCostView } from '../../api/driverClient';
import { qk } from '../../api/keys';
import { businessDateISO } from '../../lib/format';
import { driverExpenseOption, driverExpenseOptions } from './driver-expense-options';

export type DriverEvidenceKind = 'INVOICE' | 'RECEIPT';

export interface DriverExpenseDraft {
  // Card 20261005 — "Người chi" gỡ khỏi chi phí lái xe: lái xe ghi khoản đã chi,
  // kế toán quyết định bên thực chi. Draft không còn trường payerKind.
  option: string; amount: number | ''; occurredAt: string; note: string;
  feeName: string; evidenceKind: DriverEvidenceKind; invoiceNumber: string; invoiceDate: string; receiptStorageKey: string | null;
}

const blankDraft = (): DriverExpenseDraft => ({ option: 'lift', amount: '', occurredAt: businessDateISO(), note: '', feeName: '', evidenceKind: 'RECEIPT', invoiceNumber: '', invoiceDate: '', receiptStorageKey: null });

export function useDriverExpenseEntry(tripId: number, readOnly: boolean) {
  const norms = useQuery({ queryKey: qk.driverFeeNorms, queryFn: driverClient.getFeeNorms, staleTime: 60_000, refetchOnWindowFocus: false });
  const options = driverExpenseOptions(norms.data?.items ?? []);
  const [entries, setEntries] = useState<DriverIncidentalCostView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Step 3 — the form is a DRAFT TABLE: the driver keeps adding rows and saves
  // them once, all-or-nothing. The legacy single-draft members (`draft`,
  // `patch`, `chooseOption`, `upload`, `cancel`, `save`) stay on the return
  // object as aliases of the CURRENT (last) row, so callers that poke one
  // field at a time keep working while the table drives the indexed API.
  const [drafts, setDrafts] = useState<DriverExpenseDraft[]>(() => [blankDraft()]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // One upload at a time (the operation lock below); the index says WHICH row
  // shows the spinner and, on failure, the retry block.
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [pendingFile, setPendingFile] = useState<{ index: number; file: File } | null>(null);
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

  function patchDraft(index: number, next: Partial<DriverExpenseDraft>) {
    setDrafts(current => current.map((row, i) => (i === index ? { ...row, ...next } : row)));
  }
  function chooseOptionFor(index: number, code: string) {
    const option = driverExpenseOption(code, options);
    setDrafts(current => current.map((row, i) => (i === index
      ? { ...row, option: code, feeName: option.label, amount: option.amount ?? '', invoiceNumber: '', invoiceDate: '' }
      : row)));
  }
  function addDraft() { setDrafts(current => [...current, blankDraft()]); }
  function removeDraft(index: number) {
    setDrafts(current => current.filter((_, i) => i !== index));
    // A pending (failed) upload belongs to a row — dropping the row drops the
    // retry block with it, and rows after it shift down one.
    setPendingFile(current => {
      if (!current || current.index === index) return null;
      return current.index > index ? { ...current, index: current.index - 1 } : current;
    });
  }
  function cancel() {
    if (operation.current) return;
    setOpen(false); setDrafts([blankDraft()]); setPendingFile(null); setError(null); request.current = null;
  }
  async function upload(file: File, index = drafts.length - 1) {
    if (readOnly || operation.current) return;
    setPendingFile({ index, file });
    operation.current = true; setUploadingIndex(index); setError(null);
    try { const result = await driverClient.uploadReceiptPhoto({ tripId, file }); patchDraft(index, { receiptStorageKey: result.storageKey }); setPendingFile(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa tải được ảnh. Giữ nguyên khoản chi để thử lại.'); }
    finally { operation.current = false; setUploadingIndex(null); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (operation.current || readOnly || drafts.length === 0) return;
    // All-or-nothing: validate EVERY row up front so a bad row can never half-
    // write the batch, and the message names the offending 1-based row.
    const items: DriverIncidentalCostItem[] = [];
    for (let index = 0; index < drafts.length; index += 1) {
      const row = drafts[index];
      if (pendingFile && pendingFile.index === index) {
        setError(`Dòng ${index + 1}: Ảnh chưa tải thành công. Thử tải lại hoặc bỏ ảnh trước khi lưu.`); return;
      }
      // Card 20260928_197 — the PM's "mọi màn hình nhập chi phí … cho phép nhập
      // số DƯƠNG và số ÂM". Mirrors the backend `signedExpenseVndSchema` and the
      // Ops modal exactly: a signed integer inside the money ceiling, with 0
      // still rejected — 0 is an empty row, not a signed one.
      if (row.amount === '' || !Number.isSafeInteger(row.amount) || row.amount === 0 || Math.abs(row.amount) > 999_999_999_999_999) {
        setError(`Dòng ${index + 1}: Nhập số tiền nguyên, tối đa 999.999.999.999.999đ (0 không dùng được).`); return;
      }
      const option = options.find(item => item.code === row.option);
      if (!option) { setError(`Dòng ${index + 1}: Định mức đã thay đổi. Chọn lại loại chi phí trước khi lưu.`); return; }
      // One draft row → one batch item. Only LOT costs (`DRIVER_SHIPMENT`)
      // carry the evidence classification (Hóa đơn / Phiếu thu) and its invoice
      // fields — the road bucket keeps its old contract (no evidence kind,
      // never an invoice), and a no-invoice row can never send one (card
      // 20260928_164: that is what pushed these rows into phải thu khách hàng).
      const lotCost = option.group === 'DRIVER_SHIPMENT';
      items.push({
        ...(option.expenseTypeCode ? { expenseTypeCode: option.expenseTypeCode } : {}),
        ...(option.feeNormCode ? { feeNormCode: option.feeNormCode } : {}),
        costType: option.type, costGroup: option.group, feeName: row.feeName.trim() || option.label,
        amount: row.amount, occurredAt: row.occurredAt, note: row.note.trim() || undefined,
        ...(lotCost ? { evidenceKind: row.evidenceKind } : {}),
        invoiceNumber: lotCost && row.evidenceKind === 'INVOICE' ? row.invoiceNumber.trim() || undefined : undefined,
        invoiceDate: lotCost && row.evidenceKind === 'INVOICE' ? row.invoiceDate || undefined : undefined,
        receiptStorageKey: row.receiptStorageKey ?? undefined });
    }
    // Idempotency discipline unchanged: the key is regenerated the moment the
    // CONTENT changes, and reused verbatim for a same-content retry (Q23).
    const fingerprint = JSON.stringify([tripId, drafts]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    operation.current = true; setBusy(true); setError(null);
    try {
      await driverClient.createIncidentalCosts(tripId, items, request.current.key);
      request.current = null; setDrafts([]); setOpen(false);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa xác định được kết quả lưu. Thử lại cùng nội dung để tra đúng yêu cầu.'); }
    finally { operation.current = false; setBusy(false); }
  }

  // Current (last) row — the alias surface older callers bind to.
  const draft = drafts[drafts.length - 1] ?? blankDraft();
  const patch = (next: Partial<DriverExpenseDraft>) => patchDraft(drafts.length - 1, next);
  function chooseOption(code: string) { chooseOptionFor(drafts.length - 1, code); }
  return { options, norms, entries, loading, loadError, refresh,
    drafts, addDraft, removeDraft, patchDraft, chooseOptionFor,
    draft, patch, chooseOption, upload,
    open, setOpen, busy, uploading: uploadingIndex != null, uploadingIndex, pendingFile, discardPendingFile: () => setPendingFile(null), error, cancel, save };
}
