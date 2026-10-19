import { PhotoImage } from '../../components/shared/PhotoImage';
import { useMemo, useRef, useState } from 'react';
import { Camera, Loader2, Trash2, X } from 'lucide-react';
import { useOpsExpenseTypes, useOpsContainerClaimants, useCreateOpsExpense } from '../../hooks/useOpsQueries';
import { opsClient, type OpsOrderItem, type OpsExpenseDuplicateHit } from '../../api/opsClient';
import { compressImageFile } from '../../lib/imageCompression';
import { useAuthedPhotoUrls } from '../../lib/api/photo';
import { useToast } from '../../components/shared/Toast';
import { toastActionError } from '../../lib/api/action-error';
import { ApiError } from '../../lib/api/errors';
import { localDateInputValue } from './opsStatus';
import { formatMoney } from '../../lib/format';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { DateInput } from '../../design-system/forms/DateInput';
import { NumberField } from '../../design-system/forms/NumberField';
import { SearchableMultiSelect } from '../../design-system/forms/SearchableMultiSelect';

import './ops-modal.css';
import { OpsModalBackdrop } from './OpsModalBackdrop';
import { opsGroupForType, type OpsCostGroup } from './OpsExpenseFinancialFields';
import { ExpenseNameSuggestions } from '../expense-accounting/ExpenseNameSuggestions';
import type { ExpenseCostGroup } from '@tingting/shared';

interface Props {
  order: OpsOrderItem;
  onClose: () => void;
}

interface PendingPhoto {
  storageKey: string;
  name: string;
}

const LOT_CHOICE = 'LOT';

/** Số Cont choice → payload container id. The shared-lot choice and an empty
 *  choice both mean "no container row" — an empty string must never reach
 *  `Number()` and serialize as container 0 (audit c12 A2: the backend zod
 *  schema `shipmentContainerId: z.number().int().positive()` rejects 0 with
 *  the default message the UI translates to "Giá trị phải lớn hơn 0"). */
export function opsContainerId(containerChoice: string): number | null {
  if (containerChoice === LOT_CHOICE || containerChoice === '') return null;
  return Number(containerChoice);
}

/** Card 141026230720 — recognize the write path's duplicate bounce (409
 *  OPS_EXPENSE_DUPLICATE) and lift its earlier-row list for the confirm
 *  panel. Anything else (including other 409s) returns null so the caller
 *  keeps the ordinary red-toast handling. */
export function opsDuplicateHitsFromError(error: unknown): OpsExpenseDuplicateHit[] | null {
  if (error instanceof ApiError && error.status === 409) {
    const raw = error.raw as { code?: unknown; duplicates?: unknown } | null;
    if (raw?.code === 'OPS_EXPENSE_DUPLICATE' && Array.isArray(raw.duplicates) && raw.duplicates.length > 0) {
      // Defense-in-depth: a malformed element must not crash the render —
      // drop non-object entries and only then admit the panel.
      const hits = raw.duplicates.filter((hit): hit is OpsExpenseDuplicateHit => hit != null && typeof hit === 'object');
      return hits.length > 0 ? hits : null;
    }
  }
  return null;
}

/** chiphispec §2 — who entered the earlier row: the display name, falling back
 *  to the entrant's id ("OPS #12") when the payload carries no usable name. */
export function opsDuplicateWho(hit: OpsExpenseDuplicateHit): string {
  return hit.paidByName?.trim() || (hit.paidById != null ? `OPS #${hit.paidById}` : 'người khác');
}

/** Card 191026160000 — one fee line of the mockup's two blocks. Block
 *  placement owns the invoice pair (Phí có hóa đơn carries Số hóa đơn +
 *  Ngày hóa đơn; Phí không hóa đơn carries the Thực-thu side), so the drafts
 *  keep only the fields their block renders. */
interface FeeDraft {
  key: number;
  typeCode: string;
  amount: number | '';
  /** Thực thu — thu khách (no-invoice block). Display text, parsed server-side. */
  charge: string;
  invoiceNumber: string;
  invoiceDate: string;
  feeName: string;
  note: string;
  /** Ghi chú thu khách — the dispatch-board note surface (card 20260921_5). */
  recoveryNote: string;
  photos: PendingPhoto[];
  pendingFiles: File[];
}

function blankFeeDraft(key: number): FeeDraft {
  return {
    key, typeCode: '', amount: '', charge: '', invoiceNumber: '', invoiceDate: '',
    feeName: '', note: '', recoveryNote: '', photos: [], pendingFiles: [],
  };
}

/** Mirror of the backend money guard (signed VND integer, 0 rejected): a
 *  negative line is the PM's "tương đương xóa dòng" and every total drops it. */
function amountValidOf(amount: number | ''): boolean {
  return amount !== '' && Number.isSafeInteger(amount) && amount !== 0 && Math.abs(amount) <= 999_999_999_999_999;
}

/** The customer charge the SERVER will derive for this draft (card 20260928_162
 *  client mirror): invoice rows charge the amount; no-invoice rows charge only
 *  their Thực-thu override. ≤ 0 makes the row's Ghi chú mandatory. */
function chargeOf(block: 'noInvoice' | 'invoice', draft: FeeDraft, valid: boolean): number {
  if (block === 'invoice') return valid ? Number(draft.amount) : 0;
  const text = draft.charge.trim();
  return text === '' ? 0 : Number(text) || 0;
}

/** A fully blank draft (nothing typed anywhere) is the placeholder "+ row" —
 *  it never blocks Lưu, never saves, and never shows a validation error. */
function isEmptyDraft(draft: FeeDraft): boolean {
  return !draft.typeCode
    && draft.amount === ''
    && draft.charge.trim() === ''
    && draft.invoiceNumber.trim() === ''
    && draft.feeName.trim() === ''
    && draft.note.trim() === ''
    && draft.recoveryNote.trim() === ''
    && draft.photos.length === 0;
}

function draftErrors(block: 'noInvoice' | 'invoice', draft: FeeDraft): string | null {
  if (isEmptyDraft(draft)) return null;
  const valid = amountValidOf(draft.amount);
  if (!draft.typeCode) return 'Chọn loại phí.';
  if (!valid) return draft.amount === 0
    ? 'Số tiền không được bằng 0 — nhập (+) chi phí hoặc (−) chi phí để bỏ dòng'
    : 'Nhập số tiền nguyên, tối đa 999.999.999.999.999đ';
  const charge = chargeOf(block, draft, valid);
  if (Number.isNaN(charge) || charge < 0) return 'Thực thu (thu khách) phải là số không âm.';
  if (charge <= 0 && draft.note.trim() === '') return 'Dòng không thu khách — bắt buộc ghi chú lý do.';
  if (draft.pendingFiles.length > 0) return 'Còn ảnh chưa tải xong.';
  return null;
}

let draftKeySeq = 1;

/** Props the module-scope fee row needs from the modal (keeps the row a
 *  STABLE component type — a row defined inside the modal would remount on
 *  every keystroke and drop its own photo-url state mid-interaction). */
interface FeeRowHost {
  typesData: { items: Array<{ code: string; name: string; requiresInvoice: boolean | null; category?: string | null }> } | undefined;
  typesReady: boolean;
  busy: boolean;
  patch: (block: 'noInvoice' | 'invoice', key: number, patch: Partial<FeeDraft> | ((row: FeeDraft) => Partial<FeeDraft>)) => void;
  upload: (block: 'noInvoice' | 'invoice', rowKey: number, files: FileList | File[] | null) => void;
  remove: (block: 'noInvoice' | 'invoice', key: number) => void;
  typeOptionsOf: (block: 'noInvoice' | 'invoice') => Array<{ value: string; label: string; disabled?: boolean }>;
}

/**
 * "Khai báo chi phí" (OpsVanHanh §3.3), card 191026160000 mockup: two fee
 * blocks — "Phí không hóa đơn" and "Phí có hóa đơn" — each with add-row
 * entry, a Số Cont multi-select with chọn-all, a date picker defaulting to
 * today, and OPTIONAL receipt photos (Ops hands the accountant paper
 * invoices, so an empty photo set is normal, never a "thiếu chứng từ" debt).
 */
export function OpsExpenseFormModal({ order, onClose }: Props) {
  const typesQuery = useOpsExpenseTypes();
  const typesData = typesQuery.data;
  const createExpense = useCreateOpsExpense();
  const { toast } = useToast();

  // Số Cont: multi-select with chọn-all (mockup "Được chọn all số cont").
  // 'Phí chung lô' stays the default — a lot-wide fee is ONE row with no
  // container; picking containers instead declares the fee PER container.
  const [containerValues, setContainerValues] = useState<string[]>([LOT_CHOICE]);
  const [paidAt, setPaidAt] = useState(localDateInputValue());
  const [noInvoiceRows, setNoInvoiceRows] = useState<FeeDraft[]>([blankFeeDraft(draftKeySeq++)]);
  const [invoiceRows, setInvoiceRows] = useState<FeeDraft[]>([]);
  // Card 141026230720 — live rows the write path bounced as duplicates
  // (same type + same scope). Non-null renders the explicit confirm panel;
  // only "Tiếp tục lưu" resends with duplicateConfirmed.
  const [duplicateHits, setDuplicateHits] = useState<OpsExpenseDuplicateHit[] | null>(null);
  const savingRef = useRef(false);
  const [progress, setProgress] = useState('');
  const [saveError, setSaveError] = useState('');

  const groupedTypes = useMemo(() => {
    const items = typesData?.items ?? [];
    return {
      withInvoice: items.filter((type) => type.requiresInvoice === true),
      withoutInvoice: items.filter((type) => type.requiresInvoice !== true),
    };
  }, [typesData]);

  const containerOptions = useMemo(() => ([
    { value: LOT_CHOICE, label: 'Phí chung lô' },
    ...order.containerNumbers.map((containerNumber, index) => (
      { value: String(order.containerIds[index]), label: containerNumber }
    )),
  ]), [order.containerNumbers, order.containerIds]);

  const allContainerValues = useMemo(
    () => order.containerIds.map(String),
    [order.containerIds],
  );
  const allContainersPicked = allContainerValues.length > 0
    && allContainerValues.every((value) => containerValues.includes(value));

  function setContainers(next: string[]) {
    setDuplicateHits(null);
    // 'Phí chung lô' is exclusive with per-container picks — but the picker
    // hands back the FULL array, so direction matters: the pick the user just
    // ADDED wins. Adding Phí chung lô clears containers; adding a container
    // clears the lot choice; a removal-only change keeps the rest.
    const added = next.find((value) => !containerValues.includes(value));
    if (added === LOT_CHOICE) {
      setContainerValues([LOT_CHOICE]);
      return;
    }
    const ordered = allContainerValues.filter((value) => added != null
      ? next.includes(value)
      : next.includes(value) && value !== LOT_CHOICE);
    setContainerValues(ordered);
  }

  function chooseAllContainers() {
    setDuplicateHits(null);
    setContainerValues(allContainersPicked ? [] : [...allContainerValues]);
  }

  // Duplicate-cont heads-up (plan step 5): any Ops may declare on any lot, so
  // two people can land on the same cont. The answer is a WARNING naming the
  // earlier claimant — never a block; Lưu stays enabled either way. A failed
  // probe simply shows no warning.
  const claimantsQuery = useOpsContainerClaimants(order.id);
  const pickedContainerIds = useMemo(
    () => containerValues.filter((value) => value !== LOT_CHOICE).map(Number),
    [containerValues],
  );
  const claimants = useMemo(
    () => (claimantsQuery.data ?? []).filter((row) => pickedContainerIds.includes(row.containerId)),
    [claimantsQuery.data, pickedContainerIds],
  );
  const claimantLabel = (containerId: number) => (
    claimantsQuery.data?.find((row) => row.containerId === containerId)?.containerNumber
      ?? order.containerNumbers[order.containerIds.indexOf(containerId)]
      ?? String(containerId)
  );

  const typeOptionsOf = (block: 'noInvoice' | 'invoice') => {
    const options: Array<{ value: string; label: string; disabled?: boolean }> = [
      { value: '', label: '— Chọn loại phí —' },
    ];
    (block === 'invoice' ? groupedTypes.withInvoice : groupedTypes.withoutInvoice)
      .forEach((type) => options.push({ value: type.code, label: type.name }));
    return options;
  };

  const blockRows = (block: 'noInvoice' | 'invoice') => (block === 'noInvoice' ? noInvoiceRows : invoiceRows);
  const setBlockRows = (block: 'noInvoice' | 'invoice') => (block === 'noInvoice' ? setNoInvoiceRows : setInvoiceRows);

  function patchDraft(block: 'noInvoice' | 'invoice', key: number, patch: Partial<FeeDraft> | ((row: FeeDraft) => Partial<FeeDraft>)) {
    setDuplicateHits(null);
    setSaveError('');
    setBlockRows(block)(rows => rows.map(row => row.key === key ? { ...row, ...(typeof patch === 'function' ? patch(row) : patch) } : row));
  }

  function addDraft(block: 'noInvoice' | 'invoice') {
    setBlockRows(block)(rows => [...rows, blankFeeDraft(draftKeySeq++)]);
  }

  function removeDraft(block: 'noInvoice' | 'invoice', key: number) {
    setBlockRows(block)(rows => rows.filter(row => row.key !== key));
  }

  const drafts = [...noInvoiceRows, ...invoiceRows];
  // Per-row validity is block-dependent, so recompute with the right block.
  const invalidKeys = useMemo(() => {
    const keys = new Set<number>();
    for (const draft of noInvoiceRows) if (draftErrors('noInvoice', draft)) keys.add(draft.key);
    for (const draft of invoiceRows) if (draftErrors('invoice', draft)) keys.add(draft.key);
    return keys;
  }, [noInvoiceRows, invoiceRows]);
  const total = drafts.reduce((sum, draft) => sum + (amountValidOf(draft.amount) ? Number(draft.amount) : 0), 0);
  const anyPendingFiles = drafts.some((draft) => draft.pendingFiles.length > 0);
  // The catalog must be loaded AND every rendered row complete before the
  // batch goes out.
  const typesReady = typesQuery.isSuccess && Boolean(typesData?.items.length);
  // A form of untouched "+ rows" has nothing to save.
  const hasAnyRow = drafts.some((draft) => !isEmptyDraft(draft));
  const canSubmit = typesReady && hasAnyRow && invalidKeys.size === 0 && !createExpense.isPending && !anyPendingFiles;

  const pendingResume = useRef<{ tasks: SaveTask[]; index: number } | null>(null);

  async function uploadRowPhotos(block: 'noInvoice' | 'invoice', rowKey: number, files: FileList | File[] | null) {
    if (!files?.length || savingRef.current) return;
    const row = blockRows(block).find((item) => item.key === rowKey);
    if (!row) return;
    if (row.photos.length + files.length > 20) { toast({ kind: 'error', message: 'Mỗi khoản chi tối đa 20 ảnh. Chọn ít ảnh hơn.' }); return; }
    const remaining = Array.from(files);
    patchDraft(block, rowKey, { pendingFiles: [...remaining] });
    try {
      while (remaining.length) {
        const file = remaining[0];
        const compressed = await compressImageFile(file, { maxDimension: 2048 });
        const result = await opsClient.uploadExpensePhoto(compressed);
        // Photo accumulation runs inside the updater so a slow upload can
        // never overwrite a key a faster one just landed.
        patchDraft(block, rowKey, (current) => ({
          photos: [...current.photos, { storageKey: result.storageKey, name: file.name }],
          pendingFiles: remaining.slice(1),
        }));
        remaining.shift();
      }
    } catch (error) {
      toastActionError(toast, 'tải ảnh', error, 'Tải ảnh thất bại. Ảnh chưa tải vẫn được giữ để thử lại.');
    } finally {
      patchDraft(block, rowKey, { pendingFiles: [...remaining] });
    }
  }

  /** One write task = one fee draft on one container scope (lot-wide = ONE
   *  task with `null`; picked containers = one task each). */
  interface SaveTask {
    block: 'noInvoice' | 'invoice';
    rowKey: number;
    containerId: number | null;
    duplicateConfirmed?: boolean;
  }

  async function saveFrom(tasks: SaveTask[], startIndex: number) {
    if (savingRef.current || !canSubmit) return;
    savingRef.current = true;
    setSaveError('');
    for (let index = startIndex; index < tasks.length; index++) {
      const task = tasks[index]!;
      const draft = blockRows(task.block).find((row) => row.key === task.rowKey);
      if (!draft) continue;
      setProgress(`Đang lưu ${index + 1}/${tasks.length}…`);
      try {
        await createExpense.mutateAsync({
          shipmentId: order.id,
          shipmentContainerId: task.containerId,
          expenseTypeCode: draft.typeCode,
          amount: String(draft.amount),
          paidAt,
          note: draft.note.trim() || null,
          photoStorageKeys: draft.photos.map((photo) => photo.storageKey),
          // Block placement owns the cost group: invoice rows derive Nâng/Hạ
          // from the catalog category, no-invoice rows are giao nhận.
          costGroup: (task.block === 'invoice'
            ? opsGroupForType(typesData?.items.find((type) => type.code === draft.typeCode))
            : 'OPS_REGULAR') as ExpenseCostGroup,
          feeName: draft.feeName.trim() || undefined,
          invoiceNumber: task.block === 'invoice' ? draft.invoiceNumber.trim() || null : null,
          invoiceDate: task.block === 'invoice' ? draft.invoiceDate || null : null,
          recoveryNote: task.block === 'noInvoice' ? draft.recoveryNote.trim() || null : null,
          customerChargeAmount: task.block === 'noInvoice'
            ? (draft.charge.trim() === '' ? undefined : draft.charge.trim())
            : undefined,
          duplicateConfirmed: task.duplicateConfirmed,
        });
      } catch (error) {
        // Card 141026230720 — a duplicate bounce is a QUESTION, not a failure:
        // show the confirm panel naming the earlier rows instead of a red
        // toast, and let only an explicit "Tiếp tục lưu" override. Rows saved
        // before the bounce stay saved.
        const hits = opsDuplicateHitsFromError(error);
        if (hits) {
          setDuplicateHits(hits);
          setProgress('');
          savingRef.current = false;
          pendingResume.current = { tasks, index };
          return;
        }
        setProgress('');
        const done = index - startIndex;
        const left = tasks.length - index;
        setSaveError(done > 0
          ? `Đã lưu ${done} dòng. ${left} dòng chưa lưu: ${error instanceof Error ? error.message : 'Lưu khoản chi thất bại.'}`
          : error instanceof Error ? error.message : 'Lưu khoản chi thất bại.');
        savingRef.current = false;
        return;
      }
    }
    setProgress('');
    savingRef.current = false;
    toast({ kind: 'success', message: `Đã ghi nhận ${tasks.length} khoản chi.` });
    onClose();
  }

  function buildTasks(): SaveTask[] {
    const scopes: Array<number | null> = containerValues.includes(LOT_CHOICE) || containerValues.length === 0
      ? [null]
      : pickedContainerIds;
    const tasks: SaveTask[] = [];
    // Blank placeholder rows ("+ Thêm chi phí" left untouched) never save.
    for (const draft of noInvoiceRows) if (!isEmptyDraft(draft)) for (const scope of scopes) tasks.push({ block: 'noInvoice', rowKey: draft.key, containerId: scope });
    for (const draft of invoiceRows) if (!isEmptyDraft(draft)) for (const scope of scopes) tasks.push({ block: 'invoice', rowKey: draft.key, containerId: scope });
    return tasks;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const tasks = buildTasks();
    pendingResume.current = null;
    await saveFrom(tasks, 0);
  }

  async function resumeWithDuplicateConfirmed() {
    const resume = pendingResume.current;
    if (!resume) return;
    setDuplicateHits(null);
    const tasks = resume.tasks.map((task, index) => (
      index === resume.index ? { ...task, duplicateConfirmed: true } : task));
    pendingResume.current = null;
    await saveFrom(tasks, resume.index);
  }

  const busy = createExpense.isPending || progress !== '';
  const feeRowHost: FeeRowHost = {
    typesData, typesReady, busy, patch: patchDraft, upload: uploadRowPhotos, remove: removeDraft, typeOptionsOf,
  };

  return (
    <OpsModalBackdrop onClose={() => { if (!savingRef.current && !busy) onClose(); }} ariaLabel="Khai báo chi phí">
      <form className="ops-modal" onSubmit={handleSubmit}>
        <header className="ops-modal__head">
          <h2>Khai báo chi phí</h2>
          <button type="button" aria-label="Đóng" disabled={busy} onClick={onClose}><X size={18} /></button>
        </header>

        <div className="ops-modal__body">
          <fieldset className="ops-modal__fieldset">
          {typesQuery.isPending && <p role="status">Đang tải danh mục loại phí…</p>}
          {typesQuery.isError && <div role="alert">
            <p>Không tải được danh mục loại phí. Nội dung đang nhập vẫn được giữ.</p>
            <button type="button" className="btn btn--secondary" disabled={typesQuery.isFetching} onClick={() => void typesQuery.refetch()}>
              {typesQuery.isFetching ? 'Đang tải…' : 'Thử tải lại loại phí'}
            </button>
          </div>}
          {typesQuery.isSuccess && !typesData?.items.length && <p role="status">Chưa có loại phí đang sử dụng. Liên hệ người quản lý danh mục để bổ sung.</p>}
          <div className="ops-form-grid">
            <label>
              Số {order.tradeDirection === 'EXPORT' ? 'Booking' : 'Bill'}
              <input value={order.billRef?.trim() || 'Chưa có số Bill/Booking'} readOnly />
            </label>
            <label>
              Ngày chi *
              <DateInput value={paidAt} onChange={setPaidAt} required />
            </label>
          </div>
          <div className="ops-cont-picker">
            <span className="ops-cont-picker__label" id="ops-cont-picker-label">Số Cont</span>
            <div className="ops-cont-picker__actions">
              <label className="ops-cont-picker__all">
                <input
                  type="checkbox"
                  aria-label="Chọn tất cả số cont"
                  checked={allContainersPicked}
                  disabled={order.containerIds.length === 0 || busy}
                  onChange={chooseAllContainers}
                />
                Chọn tất cả
              </label>
            </div>
            <SearchableMultiSelect
              id="ops-expense-cont-multiselect"
              values={containerValues}
              onChange={setContainers}
              options={containerOptions}
              selectionLabel="số cont"
              clearAllLabel="Bỏ chọn tất cả"
              placeholder="Phí chung lô"
              disabled={busy || order.containerIds.length === 0}
            />
          </div>

          {claimants.map((claimant) => (
            <p key={claimant.containerId} className="ops-modal__warning" role="alert">
              {`Cont ${claimantLabel(claimant.containerId)} đã có ${claimant.paidByName ?? 'người khác'} nhập trước — bạn vẫn tiếp tục nhập chứ.`}
            </p>
          ))}

          {duplicateHits && (
            <div className="ops-modal__warning ops-modal__duplicate" role="alert">
              <p>
                {`ĐÃ ĐƯỢC ${opsDuplicateWho(duplicateHits[0])} NHẬP TRƯỚC ĐÓ, BẠN VẪN TIẾP TỤC NHẬP CHỨ?`}
              </p>
              <ul>
                {duplicateHits.map((hit) => (
                  <li key={hit.id}>
                    {`${opsDuplicateWho(hit)} · ${formatMoney(hit.amount)} ₫ · ngày ${hit.paidAt.split('-').reverse().join('/')}${hit.containerNumber ? ` · cont ${hit.containerNumber}` : ' · phí chung lô'}`}
                  </li>
                ))}
              </ul>
              <p className="ops-modal-hint">Kiểm tra lại để tránh nhập trùng. Nếu đây là lần chi hợp lệ (ví dụ tách thanh toán), bấm Tiếp tục lưu.</p>
              <div className="ops-modal__duplicate-actions">
                <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => setDuplicateHits(null)}>Kiểm tra lại</button>
                <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void resumeWithDuplicateConfirmed()}>Tiếp tục lưu</button>
              </div>
            </div>
          )}

          <section className="ops-fee-block" aria-label="Phí không hóa đơn">
            <h3>Phí không hóa đơn</h3>
            {noInvoiceRows.length === 0 && <p className="ops-modal-hint">Chưa có khoản nào trong khối này.</p>}
            {noInvoiceRows.map((draft, index) => (
              <FeeRowFields key={draft.key} block="noInvoice" draft={draft} ordinal={index + 1} host={feeRowHost} />
            ))}
            <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => addDraft('noInvoice')}>＋ Thêm chi phí</button>
          </section>

          <section className="ops-fee-block" aria-label="Phí có hóa đơn">
            <h3>Phí có hóa đơn</h3>
            {invoiceRows.length === 0 && <p className="ops-modal-hint">Chưa có khoản nào trong khối này.</p>}
            {invoiceRows.map((draft, index) => (
              <FeeRowFields key={draft.key} block="invoice" draft={draft} ordinal={noInvoiceRows.length + index + 1} host={feeRowHost} />
            ))}
            <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => addDraft('invoice')}>＋ Thêm chi phí</button>
          </section>

          {saveError && <p role="alert" className="ops-modal-hint">{saveError}</p>}
          {progress && <p role="status" className="ops-modal-hint">{progress}</p>}
          </fieldset>
        </div>

        <footer className="ops-modal__foot">
          <div>{`Tổng: ${formatMoney(total)} ₫`}</div>
          <div className="ops-modal__actions">
            <button type="button" className="btn btn--secondary" onClick={onClose} disabled={busy}>Đóng</button>
            <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
              {busy ? <Loader2 size={14} className="spin" /> : null} Lưu
            </button>
          </div>
        </footer>
      </form>
    </OpsModalBackdrop>
  );
}

/** One fee row's fields + its own optional photo set. Photos ride the row
 *  (they evidence THAT fee), stay optional, and are never required to save.
 *  Module scope so the component type stays STABLE across modal renders — a
 *  row defined inside the modal would remount on every keystroke. */
function FeeRowFields({ block, draft, ordinal, host }: {
block: 'noInvoice' | 'invoice'; draft: FeeDraft; ordinal: number; host: FeeRowHost;
}) {
const { typesData, typesReady, busy, patch: patchDraft, upload: uploadRowPhotos, remove: removeDraft, typeOptionsOf } = host;
  const invoiced = block === 'invoice';
  // The NumberField prints its own amount error inline — the row hint only
  // carries what the money field cannot say (type choice, the Ghi-chú rule,
  // unfinished uploads).
  const rawError = draftErrors(block, draft);
  const error = rawError?.startsWith('Số tiền') ? null : rawError;
  const photoUrls = useAuthedPhotoUrls(draft.photos.map((photo) => photo.storageKey));
  const fileRef = useRef<HTMLInputElement>(null);
  const type = typesData?.items.find((item) => item.code === draft.typeCode);
  return (
    <section className="ops-fee-row" aria-label={`Khoản ${ordinal}`}>
      <div className="ops-fee-row__grid">
        <UuiSelectField
          label="Loại phí"
          required
          disabled={!typesReady || busy}
          value={draft.typeCode}
          onChange={(event) => patchDraft(block, draft.key, { typeCode: event.target.value })}
          options={typeOptionsOf(block)}
        />
        <NumberField controlSize="sm" label="Thực chi (VND)" grouped signed value={draft.amount}
          onChange={(amount) => patchDraft(block, draft.key, { amount })}
          min={-999_999_999_999_999} max={999_999_999_999_999} step={1} required
          error={draft.amount === '' || amountValidOf(draft.amount) ? undefined
            : draft.amount === 0 ? 'Số tiền không được bằng 0'
            : 'Nhập số tiền nguyên'} />
        {invoiced ? <>
          <label className="ops-fee-row__field">
            Số hóa đơn
            <input
              value={draft.invoiceNumber}
              disabled={busy}
              maxLength={50}
              onChange={(event) => patchDraft(block, draft.key, { invoiceNumber: event.target.value })}
            />
          </label>
          <label className="ops-fee-row__field">
            Ngày hóa đơn
            <DateInput value={draft.invoiceDate} onChange={(invoiceDate) => patchDraft(block, draft.key, { invoiceDate })} disabled={busy} />
          </label>
        </> : <>
          <label className="ops-fee-row__field">
            Thực thu (thu khách)
            <input
              inputMode="numeric"
              placeholder="—"
              value={draft.charge}
              disabled={busy}
              onChange={(event) => patchDraft(block, draft.key, { charge: event.target.value })}
            />
          </label>
          <label className="ops-fee-row__field">
            Ghi chú thu khách
            <input
              value={draft.recoveryNote}
              disabled={busy}
              maxLength={1000}
              onChange={(event) => patchDraft(block, draft.key, { recoveryNote: event.target.value })}
            />
          </label>
        </>}
        <label className="ops-fee-row__field">
          Tên khoản chi
          <input
            value={draft.feeName}
            disabled={busy}
            maxLength={200}
            onChange={(event) => patchDraft(block, draft.key, { feeName: event.target.value })}
          />
        </label>
      </div>
      <ExpenseNameSuggestions group={(invoiced ? opsGroupForType(type) : 'OPS_REGULAR') as OpsCostGroup} disabled={busy} onChoose={(feeName) => patchDraft(block, draft.key, { feeName })} />
      <label className="ops-form-note">
        Ghi chú
        <textarea
          value={draft.note}
          disabled={busy}
          rows={2}
          onChange={(event) => patchDraft(block, draft.key, { note: event.target.value })}
        />
      </label>
      {chargeOf(block, draft, amountValidOf(draft.amount)) <= 0 && !invoiced
        && <p className="ops-modal-hint">Dòng chi này không thu khách hàng — ghi chú bắt buộc, ghi rõ lý do để kế toán / CUS đọc được.</p>}
      {/* A quiet hint, not role=alert: an untouched "+ row" must not keep a
          permanent alert alive over the whole form (the catalog-recovery
          contract clears its alert once the catalog reloads). */}
      {error && <p className="ops-modal-hint">{error}</p>}
      <div className="ops-form-photos">
        <div className="ops-form-photos__head">
          <span>Ảnh biên lai ({draft.photos.length})</span>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {draft.pendingFiles.length > 0 ? <Loader2 size={14} className="spin" /> : <Camera size={14} />}
            {draft.pendingFiles.length > 0 ? 'Đang tải…' : 'Chụp / chọn ảnh'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={(event) => void uploadRowPhotos(block, draft.key, event.target.files)}
          />
        </div>
        {draft.pendingFiles.length > 0 && !busy && <div className="expense-accounting-file" role="status"><span>{draft.pendingFiles.length} ảnh chưa tải thành công</span><button type="button" className="btn btn--secondary btn--sm" onClick={() => void uploadRowPhotos(block, draft.key, draft.pendingFiles)}>Thử tải lại ảnh</button><button type="button" className="btn btn--ghost btn--sm" onClick={() => patchDraft(block, draft.key, { pendingFiles: [] })}>Bỏ ảnh chưa tải</button></div>}
        {draft.photos.length > 0 && (
          <ul className="ops-form-photos__list">
            {draft.photos.map((photo, photoIndex) => (
              <li key={photo.storageKey}>
                <PhotoImage src={photoUrls[photoIndex]} alt={photo.name} />
                <button
                  type="button"
                  aria-label={`Xóa ${photo.name}`}
                  onClick={() => patchDraft(block, draft.key, { photos: draft.photos.filter((item) => item.storageKey !== photo.storageKey) })}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="btn btn--ghost btn--sm ops-fee-row__remove" disabled={busy} onClick={() => removeDraft(block, draft.key)}>Xóa dòng</button>
    </section>
  );
}

export default OpsExpenseFormModal;
