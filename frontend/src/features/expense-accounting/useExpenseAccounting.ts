import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExpenseAccountingEntry, ExpenseAccountingUpdate, ExpenseVoucherInput, ExpenseReconciliationInput, ExpenseAccountingCreate } from '@tingting/shared';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { sourceRef } from './expense-accounting-model';

export function useExpenseMutations() {
  const cache = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: qk.expenseAccounting.all }),
      cache.invalidateQueries({ queryKey: qk.ops.root }),
      cache.invalidateQueries({ queryKey: qk.treasury.all }),
      cache.invalidateQueries({ queryKey: qk.recoverableCosts.all }),
      cache.invalidateQueries({ queryKey: qk.tripForm.tripExpensesAll }),
    ]);
  };
  return {
    create: useMutation({ mutationFn: ({ body, key }: { body: ExpenseAccountingCreate; key: string }) => expenseAccountingClient.create(body, key), onSuccess: invalidate }),
    reverse: useMutation({ mutationFn: ({ id, body, key }: { id: number; body: Parameters<typeof expenseAccountingClient.reverseVoucher>[1]; key: string }) => expenseAccountingClient.reverseVoucher(id, body, key), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ entry, body }: { entry: ExpenseAccountingEntry; body: ExpenseAccountingUpdate }) => expenseAccountingClient.update(sourceRef(entry), body), onSuccess: invalidate }),
    confirm: useMutation({ mutationFn: (entries: ExpenseAccountingEntry[]) => expenseAccountingClient.confirm(entries.map(sourceRef)), onSuccess: invalidate }),
    voucher: useMutation({ mutationFn: ({ body, key }: { body: ExpenseVoucherInput; key: string }) => expenseAccountingClient.createVoucher(body, key), onSuccess: invalidate }),
    reconcile: useMutation({ mutationFn: ({ body, key }: { body: ExpenseReconciliationInput; key: string }) => expenseAccountingClient.reconcile(body, key), onSuccess: invalidate }),
  };
}
