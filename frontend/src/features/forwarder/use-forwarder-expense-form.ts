import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '../../api/keys';
import { forwarderClient } from '../../api/forwarderClient';
import { useCreateForwarderExpense, useForwarderTripDetail } from '../../hooks/useQueries';
import { useUpdateForwarderExpense } from '../../hooks/useForwarderQueries';
import {
  buildEditExpenseForm,
  buildExpensePayload,
  buildUpdateExpensePayload,
  hasMarkupPolicy,
  newExpenseForm,
  resolveLiftContext,
  resolveNoInvoicePolicy,
  singleContainerPrefill,
  validateExpenseForm,
  type ExpenseFormErrors,
  type ExpenseFormState,
  type ForwarderExpenseTypeOption,
} from './forwarder-expense-model';
import { isSyntheticLclContainer, type ForwarderContainer } from './forwarder-trip-detail-sections';

type TripData = NonNullable<ReturnType<typeof useForwarderTripDetail>['data']>;
type TripExpense = TripData['expenses'][number];

export interface UseForwarderExpenseFormArgs {
  tripId: number;
  /** May still be loading — the hook guards every trip-derived derivation. */
  trip: TripData | null | undefined;
  forwarderExpenseTypeOptions: ForwarderExpenseTypeOption[];
}

export interface ForwarderExpenseFormController {
  /* render state */
  show: boolean;
  form: ExpenseFormState;
  errors: ExpenseFormErrors;
  submitError: string | null;
  editingExpenseId: number | null;
  saving: boolean;
  isDirty: boolean;
  /* lift (nâng/hạ) context */
  isLiftExpense: boolean;
  suggestedLiftPrice: number;
  liftPriceDelta: number;
  liftPriceStatus: { isFetching: boolean; isError: boolean; manualSource: boolean };
  /* derived row policy */
  noInvoiceAllowed: boolean;
  allowedEvidenceTypes: string[];
  noInvoiceLimits: { perItem: number; perDay: number };
  selectedExpenseContainer: ForwarderContainer | undefined;
  selectedExpenseContainerIsSyntheticLcl: boolean;
  /* actions */
  open: () => void;
  openEditor: (expense: TripExpense) => void;
  cancel: () => void;
  submit: () => void;
  setType: (expenseType: string) => void;
  setBuyAmount: (value: string) => void;
  setSettlementMethod: (method: ExpenseFormState['settlementMethod']) => void;
  selectSupplier: (supplierId: string, supplierName: string) => void;
  selectContainer: (tripContainerId: string) => void;
  patch: (patch: Partial<ExpenseFormState>) => void;
  toggleEvidenceType: (value: string, checked: boolean) => void;
  clearError: (key: keyof ExpenseFormErrors) => void;
}

export function useForwarderExpenseForm({
  tripId,
  trip,
  forwarderExpenseTypeOptions,
}: UseForwarderExpenseFormArgs): ForwarderExpenseFormController {
  const createExpenseMut = useCreateForwarderExpense();
  const updateExpenseMut = useUpdateForwarderExpense();

  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [expenseForm, setExpenseForm] = useState(newExpenseForm);
  const [expenseFormBaseline, setExpenseFormBaseline] = useState(newExpenseForm);
  const lastAppliedLiftSuggestionKey = useRef<string | null>(null);
  const [expenseErrors, setExpenseErrors] = useState<ExpenseFormErrors>({});
  const [expenseSubmitError, setExpenseSubmitError] = useState<string | null>(null);

  // Memoized so the action callbacks below keep stable identities across renders.
  const containers = useMemo(() => (trip?.containers || []) as ForwarderContainer[], [trip]);
  const legs = useMemo(() => (trip?.legs || []) as TripData['legs'], [trip]);
  const expenses = useMemo(() => trip?.expenses || [], [trip]);

  const { isLiftExpense, liftDirection } = resolveLiftContext(expenseForm);

  const liftPriceQuery = useQuery({
    queryKey: qk.forwarder.liftPrice({
      portId: expenseForm.portId,
      containerTypeId: expenseForm.containerTypeId,
      direction: liftDirection,
      loadState: expenseForm.loadState,
      expenseDate: expenseForm.expenseDate,
    }),
    queryFn: () => forwarderClient.resolveLiftPrice({
      portId: Number(expenseForm.portId),
      containerTypeId: Number(expenseForm.containerTypeId),
      direction: liftDirection,
      loadState: expenseForm.loadState,
      date: expenseForm.expenseDate,
    }),
    enabled: isLiftExpense
      && Number(expenseForm.portId) > 0
      && Number(expenseForm.containerTypeId) > 0
      && Boolean(expenseForm.expenseDate),
    staleTime: 5 * 60 * 1000,
  });

  // Auto-apply the matrix suggestion once per unique Cảng × Loại cont ×
  // Hàng/Rỗng × ngày combination (rising edge — user edits after are kept).
  useEffect(() => {
    const { suggestionKey } = resolveLiftContext(expenseForm);
    const suggestedPrice = liftPriceQuery.data?.suggestedPrice ?? 0;
    if (
      !isLiftExpense
      || liftPriceQuery.data?.source !== 'MATRIX'
      || suggestedPrice <= 0
      || lastAppliedLiftSuggestionKey.current === suggestionKey
    ) return;
    const value = String(suggestedPrice);
    const hasMarkup = hasMarkupPolicy(expenseForm.expenseType);
    setExpenseForm((current) => ({
      ...current,
      buyAmount: value,
      sellAmount: hasMarkup ? current.sellAmount : value,
    }));
    lastAppliedLiftSuggestionKey.current = suggestionKey;
  }, [expenseForm, isLiftExpense, liftPriceQuery.data]);

  const clearError = useCallback((key: keyof ExpenseFormErrors) => {
    // Referentially stable when the error was already clear, so unrelated
    // keystrokes never trigger extra renders.
    setExpenseErrors(errors => (errors[key] === undefined ? errors : { ...errors, [key]: undefined }));
  }, []);

  const setType = useCallback((newType: string) => {
    const hasMarkup = hasMarkupPolicy(newType);
    setExpenseForm(f => ({
      ...f,
      expenseType: newType,
      // For at-cost types, keep sell in sync; for markup types, clear it for manual entry
      sellAmount: hasMarkup ? '' : f.buyAmount,
    }));
    setExpenseErrors({});
  }, []);

  const setBuyAmount = useCallback((val: string) => {
    setExpenseForm(f => {
      const hasMarkup = hasMarkupPolicy(f.expenseType);
      return {
        ...f,
        buyAmount: val,
        // Auto-sync sell for at-cost types
        sellAmount: hasMarkup ? f.sellAmount : val,
      };
    });
    clearError('buyAmount');
  }, [clearError]);

  const setSettlementMethod = useCallback((method: ExpenseFormState['settlementMethod']) => {
    setExpenseForm(f => ({
      ...f,
      settlementMethod: method,
      supplierId: method === 'OPS_ADVANCE' ? '' : f.supplierId,
    }));
    clearError('supplierId');
  }, [clearError]);

  const selectSupplier = useCallback((supplierId: string, supplierName: string) => {
    setExpenseForm(f => ({
      ...f,
      supplierId,
      payeeName: f.payeeName || supplierName || '',
    }));
    clearError('supplierId');
  }, [clearError]);

  const selectContainer = useCallback((tripContainerId: string) => {
    const selected = containers.find(container => String(container.id) === tripContainerId);
    setExpenseForm(f => ({
      ...f,
      tripContainerId,
      containerTypeId: selected?.containerTypeId ? String(selected.containerTypeId) : f.containerTypeId,
    }));
  }, [containers]);

  const patch = useCallback((p: Partial<ExpenseFormState>) => {
    setExpenseForm(f => ({ ...f, ...p }));
  }, []);

  const toggleEvidenceType = useCallback((value: string, checked: boolean) => {
    setExpenseForm(current => ({
      ...current,
      noInvoiceEvidenceTypes: checked
        ? [...current.noInvoiceEvidenceTypes, value]
        : current.noInvoiceEvidenceTypes.filter((item) => item !== value),
    }));
    clearError('evidence');
  }, [clearError]);

  const open = useCallback(() => {
    setShowExpenseForm(prev => {
      const willOpen = !prev;
      if (willOpen && !expenseForm.tripContainerId) {
        const prefill = singleContainerPrefill(containers, legs);
        if (prefill) {
          setExpenseForm(f => ({ ...f, ...prefill }));
          setExpenseFormBaseline(f => ({ ...f, ...prefill }));
        }
      }
      if (willOpen) lastAppliedLiftSuggestionKey.current = null;
      return willOpen;
    });
  }, [containers, expenseForm.tripContainerId, legs]);

  const openEditor = useCallback((exp: TripExpense) => {
    if (exp.activeSettlementId || !exp.canEdit) return;
    setEditingExpenseId(exp.id);
    const editForm = buildEditExpenseForm(exp, containers, legs);
    setExpenseForm(editForm);
    setExpenseFormBaseline(editForm);
    setExpenseErrors({});
    setExpenseSubmitError(null);
    setShowExpenseForm(true);
  }, [containers, legs]);

  const cancel = useCallback(() => {
    lastAppliedLiftSuggestionKey.current = null;
    setShowExpenseForm(false);
    setEditingExpenseId(null);
    setExpenseErrors({});
    setExpenseSubmitError(null);
  }, []);

  const suggestedLiftPrice = liftPriceQuery.data?.source === 'MATRIX' ? liftPriceQuery.data.suggestedPrice : 0;

  const submit = useCallback(() => {
    setExpenseSubmitError(null);
    const selectedExpenseTypeConfig = forwarderExpenseTypeOptions.find(type => type.code === expenseForm.expenseType);
    const { noInvoiceAllowed } = resolveNoInvoicePolicy(selectedExpenseTypeConfig);
    const matrixPriceValid = liftPriceQuery.data?.source === 'MATRIX' && suggestedLiftPrice > 0;

    const errors = validateExpenseForm(expenseForm, { isLiftExpense, matrixPriceValid, noInvoiceAllowed });
    if (Object.keys(errors).length > 0) { setExpenseErrors(errors); return; }

    const payload = buildExpensePayload(expenseForm, { tripId, isLiftExpense });
    if (!expenseForm.invoiceNumber.trim() && !noInvoiceAllowed) {
      setExpenseSubmitError('Hạng mục này không cho phép chi không hóa đơn. Vui lòng bổ sung hóa đơn hoặc đổi hạng mục.');
      return;
    }
    const mutation = editingExpenseId
      ? updateExpenseMut.mutate.bind(updateExpenseMut, buildUpdateExpensePayload(payload, expenseForm, {
          id: editingExpenseId,
          expectedUpdatedAt: expenses.find(expense => expense.id === editingExpenseId)!.updatedAt,
        }))
      : createExpenseMut.mutate.bind(createExpenseMut, payload);
    mutation(
      {
        onSuccess: () => {
          const resetForm = newExpenseForm();
          lastAppliedLiftSuggestionKey.current = null;
          setExpenseForm(resetForm);
          setExpenseFormBaseline(resetForm);
          setExpenseErrors({});
          setEditingExpenseId(null);
          setShowExpenseForm(false);
        },
        onError: (error) => {
          setExpenseSubmitError(error instanceof Error ? error.message : 'Không thể lưu điều chỉnh chi phí');
        },
      },
    );
  }, [createExpenseMut, editingExpenseId, expenses, expenseForm, forwarderExpenseTypeOptions, isLiftExpense, liftPriceQuery.data, suggestedLiftPrice, tripId, updateExpenseMut]);

  const selectedExpenseContainer = containers.find(c => String(c.id) === expenseForm.tripContainerId);
  const selectedExpenseContainerIsSyntheticLcl = selectedExpenseContainer ? isSyntheticLclContainer(selectedExpenseContainer) : false;
  const selectedExpenseTypeConfig = forwarderExpenseTypeOptions.find(type => type.code === expenseForm.expenseType);
  const noInvoicePolicy = resolveNoInvoicePolicy(selectedExpenseTypeConfig);
  const liftPriceDelta = suggestedLiftPrice > 0 && Number.isFinite(Number(expenseForm.buyAmount))
    ? Number(expenseForm.buyAmount) - suggestedLiftPrice
    : 0;

  return {
    show: showExpenseForm,
    form: expenseForm,
    errors: expenseErrors,
    submitError: expenseSubmitError,
    editingExpenseId,
    saving: createExpenseMut.isPending || updateExpenseMut.isPending,
    isDirty: showExpenseForm && JSON.stringify(expenseForm) !== JSON.stringify(expenseFormBaseline),
    isLiftExpense,
    suggestedLiftPrice,
    liftPriceDelta,
    liftPriceStatus: {
      isFetching: liftPriceQuery.isFetching,
      isError: liftPriceQuery.isError,
      manualSource: liftPriceQuery.data?.source === 'MANUAL',
    },
    noInvoiceAllowed: noInvoicePolicy.noInvoiceAllowed,
    allowedEvidenceTypes: noInvoicePolicy.allowedEvidenceTypes,
    noInvoiceLimits: { perItem: noInvoicePolicy.perItemLimit, perDay: noInvoicePolicy.perDayLimit },
    selectedExpenseContainer,
    selectedExpenseContainerIsSyntheticLcl,
    open,
    openEditor,
    cancel,
    submit,
    setType,
    setBuyAmount,
    setSettlementMethod,
    selectSupplier,
    selectContainer,
    patch,
    toggleEvidenceType,
    clearError,
  };
}
