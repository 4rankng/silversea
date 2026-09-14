import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { normalizeContainerNumber } from '@tingting/shared';
import { useCreateForwarderContainer } from '../../hooks/useQueries';
import { checkContainerNumber } from '../../components/trip/container-instance-helpers';

export interface ForwarderContainerFormState {
  containerNumber: string;
  sealNumber: string;
  notes: string;
}

const emptyContainerForm = (): ForwarderContainerFormState => ({
  containerNumber: '',
  sealNumber: '',
  notes: '',
});

/** Why an add was blocked — Vietnamese copy matches the driver card's. */
export interface ForwarderContainerFormError {
  message: string;
  /** One-tap correction when the shared validator could infer the intent. */
  suggestion: string | null;
}

export interface ForwarderContainerFormController {
  show: boolean;
  setShow: Dispatch<SetStateAction<boolean>>;
  form: ForwarderContainerFormState;
  setForm: Dispatch<SetStateAction<ForwarderContainerFormState>>;
  add: () => void;
  pending: boolean;
  /** True when the open form holds any unsaved input. */
  isDirty: boolean;
  /** Entry-boundary validation result — the input stays for correction. */
  error: ForwarderContainerFormError | null;
  /** Applies the suggested correction and clears the error. */
  applySuggestion: () => void;
}

/**
 * Add-container form for a forwarder trip: number + seal + notes. The number
 * passes the SAME shared ISO 6346 check the trip form and the batch PUT
 * enforce (format + check digit) BEFORE any request — a rejected add leaves
 * the input untouched for correction and never reaches the server, so no
 * container or cost group can appear from an invalid number.
 */
export function useForwarderContainerForm(tripId: number): ForwarderContainerFormController {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(emptyContainerForm);
  const [error, setError] = useState<ForwarderContainerFormError | null>(null);
  const createContainerMut = useCreateForwarderContainer();

  const add = useCallback(() => {
    const trimmed = form.containerNumber.trim();
    if (!trimmed) {
      setError({ message: 'Số container không được để trống', suggestion: null });
      return;
    }
    const status = checkContainerNumber(trimmed);
    if (status.warning) {
      setError({ message: status.warning, suggestion: status.suggestion });
      return;
    }
    setError(null);
    createContainerMut.mutate(
      {
        tripId,
        data: {
          // Canonical form on the wire — the server revalidates and persists
          // the normalized number too, but the FE sends it pre-normalized so
          // a retry can never diverge from what validation approved.
          containerNumber: normalizeContainerNumber(trimmed),
          sealNumber: form.sealNumber || undefined,
          notes: form.notes || undefined,
        },
      },
      { onSuccess: () => { setForm(emptyContainerForm()); setShow(false); } },
    );
  }, [createContainerMut, form, tripId]);

  const applySuggestion = useCallback(() => {
    if (!error?.suggestion) return;
    setForm((current) => ({ ...current, containerNumber: error.suggestion! }));
    setError(null);
  }, [error]);

  return {
    show,
    setShow,
    form,
    setForm,
    add,
    pending: createContainerMut.isPending,
    isDirty: show && Boolean(form.containerNumber || form.sealNumber || form.notes),
    error,
    applySuggestion,
  };
}
