import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useCreateForwarderContainer } from '../../hooks/useQueries';

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

export interface ForwarderContainerFormController {
  show: boolean;
  setShow: Dispatch<SetStateAction<boolean>>;
  form: ForwarderContainerFormState;
  setForm: Dispatch<SetStateAction<ForwarderContainerFormState>>;
  add: () => void;
  pending: boolean;
  /** True when the open form holds any unsaved input. */
  isDirty: boolean;
}

/** Add-container form for a forwarder trip: number + seal + notes. */
export function useForwarderContainerForm(tripId: number): ForwarderContainerFormController {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(emptyContainerForm);
  const createContainerMut = useCreateForwarderContainer();

  const add = useCallback(() => {
    if (!form.containerNumber.trim()) return;
    createContainerMut.mutate(
      {
        tripId,
        data: {
          containerNumber: form.containerNumber,
          sealNumber: form.sealNumber || undefined,
          notes: form.notes || undefined,
        },
      },
      { onSuccess: () => { setForm(emptyContainerForm()); setShow(false); } },
    );
  }, [createContainerMut, form, tripId]);

  return {
    show,
    setShow,
    form,
    setForm,
    add,
    pending: createContainerMut.isPending,
    isDirty: show && Boolean(form.containerNumber || form.sealNumber || form.notes),
  };
}
