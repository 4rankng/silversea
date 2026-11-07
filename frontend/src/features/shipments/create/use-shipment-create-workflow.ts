import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../../lib/api';
import { useToast } from '../../../components/shared/Toast';
import {
  createShipmentDeclaration,
  getShipmentDetail,
  quickCreateShipment,
  saveShipmentContainers,
  submitShipmentForDispatch,
  updateShipment,
  updateShipmentDeclaration,
} from '../../../api/shipmentClient';
import type { OperationalSite, QuickCreateShipmentRequest } from '../../../api/shipmentClient';
import type { ShipmentReferenceConflict } from '../../../api/shipmentDuplicateClient';
import type { ShipmentEditSeed } from './shipment-edit-prefill';
import {
  buildShipmentContainerPayload,
  buildShipmentDeclarationPayload,
  buildShipmentRootPayload,
  type SaveIntent,
  type ShipmentContainerDraft,
  type ShipmentCreateFormState,
  type ShipmentCreateIssue,
  type ShipmentCreateReadiness,
  validateShipmentCreate,
} from './shipment-create-model';

interface SaveAttempt {
  createKey: string;
  submitKey: string;
  shipmentId?: number;
  version?: number;
  rootSignature?: string;
  containerSignature?: string;
  submitSignature?: string;
  pendingCreatePayload?: QuickCreateShipmentRequest;
  containerRecoveryNeeded?: boolean;
}

function signature(value: unknown) {
  return JSON.stringify(value);
}

function isAmbiguousCreateError(error: unknown) {
  return !(error instanceof ApiError) || error.status >= 500;
}

/**
 * SIL-171 edit seed: a signature value no real container payload can produce
 * (`JSON.stringify` of a container array always starts with '['). Seeding it
 * forces the FCL container reconcile to fire on the first edit save —
 * including the delete-all-rows case whose payload is `[]` and would
 * otherwise be skipped as "nothing to reconcile".
 */
const EDIT_CONTAINER_SENTINEL = '"__edit-seed__"';

interface UseShipmentCreateWorkflowArgs {
  form: ShipmentCreateFormState;
  containers: ShipmentContainerDraft[];
  sites: OperationalSite[];
  readiness: ShipmentCreateReadiness;
  onValidationIssues: (issues: ShipmentCreateIssue[]) => void;
  onSaved?: (shipmentId: number, intent: SaveIntent) => void;
  /**
   * SIL-171 (FB-147) edit mode: when set, the FIRST save starts from the
   * existing lot (id/version) instead of POST /shipments/quick
   * — the root reconcile PUT /shipments/:id (the lot PATCH) fires immediately,
   * and FCL container rows reconcile by their persisted ids. SIL-660: an LCL
   * seed also carries the lot's declaration entity state (rowId + stored
   * number) so the reconcile PUTs the row instead of POSTing a duplicate.
   * Validation is unchanged: the same create-form readiness gates the save.
   */
  editSeed?: ShipmentEditSeed;
  /**
   * Customer-facing note (two-note model). The shared create/update payload
   * builders live in `shipment-create-model.ts` and are not owned by this
   * surface, so the customer note is injected here at the workflow boundary
   * before the API call. The backend track accepts `customerNotes` on both
   * `POST /shipments/quick` and `PUT /shipments/:id`.
   */
  customerNotes?: string;
  /**
   * Server-side duplicate-reference conflict surfaced via the inline
   * warning. Returned alongside the regular `submitError` so the workspace
   * can attach a "Xem lô đã nhập" link in the toast and re-render the
   * inline warning (the inline effect may have raced the submit).
   */
  onDuplicateConflict?: (conflict: ShipmentReferenceConflict) => void;
}

/** Owns the durable create/retry state machine; presentation stays in the workspace. */
export function useShipmentCreateWorkflow({
  form,
  containers,
  sites,
  readiness,
  onValidationIssues,
  onSaved,
  editSeed,
  customerNotes,
  onDuplicateConflict,
}: UseShipmentCreateWorkflowArgs) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [saving, setSaving] = useState<SaveIntent | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicateConflict, setDuplicateConflict] = useState<ShipmentReferenceConflict | null>(null);
  const attemptRef = useRef<SaveAttempt | null>(null);
  /**
   * SIL-660: session-level declaration entity state. Deliberately NOT on the
   * save attempt: a fully-successful save clears `attemptRef`, and the entity
   * POST is a plain INSERT — attempt-scoped state would let the next save
   * POST a duplicate shipment_declarations row. Re-seeded from the edit seed
   * only when a DIFFERENT lot is loaded (identity-compared seed object).
   */
  const declarationSeedRef = useRef<ShipmentEditSeed | null | undefined>(undefined);
  const declarationStateRef = useRef<{ signature?: string; rowId?: number | null }>({});

  const clearFeedback = useCallback(() => {
    setSubmitError(null);
    setDuplicateConflict(null);
    onValidationIssues([]);
  }, [onValidationIssues]);

  const save = useCallback(async (intent: SaveIntent) => {
    const issues = validateShipmentCreate(intent, readiness);
    if (issues.length > 0) {
      setSubmitError(null);
      setDuplicateConflict(null);
      onValidationIssues(issues);
      return { issues };
    }
    onValidationIssues([]);
    setSaving(intent);
    setSubmitError(null);
    setDuplicateConflict(null);
    // SIL-660: re-seed the declaration entity state when the pinned lot
    // changes (new edit seed object) — never after a mere attempt reset.
    if (declarationSeedRef.current !== editSeed) {
      declarationSeedRef.current = editSeed;
      declarationStateRef.current = editSeed?.declaration
        ? {
            rowId: editSeed.declaration.rowId,
            // The STORED state's signature: an edit save that didn't touch
            // số tờ khai fires no entity write (unlike containers, the
            // declaration is a single-row upsert, so re-asserting an
            // unchanged value would only be audit noise).
            signature: signature({ declarationNumber: editSeed.declaration.declarationNumber }),
          }
        : {};
    }
    try {
      // SIL-171 edit mode: seed the attempt from the loaded lot so the save
      // starts at the update/reconcile stage — the create branch below stays
      // unreachable for a seeded attempt (shipmentId/version are set).
      const attempt = attemptRef.current ?? (editSeed
        ? {
            createKey: crypto.randomUUID(),
            submitKey: crypto.randomUUID(),
            shipmentId: editSeed.shipmentId,
            version: editSeed.version,
            // undefined ≠ any payload signature → the root PUT fires on the
            // first save. The edit submit IS the lot PATCH.
            rootSignature: undefined,
            ...(editSeed.fclContainers ? { containerSignature: EDIT_CONTAINER_SENTINEL } : {}),
          }
        : { createKey: crypto.randomUUID(), submitKey: crypto.randomUUID() });
      attemptRef.current = attempt;
      const customerNotesValue = customerNotes?.trim() || null;
      const createPayload = {
        ...buildShipmentRootPayload(form, containers, sites),
        customerNotes: customerNotesValue,
      };
      const rootSignature = signature(createPayload);
      // Combined save: containers ride the create call so a containers
      // failure rolls the root back — no 0-cont orphan lots (20260918_13).
      const containerPayload = buildShipmentContainerPayload(form, containers);
      const containerSignature = signature(containerPayload);

      if (attempt.shipmentId == null || attempt.version == null) {
        // SIL-521: payload không còn declarationNumber — tờ khai hết nhập cấp lô.
        const recoveryPayload = attempt.pendingCreatePayload ?? {
          ...createPayload,
          containers: containerPayload,
        };
        attempt.pendingCreatePayload = recoveryPayload;
        let shipment: Awaited<ReturnType<typeof quickCreateShipment>>;
        try {
          shipment = await quickCreateShipment(recoveryPayload, attempt.createKey);
        } catch (error) {
          if (!isAmbiguousCreateError(error)) attemptRef.current = null;
          throw error;
        }
        attempt.shipmentId = shipment.id;
        attempt.version = shipment.version;
        // The create call already persisted this exact root payload (containers
        // ride it too), so the root is in sync — replaying it as an UPDATE is
        // redundant. Keeping `containers` in the compared payload mattered for
        // the same reason: without it the signatures never matched and EVERY
        // save issued a redundant PUT; for ad-hoc lots that PUT 400s
        // (updateShipment requires a positive customerId, the create allows null).
        attempt.rootSignature = rootSignature;
        attempt.pendingCreatePayload = undefined;
        // Containers landed with the root: the reconcile step below must not
        // replay them for this save.
        attempt.containerSignature = containerSignature;
      }
      if (attempt.rootSignature !== rootSignature) {
        // The update schema accepts customerId only as a positive int — an
        // ad-hoc lot (null) must OMIT the key so the server keeps the stored
        // identity instead of rejecting the whole PATCH.
        const updateBody: Parameters<typeof updateShipment>[1] = {
          expectedVersion: attempt.version,
          ...createPayload,
        };
        if (updateBody.customerId == null) delete updateBody.customerId;
        const updated = await updateShipment(attempt.shipmentId, updateBody);
        attempt.version = updated.version;
        attempt.rootSignature = rootSignature;
      }

      const shipmentId = attempt.shipmentId;
      let version = attempt.version;

      const mustReconcileContainers = containerPayload.length > 0
        || attempt.containerSignature != null || attempt.containerRecoveryNeeded === true;
      if (mustReconcileContainers && attempt.containerSignature !== containerSignature) {
        if (attempt.containerRecoveryNeeded) {
          const detail = await getShipmentDetail(shipmentId);
          version = detail.shipment.version;
          attempt.version = version;
          attempt.containerRecoveryNeeded = false;
        }
        try {
          const result = await saveShipmentContainers(shipmentId, { expectedVersion: version, containers: containerPayload });
          version = result.shipmentVersion;
          attempt.version = version;
          attempt.containerSignature = containerSignature;
        } catch (error) {
          attempt.containerRecoveryNeeded = true;
          throw error;
        }
      }
      // SIL-660 (owner ruling 02/11): the LCL lot-level declaration entity
      // write. Narrow revival of the pre-SIL-521 machine — LCL only (SIL-601:
      // lẻ = 1 lô 1 cont), FCL never reaches this branch (payload null). The
      // entity POST is a plain INSERT, so the row id is tracked on the
      // session-level ref: a seeded/known row PUTs, an unknown row POSTs once
      // and remembers (also across the attempt reset a successful save
      // performs). Safe against the optimistic-lock version: an LCL lot has
      // no container rows, so the service's empty-container copy-down syncs
      // nothing and never bumps the shipment version here.
      const declarationPayload = buildShipmentDeclarationPayload(form);
      if (declarationPayload != null) {
        const declarationSignature = signature(declarationPayload);
        const declarationState = declarationStateRef.current;
        if (declarationState.signature !== declarationSignature) {
          if (declarationState.rowId != null) {
            const updated = await updateShipmentDeclaration(shipmentId, declarationState.rowId, declarationPayload);
            declarationState.rowId = updated.id;
          } else if (declarationPayload.declarationNumber != null) {
            const created = await createShipmentDeclaration(shipmentId, declarationPayload);
            declarationState.rowId = created.id;
          }
          declarationState.signature = declarationSignature;
        }
      }

      if (intent === 'SUBMIT') {
        const submitPayload = {
          expectedVersion: version,
          operationalNote: form.operationalNotes || null,
        };
        const submitSignature = signature(submitPayload);
        if (attempt.submitSignature != null && attempt.submitSignature !== submitSignature) attempt.submitKey = crypto.randomUUID();
        attempt.submitSignature = submitSignature;
        await submitShipmentForDispatch(shipmentId, submitPayload, attempt.submitKey);
      }
      attemptRef.current = null;
      if (onSaved) onSaved(shipmentId, intent);
      // FB-080 (card 091026180900): land on the lot just created, never the
      // queue-ranked list — the workspace's operational default sort puts
      // unscheduled lots first, so a newly created DATED lot sat on page 2+ of
      // Tổng quan and the creator could not find it. The detail page IS the
      // confirmation the intake succeeded.
      else navigate(`/shipments/${shipmentId}`);
      return { issues: [] as ShipmentCreateIssue[] };
    } catch (error) {
      // Customer feedback 2026-09-07: when the server rejects a duplicate
      // Bill/Booking/declaration, surface the structured conflict payload
      // so the workspace can render "Xem lô đã nhập" alongside the toast.
      // We still set `submitError` for any other failure mode.
      const conflict = extractDuplicateConflict(error);
      if (conflict) {
        setDuplicateConflict(conflict);
        setSubmitError(null);
        onDuplicateConflict?.(conflict);
      } else {
        const message = error instanceof Error && error.message.trim() ? error.message : 'Không thể lưu lô hàng. Vui lòng thử lại.';
        setSubmitError(message);
        // SIL-472 (QA fail 06/11, build dcaa8295): the banner renders at the
        // TOP of the worksheet while "Lưu thay đổi" lives in the
        // viewport-fixed footer — an operator deleting a container row
        // mid-form never scrolls back up, so the BE 409 refusal ("Cont có tờ
        // khai … gỡ tờ khai trước khi xóa") read as a SILENT no-op and the
        // form looked saved. The error toast is the in-viewport voice (error
        // toasts persist until dismissed); the top banner stays for a11y and
        // the pinned suites.
        toast({ kind: 'error', message });
      }
      return { issues: [] as ShipmentCreateIssue[] };
    } finally {
      setSaving(null);
    }
  }, [containers, customerNotes, editSeed, form, navigate, onDuplicateConflict, onSaved, onValidationIssues, readiness, sites, toast]);

  return { clearFeedback, reportError: setSubmitError, save, saving, submitError, duplicateConflict };
}

function extractDuplicateConflict(error: unknown): ShipmentReferenceConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  // The server surfaces `code` and `conflict` as top-level keys on the JSON
  // body (see `globalErrorHandler`'s `payload` merge). When the form
  // doesn't include the structured keys, fall back to a null — the
  // workspace can still display the raw `error.message`.
  const body = error.raw;
  if (!body || typeof body !== 'object') return null;
  const code = (body as { code?: unknown }).code;
  if (code !== 'SHIPMENT_REFERENCE_DUPLICATE') return null;
  const conflict = (body as { conflict?: unknown }).conflict;
  if (!conflict || typeof conflict !== 'object') return null;
  return conflict as ShipmentReferenceConflict;
}
