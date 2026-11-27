import { PhotoImage } from '../../components/shared/PhotoImage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Loader2, Trash2, X } from 'lucide-react';
import { useOpsExpenseTypes, useOpsContainerClaimants, useOpsExpenseDuplicateProbe, useCreateOpsExpense, useCreateOpsExpenseType } from '../../hooks/useOpsQueries';
import { opsClient, type OpsOrderItem, type OpsExpenseDuplicateHit } from '../../api/opsClient';
import { compressImageFile } from '../../lib/imageCompression';
import { opsContainerScopeLabel } from '../../lib/opsContainerScope';
import { useAuthedPhotoUrls } from '../../lib/api/photo';
import { useToast } from '../../components/shared/Toast';
import { actionErrorMessage, toastActionError } from '../../lib/api/action-error';
import { ApiError } from '../../lib/api/errors';
import { localDateInputValue } from './opsStatus';
import { formatMoney } from '../../lib/format';
import { Tabs } from '../../design-system';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { DateInput } from '../../design-system/forms/DateInput';
import { NumberField } from '../../design-system/forms/NumberField';
import { SearchableMultiSelect } from '../../design-system/forms/SearchableMultiSelect';

import './ops-modal.css';
import { OpsModalBackdrop } from './OpsModalBackdrop';
import { opsGroupForType } from './OpsExpenseFinancialFields';
import { getModernRole } from '../../lib/role-helpers';
import { useAuth } from '../../hooks/useAuth';
import { Role } from '@tingting/shared';
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
 *  keeps the ordinary red-toast handling.
 *  SIL-1059 r2 (QA 26/11 build d568cbae, lô QBDP-2511-01) — the NO-INVOICE
 *  family's hard bounce (OPS_EXPENSE_TYPE_CONFLICT, Ticket 18/11 Task 4.1)
 *  is the same duplicate QUESTION for the operator: QA saw only the plain
 *  inline line because the panel never opened for that code. Both codes
 *  carry the same `duplicates` payload, so both open the yellow panel (KB
 *  §5.7.2: headline names the fee type first, [Kiểm tra lại] / [Tiếp tục
 *  lưu], [Lưu] locked while open). The BE law is untouched — the hard gate
 *  still refuses the family; a confirmed resend it refuses again falls to
 *  the inline error (saveFrom never re-opens the panel after a confirm). */
export function opsDuplicateHitsFromError(error: unknown): OpsExpenseDuplicateHit[] | null {
  if (error instanceof ApiError && error.status === 409) {
    const raw = error.raw as { code?: unknown; duplicates?: unknown } | null;
    if ((raw?.code === 'OPS_EXPENSE_DUPLICATE' || raw?.code === 'OPS_EXPENSE_TYPE_CONFLICT')
      && Array.isArray(raw.duplicates) && raw.duplicates.length > 0) {
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

/** SIL-1059 — the fee type of the earlier row. The duplicate panel names it
 *  FIRST: the operator's question is "which fee is already on this scope?",
 *  and the old headline ("ĐÃ ĐƯỢC … NHẬP TRƯỚC ĐÓ") never named the fee. */
export function opsDuplicateFeeName(hit: OpsExpenseDuplicateHit): string {
  return hit.expenseTypeName?.trim() || 'Loại phí';
}

/** SIL-1059 — the duplicate-invoice sentence, ONE string shared by the row
 *  hint and the footer reason so the two can never drift. The duplicate lives
 *  inside THIS entry (two rows of one lần nhập carry one number), which the
 *  old "trên lô này" wording got wrong. */
const INVOICE_DUPLICATE_MSG = 'Trùng số hóa đơn trong cùng lần nhập — không thể lưu trùng.';

/** Card 191026160000 — one fee line of the mockup's two blocks. Block
 *  placement owns the extra pair (Phí không hóa đơn carries the Thực-thu
 *  side). KB §10.6.4 (SIL-949): "ô chứng từ" is the "Có hóa đơn" FLAG — on
 *  both tabs it reveals the Số hóa đơn entry and makes it required; a
 *  flag-off row carries no invoice number at all. SIL-760: the row is ONE
 *  horizontal table line with the six spec columns, so the former
 *  Tên-khoản-chi/Gợi-ý and Ngày-hóa-đơn entries are gone — feeName saves
 *  undefined and invoiceDate stays null exactly as an untouched field did. */
interface FeeDraft {
  key: number;
  typeCode: string;
  amount: number | '';
  /** Thực thu — thu khách (no-invoice block). Display text, parsed server-side. */
  charge: string;
  invoiceNumber: string;
  note: string;
  /** Ghi chú thu khách — the dispatch-board note surface (card 20260921_5). */
  recoveryNote: string;
  photos: PendingPhoto[];
  pendingFiles: File[];
}

function blankFeeDraft(key: number): FeeDraft {
  return {
    key, typeCode: '', amount: '', charge: '', invoiceNumber: '',
    note: '', recoveryNote: '', photos: [], pendingFiles: [],
  };
}

/** Card 211026213838 — POSITIVE integer VND only (PRD OpsVanHanh "Số tiền":
 *  số nguyên dương; số âm không phải dữ liệu nhập của ô chi). Supersedes the
 *  card-20260928_197 signed rule on this Ops form; 0 stays rejected — 0 is an
 *  empty row, not an amount. */
function amountValidOf(amount: number | ''): boolean {
  return amount !== '' && Number.isSafeInteger(amount) && amount > 0 && amount <= 999_999_999_999_999;
}

/** The customer charge the SERVER will derive for this draft (card 20260928_162
 *  client mirror): invoice rows charge the amount; no-invoice rows charge only
 *  their Thực-thu override. Kept for the "Thực thu không âm" field check —
 *  it no longer gates Ghi chú (SIL-777: note is always optional). */
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
    && draft.note.trim() === ''
    && draft.recoveryNote.trim() === ''
    && draft.photos.length === 0;
}

/** CR-010.1 (BUG-08) — the required-invoice message, pinned by the B3 test;
 *  SIL-907 shares the constant with the field flag so the red border always
 *  rides exactly the message that names the Số hóa đơn cell. */
const INVOICE_REQUIRED_MSG = 'Số hóa đơn là bắt buộc với phí có hóa đơn.';

function draftErrors(block: 'noInvoice' | 'invoice', draft: FeeDraft): string | null {
  if (isEmptyDraft(draft)) return null;
  const valid = amountValidOf(draft.amount);
  if (!draft.typeCode) return 'Chọn "Loại phí".';
  if (!valid) return draft.amount === ''
    ? 'Nhập số tiền nguyên, tối đa 999.999.999.999.999đ'
    : draft.amount === 0 ? 'Số tiền không được bằng 0'
    : draft.amount < 0 ? 'Số tiền không được âm'
    : 'Nhập số tiền nguyên, tối đa 999.999.999.999.999đ';
  const charge = chargeOf(block, draft, valid);
  if (Number.isNaN(charge) || charge < 0) return '"Thực thu (thu khách)" phải là số không âm.';
  // Tab determines invoice status exclusively: only the 'invoice' tab requires Số hóa đơn.
  if (block === 'invoice') {
    const invoice = draft.invoiceNumber.trim();
    if (invoice === '' || !/\d/.test(invoice)) return INVOICE_REQUIRED_MSG;
  }
  if (draft.pendingFiles.length > 0) return 'Ảnh biên lai chưa tải xong — bấm "Thử tải lại ảnh" hoặc "Bỏ ảnh chưa tải".';
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
  /** SIL-761 — false for an OPS viewer: the row renders without the
   *  Thực-thu / Ghi-chú-thu-khách pair (their payloads leave the charge
   *  override unset, which the server derives as 0). */
  customerFields: boolean;
  patch: (block: 'noInvoice' | 'invoice', key: number, patch: Partial<FeeDraft> | ((row: FeeDraft) => Partial<FeeDraft>)) => void;
  upload: (block: 'noInvoice' | 'invoice', rowKey: number, files: FileList | File[] | null) => void;
  remove: (block: 'noInvoice' | 'invoice', key: number) => void;
  typeOptionsOf: (block: 'noInvoice' | 'invoice') => Array<{ value: string; label: string; disabled?: boolean }>;
  /** SIL-813 — persist a typed fee name into the block's catalog and select
   *  it on this row; the toast names the outcome (new vs already existed). */
  addType: (block: 'noInvoice' | 'invoice', rowKey: number, rawName: string) => Promise<void>;
  /** True while the catalog create is in flight — the inline editor disables. */
  typeCreating: boolean;
  /** Ticket 18/11 Task 4.1 — typeCodes declared twice on the no-invoice tab;
   *  those rows carry the same-type-per-container block error. */
  noInvoiceDuplicateTypes: ReadonlySet<string>;
  /** SIL-861 — Số hóa đơn values declared twice on the invoice tab; those
   *  rows carry the duplicate-invoice block error (pre-save, like the
   *  no-invoice duplicate-type gate). */
  invoiceDuplicateNumbers: ReadonlySet<string>;
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
  const createType = useCreateOpsExpenseType();
  const { toast } = useToast();
  // SIL-761 — the thu-khách pair belongs to CUS/chứng từ, not the Ops field
  // declaration: an OPS account (getModernRole folds the legacy FORWARDER
  // name into OPS) gets the row WITHOUT Thực thu / Ghi chú thu khách, while
  // CUS/ADMIN/MANAGER — who open this same popup from the lot drawer
  // (SIL-748) — keep the fields exactly as before.
  const auth = useAuth();
  const opsViewer = getModernRole(auth?.user?.role ?? '') === Role.OPS;

  // SIL-844 (id 973) — picker lists EVERY container row of the lot (số đính
  // kèm sau vẫn là cont: hạch toán theo cont đi bằng id, không cần số đã
  // cập nhật). Lô chưa có dòng cont nào (LCL, FCL pre-container) thì picker
  // không có gì để chọn — phạm vi chung lô là scope đúng duy nhất, kèm hint.
  const pickerContainers = useMemo(
    () => order.containers
      ?? order.containerIds.map((id, index) => ({ id, number: order.containerNumbers[index] ?? null })),
    [order],
  );

  // Số Cont: multi-select with chọn-all (mockup "Được chọn all số cont").
  // SIL-861 (QA 23/11) — the popup opens with EVERY container row picked:
  // the fee rides the full set as ONE record (SIL-881), the picker's "N đã
  // chọn" count is truthful from the first paint, and a valid row saves
  // without a re-pick. Opening on 'Phí chung lô' instead made the trigger
  // claim one selection while the validator saw zero containers. A lot with
  // NO container rows keeps 'Phí chung lô' — the only scope it has.
  const [containerValues, setContainerValues] = useState<string[]>(() =>
    pickerContainers.length > 0
      ? pickerContainers.map((container) => String(container.id))
      : [LOT_CHOICE]);
  const [paidAt, setPaidAt] = useState(localDateInputValue());
  const [noInvoiceRows, setNoInvoiceRows] = useState<FeeDraft[]>([blankFeeDraft(draftKeySeq++)]);
  const [invoiceRows, setInvoiceRows] = useState<FeeDraft[]>([]);
  // SIL-760 — the two fee groups live on TABS, not stacked blocks. Rows keep
  // living in the modal-level state above, so switching tabs never drops a
  // half-typed line; the single footer Lưu gathers BOTH tabs in one submit.
  const [feeTab, setFeeTab] = useState<'noInvoice' | 'invoice'>('noInvoice');
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
    ...pickerContainers.map((container, index) => (
      { value: String(container.id), label: container.number ?? `Cont ${index + 1} (chưa có số)` }
    )),
  ]), [pickerContainers]);

  const allContainerValues = useMemo(
    () => pickerContainers.map((container) => String(container.id)),
    [pickerContainers],
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
      ?? pickerContainers.find((container) => container.id === containerId)?.number
      ?? String(containerId)
  );
  // SIL-881 — N yellow warnings collapse into ONE compact row: the claimed
  // conts group by previous entrant, so picking 5 conts prints one line, not
  // five ("Gộp 5 thành cảnh báo vàng thành 01 dòng gọn").
  const claimantWarningText = useMemo(() => {
    if (claimants.length === 0) return null;
    const contsByWho = new Map<string, string[]>();
    for (const claimant of claimants) {
      const who = claimant.paidByName?.trim() || 'người khác';
      const conts = contsByWho.get(who) ?? [];
      conts.push(claimantLabel(claimant.containerId));
      contsByWho.set(who, conts);
    }
    return [...contsByWho.entries()]
      .map(([who, conts]) => `Cont ${conts.join(', ')} đã có ${who} nhập trước`)
      .join('; ') + ' — bạn vẫn tiếp tục nhập chứ?';
  }, [claimants, claimantsQuery.data, pickerContainers]);

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

  // SIL-1059 r3 (QA 8574, lô 1221 "Đảo vỏ" 1.000 ₫ ×2 cont) — the duplicate
  // question must open BEFORE any submit: QA filled fee + amount, waited, and
  // saw only the amber cont line, because the yellow panel used to open on a
  // 409 alone. While the draft names a fee type, the dialog probes the exact
  // live rows the write gate checks (same type + same set-overlap scope — a
  // chung-lô draft probes the empty set, which never overlaps) and opens the
  // same yellow panel pre-save. The probe only asks earlier: a stale or
  // failed probe degrades to no warning and the POST's 409 stays the law.
  const probeTypeCodes = [...new Set(drafts.filter((draft) => draft.typeCode !== '').map((draft) => draft.typeCode))];
  const probeContainerIds = containerValues.includes(LOT_CHOICE) || containerValues.length === 0
    ? []
    : pickedContainerIds;
  const probeQuery = useOpsExpenseDuplicateProbe(order.id, probeTypeCodes, probeContainerIds);
  const probeHits = useMemo(() => {
    const seen = new Set<number>();
    const hits: OpsExpenseDuplicateHit[] = [];
    for (const item of probeQuery.data?.items ?? []) {
      for (const hit of item.duplicates) {
        if (seen.has(hit.id)) continue;
        seen.add(hit.id);
        hits.push(hit);
      }
    }
    return hits;
  }, [probeQuery.data]);
  // The operator's answer ([Kiểm tra lại] / [Tiếp tục lưu]) closes the
  // pre-save question for THIS scope+type; changing either asks again. It
  // must also keep the confirmed-resend refusal (a hard 409 after "Tiếp tục
  // lưu") from re-painting the panel — that refusal lands as the inline line.
  const probeKey = `${order.id}|${probeTypeCodes.slice().sort().join(',')}|${probeContainerIds.join(',')}`;
  const [probeDismissed, setProbeDismissed] = useState(false);
  useEffect(() => { setProbeDismissed(false); }, [probeKey]);

  // Ticket 18/11 Task 4.1 + SIL-861 (QA 23/11) — the form refuses a
  // container-less scope BEFORE Lưu instead of bouncing at the write path.
  // (a) EVERY fee on a container-lot carries an explicit Số-container SET:
  // the 'Phí chung lô' choice (or an empty pick) blocks with 'Bắt buộc chọn
  // Số container'. The no-invoice row was the double-charge shape the
  // duplicate gate refuses downstream; QA showed the invoice tab's 0-cont
  // submit sailing through as chung-lô (SIL-861 DEFECT A), so the gate now
  // covers both tabs. A lot with NO container rows at all keeps the lot
  // scope (the picker hint above names it).
  const noInvoiceHasRows = noInvoiceRows.some((draft) => !isEmptyDraft(draft));
  const invoiceHasRows = invoiceRows.some((draft) => !isEmptyDraft(draft));
  const scopeBlocked = (noInvoiceHasRows || invoiceHasRows)
    && pickerContainers.length > 0
    && pickedContainerIds.length === 0;
  // (b) The same cost TYPE twice for the SAME container is refused up front:
  // the container scope is shared by every row, so two non-blank no-invoice
  // rows with one typeCode would write that type twice per picked container
  // (the write path hard-409s the family). The INVOICE tab is untouched —
  // multiple rows of one type stay allowed there (warn-then-confirm).
  const noInvoiceDuplicateTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const draft of noInvoiceRows) {
      if (isEmptyDraft(draft) || !draft.typeCode) continue;
      counts.set(draft.typeCode, (counts.get(draft.typeCode) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([code]) => code));
  }, [noInvoiceRows]);
  // SIL-861 — a duplicated Số hóa đơn dies BEFORE Lưu: the write path only
  // bounces the duplicate after its siblings saved (the QA partial save), so
  // the same-lot duplicate must die in the draft stage like the no-invoice
  // duplicate type does. Many rows of one FEE TYPE stay allowed here — only
  // the invoice NUMBER is unique per lot. SIL-949 (KB §10.6.4): the number
  // now comes from any flag-on row on EITHER tab, so the gate spans both
  // blocks. An empty (or digitless) Số hóa đơn never reaches this map — it is
  // the CR-010.1 (BUG-08) required gate's business, not a duplicate.
  const invoiceDuplicateNumbers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const draft of invoiceRows) {
      if (isEmptyDraft(draft)) continue;
      const invoiceNo = draft.invoiceNumber.trim();
      if (invoiceNo === '') continue;
      counts.set(invoiceNo, (counts.get(invoiceNo) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([no]) => no));
  }, [invoiceRows]);
  // Per-row validity is block-dependent, so recompute with the right block.
  const invalidKeys = useMemo(() => {
    const keys = new Set<number>();
    for (const draft of noInvoiceRows) {
      if (draftErrors('noInvoice', draft) || noInvoiceDuplicateTypes.has(draft.typeCode)) keys.add(draft.key);
    }
    for (const draft of invoiceRows) {
      if (draftErrors('invoice', draft) || invoiceDuplicateNumbers.has(draft.invoiceNumber.trim())) keys.add(draft.key);
    }
    return keys;
  }, [noInvoiceRows, invoiceRows, noInvoiceDuplicateTypes, invoiceDuplicateNumbers]);
  const total = drafts.reduce((sum, draft) => sum + (amountValidOf(draft.amount) ? Number(draft.amount) : 0), 0);
  const anyPendingFiles = drafts.some((draft) => draft.pendingFiles.length > 0);
  // The catalog must be loaded AND every rendered row complete before the
  // batch goes out.
  const typesReady = typesQuery.isSuccess && Boolean(typesData?.items.length);
  // A form of untouched "+ rows" has nothing to save.
  const hasAnyRow = drafts.some((draft) => !isEmptyDraft(draft));
  // SIL-1059 — the yellow duplicate panel is a QUESTION the operator has to
  // answer ([Kiểm tra lại] / [Tiếp tục lưu]); until they do, the footer [Lưu]
  // stays locked so the same batch is never sent twice. The post-409 bounce
  // (duplicateHits) and the pre-save probe (probeHits) open the SAME panel;
  // a probe answer already dismissed by the operator does not re-ask itself.
  const panelHits = duplicateHits ?? (probeDismissed || probeHits.length === 0 ? null : probeHits);
  const duplicatePanelOpen = panelHits != null;
  const canSubmit = typesReady && hasAnyRow && invalidKeys.size === 0
    && !scopeBlocked && !createExpense.isPending && !anyPendingFiles && !duplicatePanelOpen;
  // SIL-723 — Lưu must never be disabled in silence: when a non-blank draft
  // blocks the save, the footer repeats the row's message (which NAMES the
  // missing field) right beside the button, so the dead state always says
  // what to fill. Amount messages stay out — NumberField prints its own
  // inline error and the footer must not duplicate it (OpsOrdersPage pin
  // getByText uniqueness). The catalog-loading cases stay on the body's own
  // status.
  const saveBlockedReason = useMemo(() => {
    if (!typesReady) return null;
    // SIL-1059 — Lưu is never disabled in silence: the open duplicate panel
    // says so first, so the operator knows the yellow box is what waits.
    if (duplicatePanelOpen) return 'Hộp cảnh báo trùng phí đang mở — bấm [Kiểm tra lại] để đóng, hoặc [Tiếp tục lưu] để ghi đè.';
    if (!hasAnyRow) return 'Chưa điền khoản chi nào — "Loại phí" và "Số tiền" là bắt buộc.';
    // Ticket 18/11 Task 4.1 — the no-invoice hard gates speak first: their
    // messages are the ones the disabled Lưu must name.
    if (scopeBlocked) return 'Bắt buộc chọn Số container';
    if (noInvoiceDuplicateTypes.size > 0) {
      const code = [...noInvoiceDuplicateTypes][0];
      const name = typesData?.items.find((type) => type.code === code)?.name ?? code;
      return `Trùng loại phí "${name}" trên cùng số cont — không lưu dòng trùng.`;
    }
    // SIL-861 — the invoice tab's own hard gate speaks in the same voice.
    if (invoiceDuplicateNumbers.size > 0) {
      return INVOICE_DUPLICATE_MSG;
    }
    for (const draft of noInvoiceRows) {
      const message = draftErrors('noInvoice', draft);
      if (message && !message.startsWith('Số tiền')) return message;
    }
    for (const draft of invoiceRows) {
      const message = draftErrors('invoice', draft);
      if (message && !message.startsWith('Số tiền')) return message;
    }
    return null;
  }, [typesReady, duplicatePanelOpen, hasAnyRow, scopeBlocked, noInvoiceDuplicateTypes, invoiceDuplicateNumbers, typesData, noInvoiceRows, invoiceRows]);

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

  /** One write task = one fee draft with its container SET (SIL-881: K conts
   *  + tổng X = ONE task/record; chung lô = empty set). The old per-cont
   *  fan-out multiplied money K× and is gone. */
  interface SaveTask {
    block: 'noInvoice' | 'invoice';
    rowKey: number;
    containerIds: number[];
    duplicateConfirmed?: boolean;
  }

  async function saveFrom(tasks: SaveTask[], startIndex: number, options: { duplicateConfirmed?: boolean } = {}) {
    if (savingRef.current) return;
    // SIL-1059 — the panel's [Tiếp tục lưu] is the ONE path allowed to write
    // while the yellow panel is open; every other submit respects canSubmit.
    if (!options.duplicateConfirmed && !canSubmit) return;
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
          // SIL-881 — ONE record with the picked set; amount stays as typed.
          shipmentContainerIds: task.containerIds,
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
          hasInvoice: task.block === 'invoice',
          invoiceNumber: task.block === 'invoice' ? draft.invoiceNumber.trim() || null : null,
          invoiceDate: null,
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
        // SIL-1059 r2 — the no-invoice hard gate refuses the confirmed resend
        // too (KB §5.4.2 chặn cứng). That second refusal must NOT re-open the
        // panel — the question was already answered — it lands here as the
        // ordinary inline error naming who entered what and the hard rule.
        const hits = opsDuplicateHitsFromError(error);
        if (hits && !options.duplicateConfirmed) {
          setDuplicateHits(hits);
          setProgress('');
          savingRef.current = false;
          pendingResume.current = { tasks, index };
          return;
        }
        setProgress('');
        const done = index - startIndex;
        const left = tasks.length - index;
        const reason = actionErrorMessage('lưu khoản chi', error, 'Chưa thể lưu khoản chi. Vui lòng thử lại.')
          ?? 'Chưa thể lưu khoản chi. Vui lòng thử lại.';
        setSaveError(done > 0
          ? `Đã lưu ${done} dòng. ${left} dòng chưa lưu: ${reason}`
          : reason);
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
    // SIL-881 — the picked set is the row's scope: K conts + tổng X lands as
    // ONE record with containerIds (never K rows × X). Chung lô = empty set.
    const containerIds = containerValues.includes(LOT_CHOICE) || containerValues.length === 0
      ? []
      : pickedContainerIds;
    const tasks: SaveTask[] = [];
    // Blank placeholder rows ("+ Thêm chi phí" left untouched) never save.
    for (const draft of noInvoiceRows) if (!isEmptyDraft(draft)) tasks.push({ block: 'noInvoice', rowKey: draft.key, containerIds });
    for (const draft of invoiceRows) if (!isEmptyDraft(draft)) tasks.push({ block: 'invoice', rowKey: draft.key, containerIds });
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
    setProbeDismissed(true);
    const tasks = resume.tasks.map((task, index) => (
      index === resume.index ? { ...task, duplicateConfirmed: true } : task));
    pendingResume.current = null;
    await saveFrom(tasks, resume.index, { duplicateConfirmed: true });
  }

  /** SIL-1059 r3 — [Tiếp tục lưu] from the PRE-SAVE panel: no write has been
   *  attempted yet, so the confirmed flag rides EVERY task of a fresh batch
   *  (the post-409 panel resumes pendingResume instead). The no-invoice
   *  family's hard gate refuses the confirmed resend too — that lands as the
   *  ordinary inline error, exactly like the post-409 refusal. */
  async function continueWithConfirmedDuplicates() {
    const tasks = buildTasks().map((task) => ({ ...task, duplicateConfirmed: true }));
    if (tasks.length === 0) return;
    setProbeDismissed(true);
    setDuplicateHits(null);
    pendingResume.current = null;
    await saveFrom(tasks, 0, { duplicateConfirmed: true });
  }

  /** [Kiểm tra lại] — close the open question (post-409 or pre-save) and
   *  re-run the probe so the next scope/type change answers from live rows. */
  function dismissDuplicatePanel() {
    setDuplicateHits(null);
    setProbeDismissed(true);
    void probeQuery.refetch();
  }

  /** SIL-813 — the creatable catalog: persist the typed name into the block's
   *  group ('Phí có hóa đơn' → requiresInvoice true, else false), then select
   *  the returned option on the row. An existing name (server dedupe) still
   *  selects — with an "already in the catalog" toast instead of an error. */
  async function addNewType(block: 'noInvoice' | 'invoice', rowKey: number, rawName: string) {
    const name = rawName.trim();
    if (!name) return;
    try {
      const result = await createType.mutateAsync({ name, requiresInvoice: block === 'invoice' });
      patchDraft(block, rowKey, { typeCode: result.item.code });
      toast({ kind: 'success', message: result.created
        ? `Đã thêm loại phí "${result.item.name}" vào danh mục ${block === 'invoice' ? '"Phí có hóa đơn"' : '"Phí không hóa đơn"'}.`
        : `Loại phí "${result.item.name}" đã có trong danh mục — đã chọn cho dòng này.` });
    } catch (error) {
      toastActionError(toast, 'thêm loại phí mới', error, 'Không thêm được loại phí mới.');
    }
  }

  const busy = createExpense.isPending || progress !== '';
  const feeRowHost: FeeRowHost = {
    typesData, typesReady, busy, customerFields: !opsViewer,
    patch: patchDraft, upload: uploadRowPhotos, remove: removeDraft, typeOptionsOf,
    addType: addNewType, typeCreating: createType.isPending,
    noInvoiceDuplicateTypes,
    invoiceDuplicateNumbers,
  };

  return (
    <OpsModalBackdrop onClose={() => { if (!savingRef.current && !busy) onClose(); }} ariaLabel="Khai báo chi phí">
      <form className="ops-modal ops-modal--wide" onSubmit={handleSubmit} noValidate>
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
          <div className="ops-form-grid ops-form-grid--3">
            <label>
              Số {order.tradeDirection === 'EXPORT' ? 'Booking' : 'Bill'}
              <input value={order.billRef?.trim() || 'Chưa có số Bill/Booking'} readOnly />
            </label>
            <label>
              Ngày chi *
              <DateInput value={paidAt} onChange={setPaidAt} required />
            </label>
            <div className="ops-cont-picker">
              <div className="ops-cont-picker__head">
                <span className="ops-cont-picker__label" id="ops-cont-picker-label">Số Cont</span>
                <label className="ops-cont-picker__all">
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả số cont"
                    checked={allContainersPicked}
                    disabled={pickerContainers.length === 0 || busy}
                    onChange={chooseAllContainers}
                  />
                  Chọn tất cả
                </label>
              </div>
              <SearchableMultiSelect
                id="ops-expense-cont-multiselect"
                size="sm"
                values={containerValues}
                onChange={setContainers}
                options={containerOptions}
                selectionLabel="số cont"
                clearAllLabel="Bỏ chọn tất cả"
                placeholder="Phí chung lô"
                disabled={busy || pickerContainers.length === 0}
              />
            </div>
          </div>
          {pickerContainers.length === 0 && (
            <p className="ops-modal-hint">Lô chưa có dòng cont để gắn chi phí — khoản ghi theo phạm vi chung lô.</p>
          )}

          {claimantWarningText != null && (
            <p className="ops-modal__warning" role="alert">{claimantWarningText}</p>
          )}

          {panelHits != null && (
            <div className="ops-modal__warning ops-modal__duplicate" role="alert">
              {/* SIL-1059 — the panel names the FEE TYPE first ("Phí nâng vỏ —
                  đã có Trần Thiên Dương nhập 1.500.000 ₫ · ngày 25/11/2026").
                  The old headline ("ĐÃ ĐƯỢC … NHẬP TRƯỚC ĐÓ") never said WHICH
                  fee was already on the scope. It opens from the write path's
                  409 (duplicateHits) AND from the pre-save probe (probeHits,
                  r3: QA filled the form, waited, and had to click [Lưu] into a
                  409 to see this box). */}
              <p>CHI PHÍ CÙNG LOẠI ĐÃ ĐƯỢC NHẬP TRƯỚC ĐÓ</p>
              <ul>
                {panelHits.map((hit) => (
                  <li key={hit.id}>
                    {`${opsDuplicateFeeName(hit)} — đã có ${opsDuplicateWho(hit)} nhập ${formatMoney(hit.amount)} ₫ · ngày ${hit.paidAt.split('-').reverse().join('/')} · ${opsContainerScopeLabel(hit.containerNumber, hit.containerNumbers)}`}
                  </li>
                ))}
              </ul>
              <p className="ops-modal-hint">Kiểm tra lại để tránh nhập trùng. Nếu đây là lần chi hợp lệ (ví dụ tách thanh toán), bấm Tiếp tục lưu.</p>
              <div className="ops-modal__duplicate-actions">
                <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={dismissDuplicatePanel}>Kiểm tra lại</button>
                <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => {
                  if (pendingResume.current != null) void resumeWithDuplicateConfirmed();
                  else void continueWithConfirmedDuplicates();
                }}>Tiếp tục lưu</button>
              </div>
            </div>
          )}

          {/* SIL-760 — the two fee blocks become centered tabs; only the
              active group's rows render, while both groups' drafts stay in
              modal state for the one shared Lưu. */}
          <div className="ops-modal__tabs">
            <Tabs
              variant="boxed"
              ariaLabel="Nhóm phí khai báo"
              value={feeTab}
              onChange={(id) => setFeeTab(id as 'noInvoice' | 'invoice')}
              tabs={[
                { id: 'noInvoice', label: 'PHÍ KHÔNG HÓA ĐƠN' },
                { id: 'invoice', label: 'PHÍ CÓ HÓA ĐƠN' },
              ]}
            />
          </div>

          {feeTab === 'noInvoice' ? (
            <section className="ops-fee-block" aria-label="Phí không hóa đơn">
              {noInvoiceRows.length === 0 && <p className="ops-modal-hint">Chưa có khoản nào trong khối này.</p>}
              {noInvoiceRows.map((draft, index) => (
                <FeeRowFields key={draft.key} block="noInvoice" draft={draft} ordinal={index + 1} host={feeRowHost} />
              ))}
              <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => addDraft('noInvoice')}>＋ Thêm chi phí</button>
            </section>
          ) : (
            <section className="ops-fee-block" aria-label="Phí có hóa đơn">
              {invoiceRows.length === 0 && <p className="ops-modal-hint">Chưa có khoản nào trong khối này.</p>}
              {invoiceRows.map((draft, index) => (
                <FeeRowFields key={draft.key} block="invoice" draft={draft} ordinal={index + 1} host={feeRowHost} />
              ))}
              <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => addDraft('invoice')}>＋ Thêm chi phí</button>
            </section>
          )}

          {saveError && <p role="alert" className="ops-modal-hint">{saveError}</p>}
          {progress && <p role="status" className="ops-modal-hint">{progress}</p>}
          </fieldset>
        </div>

        <footer className="ops-modal__foot">
          <div>
            {`Tổng: ${formatMoney(total)} ₫`}
            {saveBlockedReason && <p className="ops-modal-hint" role="status">{saveBlockedReason}</p>}
          </div>
          <div className="ops-modal__actions">
            <button type="button" className="btn btn--secondary btn--sm" onClick={onClose} disabled={busy}>Đóng</button>
            <button type="submit" className="btn btn--primary btn--sm" disabled={!canSubmit}>
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
 *  row defined inside the modal would remount on every keystroke.
 *
 *  SIL-760 — the row is ONE horizontal table line: Loại phí | Số tiền (VNĐ)*
 *  | Chứng từ — cờ "Có hóa đơn" | Số hóa đơn (khi cờ bật, cả 2 tab — KB
 *  §10.6.4, SIL-949) | Ghi chú | Ảnh chứng từ | Xóa. The customer-charge pair
 *  (Thực thu / Ghi chú thu khách) keeps its cell on the no-invoice line where
 *  the row renders it (SIL-761 role-gates it for Ops).
 *  Growing columns flex; the icon columns stay fixed, so narrow widths wrap
 *  whole cells instead of clipping one. */
function FeeRowFields({ block, draft, ordinal, host }: {
block: 'noInvoice' | 'invoice'; draft: FeeDraft; ordinal: number; host: FeeRowHost;
}) {
const { typesReady, busy, customerFields, patch: patchDraft, upload: uploadRowPhotos, remove: removeDraft, typeOptionsOf, addType, typeCreating, noInvoiceDuplicateTypes, invoiceDuplicateNumbers } = host;
  const invoiced = block === 'invoice';
  // SIL-813 — the inline "new fee type" editor for this row's catalog cell.
  const [addingType, setAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const commitNewType = () => {
    const name = newTypeName.trim();
    if (!name) return;
    void addType(block, draft.key, name);
    setAddingType(false);
    setNewTypeName('');
  };
  // The NumberField prints its own amount error inline — the row hint only
  // carries what the money field cannot say (type choice, the Ghi-chú rule,
  // unfinished uploads). Ticket 18/11 Task 4.1 — a no-invoice row whose type
  // is declared twice on the tab carries the same-type hard block too.
  // SIL-966 — the row's own photo law drives both the error and the * on the
  // Ảnh-chứng-từ caption.
  const rawError = draftErrors(block, draft);
  const error = rawError?.startsWith('Số tiền') ? null : rawError;
  const duplicateTypeError = block === 'noInvoice' && noInvoiceDuplicateTypes.has(draft.typeCode)
    ? 'Trùng loại phí trên cùng số cont — không lưu dòng trùng.'
    : null;
  const duplicateInvoiceError = invoiced && invoiceDuplicateNumbers.has(draft.invoiceNumber.trim())
    ? INVOICE_DUPLICATE_MSG
    : null;
  const invoiceInvalid = invoiced
    && (duplicateInvoiceError != null || rawError === INVOICE_REQUIRED_MSG);
  const photoUrls = useAuthedPhotoUrls(draft.photos.map((photo) => photo.storageKey));
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <section className="ops-fee-row" aria-label={`Khoản ${ordinal}`}>
      <div className="ops-fee-row__grid">
        <div className="ops-fee-row__field ops-fee-row__cell--type">
          <UuiSelectField
            label="Loại phí"
            required
            disabled={!typesReady || busy}
            value={draft.typeCode}
            onChange={(event) => patchDraft(block, draft.key, { typeCode: event.target.value })}
            options={typeOptionsOf(block)}
          />
          {/* SIL-813 — the catalog lacks a fee name Ops needs: typing it here
              persists it into THIS tab's group and selects it on the row. */}
          {addingType ? (
            <div className="ops-fee-row__newtype">
              <input
                aria-label="Tên loại phí mới"
                placeholder="Ví dụ: Phí rút cont"
                value={newTypeName}
                autoFocus
                maxLength={100}
                disabled={busy || typeCreating}
                onChange={(event) => setNewTypeName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); commitNewType(); }
                  if (event.key === 'Escape') { setAddingType(false); setNewTypeName(''); }
                }}
              />
              <button type="button" className="btn btn--primary btn--sm" disabled={!newTypeName.trim() || busy || typeCreating} onClick={commitNewType}>
                {typeCreating ? <Loader2 size={12} className="spin" /> : null} Thêm
              </button>
              <button type="button" className="btn btn--ghost btn--sm" disabled={typeCreating} onClick={() => { setAddingType(false); setNewTypeName(''); }}>Hủy</button>
            </div>
          ) : (
            <button type="button" className="btn btn--ghost btn--sm ops-fee-row__add-type" disabled={busy} onClick={() => setAddingType(true)}>+ Thêm loại phí mới</button>
          )}
        </div>
        <div className="ops-fee-row__field ops-fee-row__cell--amount">
          <NumberField controlSize="sm" label="Số tiền (VNĐ)" grouped value={draft.amount}
            onChange={(amount) => patchDraft(block, draft.key, { amount })}
            min={0} max={999_999_999_999_999} step={1} required
            /* SIL-1059 — spec §10.6.3: the amount field never carries a 0
               VALUE, it only shows the 0 as a hint. The empty draft keeps
               '' here, so the box opens empty with '0' as its placeholder. */
            placeholder="0"
            error={draft.amount === '' || amountValidOf(draft.amount) ? undefined
              : draft.amount === 0 ? 'Số tiền không được bằng 0'
              : draft.amount < 0 ? 'Số tiền không được âm'
              : 'Nhập số tiền nguyên'} />
        </div>
        {invoiced && (
          <label className="ops-fee-row__field ops-fee-row__cell--invoice-no">
            Số hóa đơn *
            <input
              value={draft.invoiceNumber}
              disabled={busy}
              maxLength={50}
              aria-invalid={invoiceInvalid || undefined}
              onChange={(event) => patchDraft(block, draft.key, { invoiceNumber: event.target.value })}
            />
          </label>
        )}
        {!invoiced && customerFields && <>
          <label className="ops-fee-row__field ops-fee-row__cell--charge">
            Thực thu (thu khách)
            <input
              inputMode="numeric"
              placeholder="—"
              value={draft.charge}
              disabled={busy}
              onChange={(event) => patchDraft(block, draft.key, { charge: event.target.value })}
            />
          </label>
          <label className="ops-fee-row__field ops-fee-row__cell--recovery">
            Ghi chú thu khách
            <input
              value={draft.recoveryNote}
              disabled={busy}
              maxLength={1000}
              onChange={(event) => patchDraft(block, draft.key, { recoveryNote: event.target.value })}
            />
          </label>
        </>}
        <label className="ops-fee-row__field ops-fee-row__cell--note">
          Ghi chú
          <input
            value={draft.note}
            disabled={busy}
            maxLength={1000}
            onChange={(event) => patchDraft(block, draft.key, { note: event.target.value })}
          />
        </label>
        <div className="ops-fee-row__field ops-fee-row__cell--attach">
          <span className="ops-fee-row__cell-caption">Ảnh chứng từ{draft.photos.length > 0 ? ` (${draft.photos.length})` : ''}</span>
          <button
            type="button"
            className="btn btn--secondary btn--icon btn--sm"
            aria-label="Chụp / chọn ảnh biên lai"
            title="Chụp / chọn ảnh biên lai"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {draft.pendingFiles.length > 0 ? <Loader2 size={14} className="spin" /> : <Camera size={14} />}
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
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm ops-fee-row__remove"
          aria-label={`Xóa dòng khoản ${ordinal}`}
          title="Xóa dòng"
          disabled={busy}
          onClick={() => removeDraft(block, draft.key)}
        ><Trash2 size={14} /></button>
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
      {/* SIL-777 (owner decision 09/11/2026) — the old "không thu khách → ghi
          chú bắt buộc" hint is gone with the gate: Ghi chú stays optional in
          every case; required fields are exactly Loại phí + Số tiền. */}
      {/* A quiet hint, not role=alert: an untouched "+ row" must not keep a
          permanent alert alive over the whole form (the catalog-recovery
          contract clears its alert once the catalog reloads). SIL-907 — the
          message wears the red error style (it used to render default-black). */}
      {(error ?? duplicateTypeError ?? duplicateInvoiceError) && <p className="ops-modal-hint ops-field-error">{error ?? duplicateTypeError ?? duplicateInvoiceError}</p>}
    </section>
  );
}

export default OpsExpenseFormModal;
