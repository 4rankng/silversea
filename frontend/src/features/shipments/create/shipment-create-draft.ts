import { useCallback, useEffect, useRef } from 'react';
import {
  createEmptyContainer,
  EMPTY_SHIPMENT_CREATE_FORM,
  type CargoMode,
  type ShipmentContainerDraft,
  type ShipmentCreateFormState,
} from './shipment-create-model';

/**
 * UX-03 (QA 28/11, staging): the create worksheet's typed draft survives a
 * refresh. The form state is mirrored into sessionStorage keyed per mode
 * (FCL/LCL) while the form is dirty, and restored on the next mount of the
 * same tab. The restore is gated on a marker that only the hook's own
 * beforeunload listener writes: sessionStorage outlives the component ONLY
 * across a refresh, so in-app leaves — which always pass the leave guard —
 * never silently resurrect a form the operator explicitly discarded.
 */

const MODES: readonly CargoMode[] = ['FCL', 'LCL'];
const DRAFT_PREFIX = 'sil.shipment-create-draft.v1:';
const RESTORABLE_KEY = `${DRAFT_PREFIX}restorable`;
const SAVE_DEBOUNCE_MS = 300;

export interface ShipmentCreateDraftState {
  form: ShipmentCreateFormState;
  containers: ShipmentContainerDraft[];
  customerNotes: string;
}

interface StoredDraft extends ShipmentCreateDraftState {
  v: 1;
  savedAt: number;
}

function readItem(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string | null): void {
  try {
    if (value == null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Quota / private mode: the draft is best-effort; the leave guard (the
    // ask-before-leaving layer) never depends on it.
  }
}

function draftKey(mode: CargoMode): string {
  return `${DRAFT_PREFIX}${mode}`;
}

export function markDraftRestorable(): void {
  writeItem(RESTORABLE_KEY, '1');
}

export function saveCreateDraft(
  mode: CargoMode,
  form: ShipmentCreateFormState,
  containers: ShipmentContainerDraft[],
  customerNotes: string,
): void {
  const stored: StoredDraft = { v: 1, savedAt: Date.now(), form, containers, customerNotes };
  writeItem(draftKey(mode), JSON.stringify(stored));
}

export function clearCreateDraft(mode: CargoMode): void {
  writeItem(draftKey(mode), null);
}

export function clearAllCreateDrafts(): void {
  for (const mode of MODES) clearCreateDraft(mode);
  writeItem(RESTORABLE_KEY, null);
}

/** Merges a stored draft over the pristine shape so a draft written by an
 *  older build never leaves a newer form field `undefined` for the controlled
 *  inputs, and never carries a mode key the payload does not match. */
function parseStoredDraft(raw: string | null, mode: CargoMode): StoredDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDraft> | null;
    if (!parsed || parsed.v !== 1 || typeof parsed.savedAt !== 'number') return null;
    if (!parsed.form || typeof parsed.form !== 'object' || !Array.isArray(parsed.containers)) return null;
    const storedForm = parsed.form as Partial<ShipmentCreateFormState>;
    const form: ShipmentCreateFormState = { ...EMPTY_SHIPMENT_CREATE_FORM, ...storedForm };
    if (form.cargoMode !== mode) return null;
    const rawContainers: unknown[] = parsed.containers;
    // A FCL worksheet must always mount at least one row (the table has no
    // add-first-row affordance; LCL's preview reads row 0) — an empty stored
    // array normalizes to one fresh row instead of a zero-row table.
    const containers = rawContainers.length > 0
      ? rawContainers.map((row) => ({
          ...createEmptyContainer(),
          ...((row && typeof row === 'object' ? row : {}) as Partial<ShipmentContainerDraft>),
        }))
      : [createEmptyContainer()];
    return {
      v: 1,
      savedAt: parsed.savedAt,
      form,
      containers,
      customerNotes: typeof parsed.customerNotes === 'string' ? parsed.customerNotes : '',
    };
  } catch {
    return null;
  }
}

/** Newest draft across both mode keys — an LCL draft saved last wins over a
 *  stale FCL one, so the restored form always comes back in the mode the
 *  operator last worked in (cargoMode rides the draft itself). */
export function loadNewestCreateDraft(): StoredDraft | null {
  let newest: StoredDraft | null = null;
  for (const mode of MODES) {
    const draft = parseStoredDraft(readItem(draftKey(mode)), mode);
    if (draft && (newest === null || draft.savedAt >= newest.savedAt)) newest = draft;
  }
  return newest;
}

interface UseShipmentCreateDraftArgs {
  /** Create mode only — the edit form measures dirt against its prefilled
   *  baseline and must never seed from a previous session's draft. */
  active: boolean;
  dirty: boolean;
  form: ShipmentCreateFormState;
  containers: ShipmentContainerDraft[];
  customerNotes: string;
  applyDraft: (draft: ShipmentCreateDraftState) => void;
}

export function useShipmentCreateDraft({
  active,
  dirty,
  form,
  containers,
  customerNotes,
  applyDraft,
}: UseShipmentCreateDraftArgs) {
  const restoreAttemptedRef = useRef(false);

  // One-shot restore on mount: only a refresh (restorable marker written by
  // the beforeunload listener below) may resurrect the draft.
  useEffect(() => {
    if (!active || restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    if (readItem(RESTORABLE_KEY) !== '1') return;
    const draft = loadNewestCreateDraft();
    writeItem(RESTORABLE_KEY, null);
    if (draft) {
      applyDraft({ form: draft.form, containers: draft.containers, customerNotes: draft.customerNotes });
    }
  }, [active, applyDraft]);

  // Mirror the typed state per mode while dirty; the debounce keeps the
  // keystroke path off the storage main thread. Restoring the draft re-runs
  // this effect and re-saves the same content — harmless.
  useEffect(() => {
    if (!active || !dirty) return;
    const timer = window.setTimeout(() => {
      saveCreateDraft(form.cargoMode, form, containers, customerNotes);
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, dirty, containers, customerNotes, form]);

  // The refresh fence: beforeunload is the one signal that this tab is about
  // to keep its sessionStorage into a fresh mount of the same form.
  useEffect(() => {
    if (!active || !dirty) return;
    const mark = () => { markDraftRestorable(); };
    window.addEventListener('beforeunload', mark);
    return () => window.removeEventListener('beforeunload', mark);
  }, [active, dirty]);

  const clearAllDrafts = useCallback(() => { clearAllCreateDrafts(); }, []);
  const clearModeDraft = useCallback((mode: CargoMode) => { clearCreateDraft(mode); }, []);
  return { clearAllDrafts, clearModeDraft };
}
