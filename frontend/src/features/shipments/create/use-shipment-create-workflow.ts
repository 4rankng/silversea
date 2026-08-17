import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../../lib/api';
import {
  createShipmentDeclaration,
  getShipmentDetail,
  quickCreateShipment,
  saveShipmentContainers,
  submitShipmentForDispatch,
  updateShipment,
  updateShipmentDeclaration,
} from '../../../api/shipmentClient';
import type { OperationalSite } from '../../../api/shipmentClient';
import {
  buildShipmentContainerPayload,
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
  declarationId?: number;
  declarationSignature?: string;
  containerSignature?: string;
  submitSignature?: string;
  pendingCreatePayload?: ReturnType<typeof buildShipmentRootPayload>;
  containerRecoveryNeeded?: boolean;
}

function signature(value: unknown) {
  return JSON.stringify(value);
}

function isAmbiguousCreateError(error: unknown) {
  return !(error instanceof ApiError) || error.status >= 500;
}

interface UseShipmentCreateWorkflowArgs {
  form: ShipmentCreateFormState;
  containers: ShipmentContainerDraft[];
  sites: OperationalSite[];
  readiness: ShipmentCreateReadiness;
  onValidationIssues: (issues: ShipmentCreateIssue[]) => void;
  onSaved?: (shipmentId: number, intent: SaveIntent) => void;
  /**
   * Customer-facing note (two-note model). The shared create/update payload
   * builders live in `shipment-create-model.ts` and are not owned by this
   * surface, so the customer note is injected here at the workflow boundary
   * before the API call. The backend track accepts `customerNotes` on both
   * `POST /shipments/quick` and `PUT /shipments/:id`.
   */
  customerNotes?: string;
}

/** Owns the durable create/retry state machine; presentation stays in the workspace. */
export function useShipmentCreateWorkflow({
  form,
  containers,
  sites,
  readiness,
  onValidationIssues,
  onSaved,
  customerNotes,
}: UseShipmentCreateWorkflowArgs) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState<SaveIntent | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const attemptRef = useRef<SaveAttempt | null>(null);

  const clearFeedback = useCallback(() => {
    setSubmitError(null);
    onValidationIssues([]);
  }, [onValidationIssues]);

  const save = useCallback(async (intent: SaveIntent) => {
    const issues = validateShipmentCreate(intent, readiness);
    if (issues.length > 0) {
      setSubmitError(null);
      onValidationIssues(issues);
      return { issues };
    }
    onValidationIssues([]);
    setSaving(intent);
    setSubmitError(null);
    try {
      const attempt = attemptRef.current ?? { createKey: crypto.randomUUID(), submitKey: crypto.randomUUID() };
      attemptRef.current = attempt;
      const customerNotesValue = customerNotes?.trim() || null;
      const createPayload = {
        ...buildShipmentRootPayload(form, containers, sites),
        customerNotes: customerNotesValue,
      };
      const rootSignature = signature(createPayload);

      if (attempt.shipmentId == null || attempt.version == null) {
        const recoveryPayload = attempt.pendingCreatePayload ?? createPayload;
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
        attempt.rootSignature = signature(recoveryPayload);
        attempt.pendingCreatePayload = undefined;
      }
      if (attempt.rootSignature !== rootSignature) {
        const updated = await updateShipment(attempt.shipmentId, { expectedVersion: attempt.version, ...createPayload });
        attempt.version = updated.version;
        attempt.rootSignature = rootSignature;
      }

      const shipmentId = attempt.shipmentId;
      let version = attempt.version;
      const declarationSignature = form.declarationNumber.trim();
      if (attempt.declarationSignature !== declarationSignature && (declarationSignature || attempt.declarationId != null)) {
        const declarationPayload = { declarationNumber: declarationSignature || null, scope: 'SINGLE' } as const;
        const declaration = attempt.declarationId == null
          ? await createShipmentDeclaration(shipmentId, declarationPayload)
          : await updateShipmentDeclaration(shipmentId, attempt.declarationId, declarationPayload);
        attempt.declarationId = declaration.id;
        attempt.declarationSignature = declarationSignature;
      }

      const containerPayload = buildShipmentContainerPayload(form, containers);
      const containerSignature = signature(containerPayload);
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
      else navigate('/shipments');
      return { issues: [] as ShipmentCreateIssue[] };
    } catch (error) {
      setSubmitError(error instanceof Error && error.message.trim() ? error.message : 'Không thể lưu lô hàng. Vui lòng thử lại.');
      return { issues: [] as ShipmentCreateIssue[] };
    } finally {
      setSaving(null);
    }
  }, [containers, customerNotes, form, navigate, onSaved, onValidationIssues, readiness, sites]);

  return { clearFeedback, reportError: setSubmitError, save, saving, submitError };
}
